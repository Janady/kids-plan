use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(10);

pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

// Minimal one-shot HTTP/1.1 client (connect, send one request, read until we
// have the full body). DLNA control points only ever make small, infrequent
// requests (device description fetch, SOAP actions), so this mirrors the
// request/response shape of `video_server.rs`'s server side rather than
// pulling in a full HTTP client crate.
pub async fn request(
    host: &str,
    port: u16,
    method: &str,
    path: &str,
    extra_headers: &[(String, String)],
    body: Option<&[u8]>,
) -> Result<HttpResponse, String> {
    let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect((host, port)))
        .await
        .map_err(|_| "connect timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let mut request =
        format!("{method} {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n");
    for (k, v) in extra_headers {
        request.push_str(&format!("{k}: {v}\r\n"));
    }
    if let Some(b) = body {
        request.push_str(&format!("Content-Length: {}\r\n", b.len()));
    }
    request.push_str("\r\n");

    let mut out = request.into_bytes();
    if let Some(b) = body {
        out.extend_from_slice(b);
    }

    timeout(IO_TIMEOUT, stream.write_all(&out))
        .await
        .map_err(|_| "write timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let mut raw: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut header_end: Option<usize> = None;
    let mut content_length: Option<usize> = None;

    loop {
        let n = match timeout(IO_TIMEOUT, stream.read(&mut chunk)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(n)) => n,
            Ok(Err(e)) => return Err(e.to_string()),
            Err(_) => return Err("read timed out".to_string()),
        };
        raw.extend_from_slice(&chunk[..n]);

        if header_end.is_none() {
            if let Some(pos) = find_subslice(&raw, b"\r\n\r\n") {
                header_end = Some(pos);
                let header_text = std::str::from_utf8(&raw[..pos]).unwrap_or("");
                content_length = parse_content_length(header_text);
            }
        }

        // Stop as soon as we have the whole body — don't wait for the peer to
        // close (some renderers keep-alive despite `Connection: close`),
        // which matters because the cast orchestrator polls this every ~2s.
        if let (Some(he), Some(cl)) = (header_end, content_length) {
            if raw.len() - (he + 4) >= cl {
                break;
            }
        }
    }

    parse_response(&raw)
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn parse_content_length(header_text: &str) -> Option<usize> {
    for line in header_text.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            return v.trim().parse().ok();
        }
    }
    None
}

fn parse_response(raw: &[u8]) -> Result<HttpResponse, String> {
    let header_end = find_subslice(raw, b"\r\n\r\n").ok_or("malformed HTTP response")?;
    let header_text = std::str::from_utf8(&raw[..header_end]).map_err(|e| e.to_string())?;
    let status_line = header_text.lines().next().ok_or("empty response")?;
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or("malformed status line")?;

    let body = raw[header_end + 4..].to_vec();
    Ok(HttpResponse { status, body })
}
