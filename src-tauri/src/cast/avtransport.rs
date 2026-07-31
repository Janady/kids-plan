use super::device::RendererDevice;
use super::http_client;

const AVT_SERVICE_TYPE: &str = "urn:schemas-upnp-org:service:AVTransport:1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportState {
    Playing,
    Paused,
    Stopped,
    Transitioning,
    NoMediaPresent,
    Unknown,
}

impl TransportState {
    fn parse(s: &str) -> Self {
        match s {
            "PLAYING" => Self::Playing,
            "PAUSED_PLAYBACK" | "PAUSED" => Self::Paused,
            "STOPPED" => Self::Stopped,
            "TRANSITIONING" => Self::Transitioning,
            "NO_MEDIA_PRESENT" => Self::NoMediaPresent,
            _ => Self::Unknown,
        }
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn soap_envelope(action: &str, args_xml: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
         <s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
         <s:Body><u:{action} xmlns:u=\"{AVT_SERVICE_TYPE}\">{args_xml}</u:{action}></s:Body></s:Envelope>"
    )
}

async fn call(device: &RendererDevice, action: &str, args_xml: &str) -> Result<String, String> {
    let body = soap_envelope(action, args_xml);
    let headers = [
        (
            "Content-Type".to_string(),
            "text/xml; charset=\"utf-8\"".to_string(),
        ),
        (
            "SOAPACTION".to_string(),
            format!("\"{AVT_SERVICE_TYPE}#{action}\""),
        ),
    ];
    let resp = http_client::request(
        &device.control_host,
        device.control_port,
        "POST",
        &device.control_path,
        &headers,
        Some(body.as_bytes()),
    )
    .await?;
    if resp.status != 200 {
        return Err(format!("SOAP {action} HTTP {}", resp.status));
    }
    Ok(String::from_utf8_lossy(&resp.body).into_owned())
}

pub async fn set_av_transport_uri(device: &RendererDevice, media_url: &str) -> Result<(), String> {
    let args = format!(
        "<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>",
        xml_escape(media_url)
    );
    call(device, "SetAVTransportURI", &args).await?;
    Ok(())
}

pub async fn play(device: &RendererDevice) -> Result<(), String> {
    call(device, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>").await?;
    Ok(())
}

pub async fn pause(device: &RendererDevice) -> Result<(), String> {
    call(device, "Pause", "<InstanceID>0</InstanceID>").await?;
    Ok(())
}

pub async fn stop(device: &RendererDevice) -> Result<(), String> {
    call(device, "Stop", "<InstanceID>0</InstanceID>").await?;
    Ok(())
}

pub async fn get_transport_info(device: &RendererDevice) -> Result<TransportState, String> {
    let body = call(device, "GetTransportInfo", "<InstanceID>0</InstanceID>").await?;
    let state = extract_tag_value(&body, "CurrentTransportState")
        .map(|v| TransportState::parse(&v))
        .unwrap_or(TransportState::Unknown);
    Ok(state)
}

fn extract_tag_value(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].trim().to_string())
}
