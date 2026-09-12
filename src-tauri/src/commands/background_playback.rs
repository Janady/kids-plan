use tauri::{
    plugin::{Builder, TauriPlugin},
    Wry,
};
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, AppHandle, Manager};

// Android WebView pauses JS/media and the OS may freeze the process once the
// screen is off. A Kotlin foreground service + wake lock (BackgroundPlaybackPlugin)
// keeps the local audio server and <audio> element running through sleep.
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.janady.video_plan";

#[cfg(target_os = "android")]
pub struct BackgroundPlayback {
    handle: PluginHandle<Wry>,
}

#[cfg(target_os = "android")]
impl BackgroundPlayback {
    fn set(&self, playing: bool, title: Option<String>) -> Result<(), String> {
        if playing {
            self.handle
                .run_mobile_plugin::<()>(
                    "start",
                    serde_json::json!({ "title": title.unwrap_or_else(|| "背景音乐".into()) }),
                )
                .map_err(|e| e.to_string())
        } else {
            self.handle
                .run_mobile_plugin::<()>("stop", serde_json::json!({}))
                .map_err(|e| e.to_string())
        }
    }
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("background-playback")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "BackgroundPlaybackPlugin")?;
                _app.manage(BackgroundPlayback { handle });
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn set_background_playback(
    app: AppHandle,
    playing: bool,
    title: Option<String>,
) -> Result<(), String> {
    app.state::<BackgroundPlayback>().set(playing, title)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn set_background_playback(_playing: bool, _title: Option<String>) -> Result<(), String> {
    Ok(())
}
