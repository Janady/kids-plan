use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use super::avtransport::{self, TransportState};
use super::device::RendererDevice;
use super::lan_server;
use super::CastState;
use crate::commands::sessions::record_watch_tick;
use crate::db::AppState;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const MAX_CONSECUTIVE_POLL_FAILURES: u32 = 3;
const STATE_CHANGED_EVENT: &str = "cast://state-changed";

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct CastQueueItem {
    pub video_id: i64,
    pub file_path: String,
    pub title: String,
    pub duration_seconds: Option<i64>,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CastPhase {
    Loading,
    Playing,
    Paused,
    Finished,
    Stopped,
    Error,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CastStateSnapshot {
    pub renderer_name: String,
    pub current: Option<CastQueueItem>,
    pub index: usize,
    pub total: usize,
    pub transport_state: TransportState,
    pub is_paused_by_break: bool,
    pub phase: CastPhase,
    pub error: Option<String>,
}

pub enum CastControl {
    Pause,
    Resume,
    Stop,
}

pub type SharedSnapshot = Arc<StdMutex<Option<CastStateSnapshot>>>;

fn publish(app: &AppHandle, snapshot: &SharedSnapshot, value: CastStateSnapshot) {
    *snapshot.lock().unwrap() = Some(value.clone());
    let _ = app.emit(STATE_CHANGED_EVENT, value);
}

// Percent-encodes a filesystem path for embedding in the media URL handed to
// `SetAVTransportURI`. Encodes byte-by-byte (not char-by-char) so multi-byte
// UTF-8 sequences (Chinese filenames) survive intact — the counterpart to
// `video_server.rs`'s own `url_decode`.
fn url_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// Drives one cast session end-to-end: starts the LAN video listener, walks
// the queue one video at a time (switching `AVTransportURI` per item rather
// than concatenating into a single stream), and always tears the LAN
// listener down and clears `CastState` on every exit path (finished,
// stopped, or unrecoverable error).
pub async fn run(
    app: AppHandle,
    device: RendererDevice,
    renderer_name: String,
    queue: Vec<CastQueueItem>,
    mut control_rx: mpsc::UnboundedReceiver<CastControl>,
    snapshot: SharedSnapshot,
) {
    let total = queue.len();

    let (lan_port, lan_task) = match lan_server::start().await {
        Ok(v) => v,
        Err(e) => {
            publish(
                &app,
                &snapshot,
                error_snapshot(&renderer_name, total, format!("局域网服务启动失败: {e}")),
            );
            clear_session(&app).await;
            return;
        }
    };
    let lan_ip = lan_server::local_ip().unwrap_or_else(|| "127.0.0.1".to_string());

    'queue: for (index, item) in queue.into_iter().enumerate() {
        let media_url = format!(
            "http://{lan_ip}:{lan_port}/?path={}",
            url_encode(&item.file_path)
        );

        publish(
            &app,
            &snapshot,
            CastStateSnapshot {
                renderer_name: renderer_name.clone(),
                current: Some(item.clone()),
                index,
                total,
                transport_state: TransportState::Unknown,
                is_paused_by_break: false,
                phase: CastPhase::Loading,
                error: None,
            },
        );

        if let Err(e) = avtransport::set_av_transport_uri(&device, &media_url).await {
            publish(&app, &snapshot, error_snapshot(&renderer_name, total, e));
            break;
        }
        if let Err(e) = avtransport::play(&device).await {
            publish(&app, &snapshot, error_snapshot(&renderer_name, total, e));
            break;
        }

        let mut paused_by_break = false;
        let mut consecutive_failures: u32 = 0;

        loop {
            tokio::select! {
                control = control_rx.recv() => {
                    match control {
                        Some(CastControl::Pause) => {
                            let _ = avtransport::pause(&device).await;
                            paused_by_break = true;
                            publish(&app, &snapshot, CastStateSnapshot {
                                renderer_name: renderer_name.clone(),
                                current: Some(item.clone()),
                                index, total,
                                transport_state: TransportState::Paused,
                                is_paused_by_break: true,
                                phase: CastPhase::Paused,
                                error: None,
                            });
                        }
                        Some(CastControl::Resume) => {
                            let _ = avtransport::play(&device).await;
                            paused_by_break = false;
                        }
                        Some(CastControl::Stop) | None => {
                            let _ = avtransport::stop(&device).await;
                            lan_task.abort();
                            publish(&app, &snapshot, CastStateSnapshot {
                                renderer_name: renderer_name.clone(),
                                current: None, index, total,
                                transport_state: TransportState::Stopped,
                                is_paused_by_break: false,
                                phase: CastPhase::Stopped,
                                error: None,
                            });
                            clear_session(&app).await;
                            return;
                        }
                    }
                }
                _ = tokio::time::sleep(POLL_INTERVAL), if !paused_by_break => {
                    match avtransport::get_transport_info(&device).await {
                        Ok(TransportState::Stopped) => {
                            continue 'queue;
                        }
                        Ok(state) => {
                            consecutive_failures = 0;
                            if state == TransportState::Playing {
                                let app_state = app.state::<AppState>();
                                let _ = record_watch_tick(app_state, item.video_id).await;
                            }
                            publish(&app, &snapshot, CastStateSnapshot {
                                renderer_name: renderer_name.clone(),
                                current: Some(item.clone()),
                                index, total,
                                transport_state: state,
                                is_paused_by_break: false,
                                phase: CastPhase::Playing,
                                error: None,
                            });
                        }
                        Err(_) => {
                            consecutive_failures += 1;
                            if consecutive_failures >= MAX_CONSECUTIVE_POLL_FAILURES {
                                publish(&app, &snapshot, error_snapshot(&renderer_name, total, "设备无响应,已停止投屏".to_string()));
                                lan_task.abort();
                                clear_session(&app).await;
                                return;
                            }
                        }
                    }
                }
            }
        }
    }

    lan_task.abort();
    publish(
        &app,
        &snapshot,
        CastStateSnapshot {
            renderer_name,
            current: None,
            index: total,
            total,
            transport_state: TransportState::Stopped,
            is_paused_by_break: false,
            phase: CastPhase::Finished,
            error: None,
        },
    );
    clear_session(&app).await;
}

fn error_snapshot(renderer_name: &str, total: usize, error: String) -> CastStateSnapshot {
    CastStateSnapshot {
        renderer_name: renderer_name.to_string(),
        current: None,
        index: 0,
        total,
        transport_state: TransportState::Unknown,
        is_paused_by_break: false,
        phase: CastPhase::Error,
        error: Some(error),
    }
}

async fn clear_session(app: &AppHandle) {
    if let Some(state) = app.try_state::<CastState>() {
        let mut guard = state.session.lock().await;
        *guard = None;
    }
}
