mod avtransport;
mod device;
mod http_client;
mod lan_server;
mod orchestrator;
mod ssdp;

use std::time::Duration;

use tauri::{AppHandle, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

pub use orchestrator::{CastQueueItem, CastStateSnapshot};
use orchestrator::{CastControl, SharedSnapshot};

const DEFAULT_DISCOVER_TIMEOUT_MS: u64 = 3000;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RendererInfo {
    pub id: String,
    pub name: String,
    pub location: String,
}

struct CastSession {
    control_tx: mpsc::UnboundedSender<CastControl>,
    #[allow(dead_code)]
    task: JoinHandle<()>,
    snapshot: SharedSnapshot,
}

#[derive(Default)]
pub struct CastState {
    session: tokio::sync::Mutex<Option<CastSession>>,
}

// Discovers DLNA MediaRenderers on the LAN via SSDP, then fetches each
// candidate's device description concurrently to resolve a display name and
// confirm it actually exposes an AVTransport service (candidates that don't
// — e.g. a misreporting device caught by the broad `ssdp:all` fallback
// search — are silently dropped here rather than surfaced as unusable
// entries in the picker).
#[tauri::command]
pub async fn discover_renderers(timeout_ms: Option<u64>) -> Result<Vec<RendererInfo>, String> {
    let dur = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_DISCOVER_TIMEOUT_MS));
    let candidates = ssdp::discover(dur).await;

    let handles: Vec<_> = candidates
        .into_iter()
        .map(|c| {
            tokio::spawn(async move {
                let name = device::describe(&c.location).await.ok().map(|d| d.friendly_name);
                (c, name)
            })
        })
        .collect();

    let mut infos = Vec::new();
    for handle in handles {
        if let Ok((candidate, Some(name))) = handle.await {
            infos.push(RendererInfo {
                id: candidate.usn,
                name,
                location: candidate.location,
            });
        }
    }
    Ok(infos)
}

#[tauri::command]
pub async fn start_cast(
    app: AppHandle,
    state: State<'_, CastState>,
    renderer_name: String,
    renderer_location: String,
    queue: Vec<CastQueueItem>,
) -> Result<(), String> {
    let mut guard = state.session.lock().await;
    if guard.is_some() {
        return Err("已有正在进行的投屏会话".to_string());
    }
    if queue.is_empty() {
        return Err("今日任务为空,没有可投屏的视频".to_string());
    }

    // Resolve the AVTransport control endpoint before spawning the session
    // task, so an unreachable renderer fails `start_cast` synchronously
    // instead of only surfacing via a later `cast://state-changed` error
    // event.
    let device = device::describe(&renderer_location).await?;

    let (control_tx, control_rx) = mpsc::unbounded_channel();
    let snapshot: SharedSnapshot = Default::default();
    let task = tokio::spawn(orchestrator::run(
        app.clone(),
        device,
        renderer_name,
        queue,
        control_rx,
        snapshot.clone(),
    ));

    *guard = Some(CastSession {
        control_tx,
        task,
        snapshot,
    });
    Ok(())
}

#[tauri::command]
pub async fn cast_pause(state: State<'_, CastState>) -> Result<(), String> {
    let guard = state.session.lock().await;
    match guard.as_ref() {
        Some(session) => session
            .control_tx
            .send(CastControl::Pause)
            .map_err(|_| "投屏会话已结束".to_string()),
        None => Err("当前没有投屏会话".to_string()),
    }
}

#[tauri::command]
pub async fn cast_resume(state: State<'_, CastState>) -> Result<(), String> {
    let guard = state.session.lock().await;
    match guard.as_ref() {
        Some(session) => session
            .control_tx
            .send(CastControl::Resume)
            .map_err(|_| "投屏会话已结束".to_string()),
        None => Err("当前没有投屏会话".to_string()),
    }
}

#[tauri::command]
pub async fn cast_stop(state: State<'_, CastState>) -> Result<(), String> {
    let guard = state.session.lock().await;
    match guard.as_ref() {
        Some(session) => session
            .control_tx
            .send(CastControl::Stop)
            .map_err(|_| "投屏会话已结束".to_string()),
        None => Err("当前没有投屏会话".to_string()),
    }
}

#[tauri::command]
pub async fn cast_jump_to(state: State<'_, CastState>, index: usize) -> Result<(), String> {
    let guard = state.session.lock().await;
    match guard.as_ref() {
        Some(session) => session
            .control_tx
            .send(CastControl::JumpTo(index))
            .map_err(|_| "投屏会话已结束".to_string()),
        None => Err("当前没有投屏会话".to_string()),
    }
}

#[tauri::command]
pub async fn get_cast_state(state: State<'_, CastState>) -> Result<Option<CastStateSnapshot>, String> {
    let guard = state.session.lock().await;
    match guard.as_ref() {
        Some(session) => Ok(session.snapshot.lock().unwrap().clone()),
        None => Ok(None),
    }
}
