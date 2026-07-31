use super::http_client;

pub struct RendererDevice {
    pub friendly_name: String,
    pub control_host: String,
    pub control_port: u16,
    pub control_path: String,
}

struct ParsedUrl {
    host: String,
    port: u16,
    path: String,
}

fn parse_url(url: &str) -> Option<ParsedUrl> {
    let rest = url.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.split_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().ok()?),
        None => (authority.to_string(), 80),
    };
    Some(ParsedUrl {
        host,
        port,
        path: path.to_string(),
    })
}

// Fetches a device's UPnP description XML (the document at its SSDP
// `LOCATION`) and pulls out just what casting needs: a human-readable name
// and the control endpoint of its AVTransport service.
pub async fn describe(location: &str) -> Result<RendererDevice, String> {
    let url = parse_url(location).ok_or("bad LOCATION url")?;
    let resp = http_client::request(&url.host, url.port, "GET", &url.path, &[], None).await?;
    if resp.status != 200 {
        return Err(format!("device description HTTP {}", resp.status));
    }
    let xml = String::from_utf8_lossy(&resp.body).into_owned();
    parse_device_xml(&xml, &url.host, url.port)
}

// Hand-rolled tag extraction rather than a full XML parser: UPnP device
// descriptions are shallow, attribute-free documents for the fields we care
// about (friendlyName / serviceType / controlURL are plain text elements),
// so simple scoped substring search is enough and keeps this feature
// dependency-free — consistent with `video_server.rs`'s own raw-socket
// approach elsewhere in this codebase.
fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].trim().to_string())
}

fn extract_blocks<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut blocks = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after_open = &rest[start + open.len()..];
        match after_open.find(&close) {
            Some(end) => {
                blocks.push(&after_open[..end]);
                rest = &after_open[end + close.len()..];
            }
            None => break,
        }
    }
    blocks
}

fn parse_device_xml(
    xml: &str,
    default_host: &str,
    default_port: u16,
) -> Result<RendererDevice, String> {
    let friendly_name =
        extract_tag(xml, "friendlyName").unwrap_or_else(|| "DLNA Renderer".to_string());

    let control_url = extract_blocks(xml, "service")
        .into_iter()
        .find(|block| {
            extract_tag(block, "serviceType")
                .map(|t| t.contains("AVTransport"))
                .unwrap_or(false)
        })
        .and_then(|block| extract_tag(block, "controlURL"))
        .ok_or("no AVTransport service found")?;

    if let Some(parsed) = parse_url(&control_url) {
        Ok(RendererDevice {
            friendly_name,
            control_host: parsed.host,
            control_port: parsed.port,
            control_path: parsed.path,
        })
    } else {
        // Relative controlURL (the common case) — resolve against the
        // device description's own host/port, per the UPnP spec's default
        // base-URL rule when the device provides no explicit <URLBase>.
        let path = if control_url.starts_with('/') {
            control_url
        } else {
            format!("/{control_url}")
        };
        Ok(RendererDevice {
            friendly_name,
            control_host: default_host.to_string(),
            control_port: default_port,
            control_path: path,
        })
    }
}
