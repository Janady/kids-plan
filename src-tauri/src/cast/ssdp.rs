use std::collections::HashMap;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::time::timeout;

const MULTICAST_ADDR: &str = "239.255.255.250:1900";

#[derive(Debug, Clone, serde::Serialize)]
pub struct RendererCandidate {
    pub usn: String,
    pub location: String,
}

// Sends SSDP M-SEARCH multicast queries and collects unicast replies for
// `timeout_dur`. Two search targets are used: the specific MediaRenderer
// device type, plus a broad `ssdp:all` fallback for cheap projectors/TVs
// that misreport their ST — anything without a usable AVTransport service
// is naturally filtered out later when `cast::device::describe` fails to
// find a controlURL for it. Missing renderers are simply not returned;
// discovery is inherently best-effort, not a guaranteed inventory.
pub async fn discover(timeout_dur: Duration) -> Vec<RendererCandidate> {
    let socket = match UdpSocket::bind("0.0.0.0:0").await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[cast::ssdp] bind failed: {e}");
            return Vec::new();
        }
    };

    for search_target in [
        "urn:schemas-upnp-org:device:MediaRenderer:1",
        "ssdp:all",
    ] {
        let request = format!(
            "M-SEARCH * HTTP/1.1\r\n\
             HOST: 239.255.255.250:1900\r\n\
             MAN: \"ssdp:discover\"\r\n\
             MX: 2\r\n\
             ST: {search_target}\r\n\
             \r\n"
        );
        if let Err(e) = socket.send_to(request.as_bytes(), MULTICAST_ADDR).await {
            eprintln!("[cast::ssdp] send failed: {e}");
        }
    }

    // Deduplicate by location URL, not USN — a single physical device can reply
    // to both M-SEARCH queries with different USNs (e.g. the device root USN,
    // the MediaRenderer service USN, and the AVTransport service USN all point
    // to the same description URL). Keying by USN as before surfaces the same
    // device 3–4 times in the picker.
    let mut found: HashMap<String, String> = HashMap::new(); // location → usn
    let mut buf = vec![0u8; 4096];
    let deadline = tokio::time::Instant::now() + timeout_dur;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match timeout(remaining, socket.recv_from(&mut buf)).await {
            Ok(Ok((n, _))) => {
                if let Some((usn, location)) = parse_response(&buf[..n]) {
                    found.entry(location).or_insert(usn);
                }
            }
            _ => break,
        }
    }

    found
        .into_iter()
        .map(|(location, usn)| RendererCandidate { usn, location })
        .collect()
}

fn parse_response(data: &[u8]) -> Option<(String, String)> {
    let text = std::str::from_utf8(data).ok()?;
    let mut location = None;
    let mut usn = None;
    for line in text.lines() {
        let mut parts = line.splitn(2, ':');
        let key = parts.next()?.trim().to_ascii_lowercase();
        let value = parts.next().map(|v| v.trim().to_string());
        match key.as_str() {
            "location" => location = value,
            "usn" => usn = value,
            _ => {}
        }
    }
    Some((usn?, location?))
}
