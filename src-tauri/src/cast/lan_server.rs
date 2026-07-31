use std::net::UdpSocket as StdUdpSocket;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::video_server;

// Started only while a cast session is active; bound to `0.0.0.0` so a DLNA
// renderer on the LAN can fetch video bytes over HTTP Range requests, unlike
// the always-on, localhost-only server in `video_server.rs` used for
// in-app WebView playback. Reuses `video_server::serve` so the connection
// pool / timeout hardening there only has to live in one place, and so
// desktop code paths (which never call anything in `cast::`) can never
// trigger a `0.0.0.0` bind.
pub async fn start() -> Result<(u16, JoinHandle<()>), String> {
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    Ok(video_server::serve(listener).await)
}

// Best-effort discovery of the LAN-facing IP used to build cast URLs. Uses a
// connectionless UDP "connect" (no packet is actually sent) purely to ask the
// OS routing table which local interface would be used to reach the LAN,
// avoiding a dependency on a network-interface-enumeration crate.
pub fn local_ip() -> Option<String> {
    let socket = StdUdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}
