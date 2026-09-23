use tauri::{
    plugin::{Builder, TauriPlugin},
    Wry,
};
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, AppHandle, Manager};

// Android WebView pauses HTML media once the screen is off (especially on
// tablets). The Kotlin plugin starts a foreground MediaPlayer service so
// playback continues through sleep; this command just forwards play/stop.
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.janady.video_plan";

#[cfg(target_os = "android")]
pub struct BackgroundPlayback {
    handle: PluginHandle<Wry>,
}

#[cfg(target_os = "android")]
impl BackgroundPlayback {
    fn set(
        &self,
        playing: bool,
        title: Option<String>,
        path: Option<String>,
        loop_track: bool,
    ) -> Result<(), String> {
        if playing {
            self.handle
                .run_mobile_plugin::<()>(
                    "start",
                    serde_json::json!({
                        "title": title.unwrap_or_else(|| "背景音乐".into()),
                        "path": path.unwrap_or_default(),
                        "loopTrack": loop_track,
                    }),
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
    path: Option<String>,
    loop_track: Option<bool>,
) -> Result<(), String> {
    app.state::<BackgroundPlayback>()
        .set(playing, title, path, loop_track.unwrap_or(false))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn set_background_playback(
    _playing: bool,
    _title: Option<String>,
    _path: Option<String>,
    _loop_track: Option<bool>,
) -> Result<(), String> {
    Ok(())
}
