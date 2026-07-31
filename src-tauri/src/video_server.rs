use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tokio::time::timeout;

// A stalled socket op must not hang forever. When the WebView abandons a stream
// (seek / switch video / long pause) it stops reading; without a timeout the
// server's write_all() blocks indefinitely, leaking the socket + file handle +
// buffers. Enough leaked tasks exhaust file descriptors, after which new videos
// and thumbnails can't load until the app restarts.
const READ_TIMEOUT: Duration = Duration::from_secs(15);
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);

// Same idea, but for disk I/O rather than socket I/O. Android media files live
// on external/removable storage (`/storage/emulated/0/...`), which can stall
// for reasons that have nothing to do with the network side — a MediaProvider
// scan, an SD card waking from sleep, a transient "storage not available"
// blip. Without a timeout here, a single stalled read holds its connection's
// semaphore permit forever (see MAX_CONNECTIONS below); enough of those over a
// long session exhaust the permit pool and every future request — including
// brand new ones — hangs waiting for a permit that will never free, with no
// error ever surfacing for the frontend's retry logic to react to.
const FILE_IO_TIMEOUT: Duration = Duration::from_secs(15);

// Hard cap on concurrently open connections (each holds a socket + possibly a
// file handle). Bounds worst-case fd usage regardless of how many thumbnails /
// players / retries pile up, instead of letting it grow unbounded until the OS
// fd limit is hit — which is what previously required an app restart to recover
// from. Comfortably above the ~6-per-origin the WebView opens on its own.
const MAX_CONNECTIONS: usize = 24;

// How long a new connection will wait for a free permit before giving up.
// Bounds worst-case wait to something well under the frontend's retry-window
// so a saturated (or wedged) pool fails fast with a real HTTP error instead of
// hanging indefinitely — turning a silent stuck-loading-spinner into something
// the existing onError-driven retry logic can actually recover from.
const PERMIT_WAIT_TIMEOUT: Duration = Duration::from_secs(10);

static PORT: OnceLock<u16> = OnceLock::new();

pub fn get_port() -> u16 {
    PORT.get().copied().unwrap_or(0)
}

pub async fn start() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("video server: bind failed");
    // The localhost server runs for the whole app lifetime, so the accept
    // loop's task handle is intentionally dropped here (dropping a
    // JoinHandle detaches it rather than aborting it).
    let (port, _handle) = serve(listener).await;
    PORT.set(port).ok();
    port
}

// Spawns the accept loop on an already-bound listener and returns its port
// plus a handle the caller can `.abort()` to stop serving. Shared by the
// localhost server (`start`, above) and the cast feature's LAN-bound
// listener (`cast::lan_server`, which does abort it when a cast session
// ends), so the connection-pool/timeout hardening below only has to live in
// one place.
pub(crate) async fn serve(listener: TcpListener) -> (u16, tokio::task::JoinHandle<()>) {
    let port = listener.local_addr().unwrap().port();

    let connections = Arc::new(Semaphore::new(MAX_CONNECTIONS));

    let handle = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, _)) => {
                    // Disable Nagle's algorithm: send media bytes immediately instead of
                    // batching them, which removes periodic latency spikes during playback.
                    let _ = socket.set_nodelay(true);
                    let permits = connections.clone();
                    tokio::spawn(async move {
                        // Hold the permit for the connection's whole lifetime (all
                        // keep-alive requests on it), not just one request. Bounded
                        // by PERMIT_WAIT_TIMEOUT so a saturated (or wedged) pool
                        // fails this connection with a real response instead of
                        // hanging it forever.
                        let mut socket = socket;
                        let _permit = match timeout(PERMIT_WAIT_TIMEOUT, permits.acquire()).await {
                            Ok(p) => p,
                            Err(_) => {
                                let _ = socket
                                    .write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n")
                                    .await;
                                return;
                            }
                        };
                        handle(socket).await;
                    });
                }
                Err(e) => {
                    // Without a backoff, a persistent accept error (e.g. the OS fd
                    // limit being hit) turns this into a tight spin loop that pins a
                    // runtime thread at 100% CPU and can't recover even after fds
                    // free up. A short sleep lets the runtime breathe and gives
                    // in-flight connections a chance to close.
                    eprintln!("[video_server] accept error: {e}");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
        }
    });

    (port, handle)
}

// Serves requests from one connection in a loop (HTTP/1.1 keep-alive) instead of
// closing after a single response. Video playback issues many sequential Range
// requests per file (initial load, seeks, buffering) — without keep-alive each
// one pays a fresh TCP handshake and fd allocation, which is the connection
// churn that was exhausting file descriptors under load.
async fn handle(mut socket: tokio::net::TcpStream) {
    loop {
        // Read request headers (max 8 KiB), bounded by a timeout to avoid slow/stuck
        // connections holding the task open forever. Also serves as the idle
        // keep-alive timeout between requests on the same connection.
        let mut buf = vec![0u8; 8192];
        let n = match timeout(READ_TIMEOUT, socket.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => return,
        };
        let request = match std::str::from_utf8(&buf[..n]) {
            Ok(s) => s.to_string(),
            Err(_) => return,
        };

        let first_line = request.lines().next().unwrap_or("");

        // OPTIONS preflight
        if first_line.starts_with("OPTIONS") {
            if socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\n\
                      Access-Control-Allow-Origin: *\r\n\
                      Access-Control-Allow-Methods: GET, HEAD\r\n\
                      Content-Length: 0\r\n\r\n",
                )
                .await
                .is_err()
            {
                return;
            }
            continue;
        }

        // Parse request line: GET /?path=<encoded-abs-path> HTTP/1.1
        let parts: Vec<&str> = first_line.splitn(3, ' ').collect();
        if parts.len() < 2 {
            return;
        }
        let raw_url = parts[1]; // e.g. "/ping"  or  "/?path=%2F..."

        // /ping — connectivity test
        if raw_url == "/ping" || raw_url.starts_with("/ping?") {
            if socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nAccess-Control-Allow-Origin: *\r\n\r\npong")
                .await
                .is_err()
            {
                return;
            }
            continue;
        }

        let file_path = match extract_path_param(raw_url) {
            Some(p) => p,
            None => {
                if socket
                    .write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
                    .await
                    .is_err()
                {
                    return;
                }
                continue;
            }
        };

        // Parse optional Range header
        let range = request
            .lines()
            .find(|l| l.to_ascii_lowercase().starts_with("range:"))
            .and_then(|l| parse_range(&l[6..]));

        eprintln!("[video_server] file={file_path:?} range={range:?}");
        if !serve_file(&mut socket, &file_path, range).await {
            return;
        }
        // else: response completed successfully, loop to read the next
        // request on this same connection.
    }
}

// Returns true if the connection can be reused for another request
// (keep-alive), false if it should be closed.
async fn serve_file(
    socket: &mut tokio::net::TcpStream,
    path: &str,
    range: Option<(u64, u64)>,
) -> bool {
    let mut file = match timeout(FILE_IO_TIMEOUT, File::open(path)).await {
        Ok(Ok(f)) => f,
        Ok(Err(e)) => {
            let code = if e.kind() == std::io::ErrorKind::NotFound {
                "404 Not Found"
            } else {
                "403 Forbidden"
            };
            return socket
                .write_all(format!("HTTP/1.1 {code}\r\nContent-Length: 0\r\n\r\n").as_bytes())
                .await
                .is_ok();
        }
        // Storage stalled (e.g. SD card / external storage hiccup) rather than
        // erroring — respond instead of holding the connection's permit forever.
        Err(_) => {
            return socket
                .write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n")
                .await
                .is_ok();
        }
    };

    let file_size = match timeout(FILE_IO_TIMEOUT, file.metadata()).await {
        Ok(Ok(m)) => m.len(),
        _ => return false,
    };
    if file_size == 0 {
        return false;
    }

    let mime = guess_mime(path);

    let (start, end, partial) = match range {
        Some((s, e)) => {
            let e = e.min(file_size - 1);
            if s > e {
                return socket
                    .write_all(b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\n\r\n")
                    .await
                    .is_ok();
            }
            (s, e, true)
        }
        None => (0, file_size - 1, false),
    };

    let content_length = end - start + 1;

    // Seek to start
    if !matches!(
        timeout(FILE_IO_TIMEOUT, file.seek(std::io::SeekFrom::Start(start))).await,
        Ok(Ok(_))
    ) {
        return false;
    }

    // Write response header
    let header = if partial {
        format!(
            "HTTP/1.1 206 Partial Content\r\n\
             Content-Type: {mime}\r\n\
             Content-Length: {content_length}\r\n\
             Content-Range: bytes {start}-{end}/{file_size}\r\n\
             Accept-Ranges: bytes\r\n\
             Access-Control-Allow-Origin: *\r\n\
             Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length\r\n\
             \r\n"
        )
    } else {
        format!(
            "HTTP/1.1 200 OK\r\n\
             Content-Type: {mime}\r\n\
             Content-Length: {content_length}\r\n\
             Accept-Ranges: bytes\r\n\
             Access-Control-Allow-Origin: *\r\n\
             \r\n"
        )
    };

    if !matches!(
        timeout(WRITE_TIMEOUT, socket.write_all(header.as_bytes())).await,
        Ok(Ok(()))
    ) {
        return false;
    }

    // Stream with a large read-ahead buffer. Reading ~1 MiB per disk op (vs many
    // small reads) and writing 256 KiB chunks keeps the socket fed steadily, which
    // prevents the periodic buffer-underrun stalls the WebView player showed every
    // few minutes.
    let mut reader = tokio::io::BufReader::with_capacity(1 << 20, file);
    let mut remaining = content_length;
    let mut chunk = vec![0u8; 262_144];
    while remaining > 0 {
        let to_read = (remaining as usize).min(chunk.len());
        // Bounded read: a stalled disk (SD card / external storage hiccup)
        // must not hold this connection's semaphore permit forever — see
        // FILE_IO_TIMEOUT.
        match timeout(FILE_IO_TIMEOUT, reader.read(&mut chunk[..to_read])).await {
            Ok(Ok(0)) => break,
            Ok(Ok(n)) => {
                // Bounded write: if the client stops reading (abandoned stream),
                // this times out instead of blocking forever — freeing the socket
                // and file handle so they don't accumulate.
                if !matches!(
                    timeout(WRITE_TIMEOUT, socket.write_all(&chunk[..n])).await,
                    Ok(Ok(()))
                ) {
                    return false;
                }
                remaining -= n as u64;
            }
            _ => return false,
        }
    }
    remaining == 0
}

// URL: "/?path=%2Fstorage%2Femulated%2F0%2Fvideo.mp4"  →  "/storage/emulated/0/video.mp4"
fn extract_path_param(url: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    let encoded = query
        .split('&')
        .find(|seg| seg.starts_with("path="))?
        .strip_prefix("path=")?;
    Some(url_decode(encoded))
}

fn parse_range(value: &str) -> Option<(u64, u64)> {
    let bytes = value.trim().strip_prefix("bytes=")?;
    let mut parts = bytes.splitn(2, '-');
    let start: u64 = parts.next()?.trim().parse().ok()?;
    let end: u64 = parts
        .next()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(u64::MAX);
    Some((start, end))
}

fn url_decode(s: &str) -> String {
    // Collect decoded bytes first, then interpret as UTF-8.
    // Doing byte-by-byte char() conversion would corrupt multi-byte sequences (e.g. Chinese filenames).
    let mut bytes: Vec<u8> = Vec::with_capacity(s.len());
    let mut iter = s.bytes();
    while let Some(b) = iter.next() {
        if b == b'%' {
            let h1 = iter.next().and_then(|c| (c as char).to_digit(16));
            let h2 = iter.next().and_then(|c| (c as char).to_digit(16));
            if let (Some(h1), Some(h2)) = (h1, h2) {
                bytes.push((h1 << 4 | h2) as u8);
            }
        } else if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8(bytes).unwrap_or_default()
}

fn guess_mime(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "ts" | "m2ts" | "mts" => "video/mp2t",
        "flv" => "video/x-flv",
        "wmv" => "video/x-ms-wmv",
        "3gp" => "video/3gpp",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "wma" => "audio/x-ms-wma",
        "aiff" => "audio/aiff",
        _ => "application/octet-stream",
    }
}
