use tauri::{
    plugin::{Builder, TauriPlugin},
    Wry,
};
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, AppHandle, Manager};

// Forwards cast keep-awake to CastWakePlugin. No-op off Android, where the
// page-level Screen Wake Lock is enough to stop the display timing out.
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.janady.video_plan";

#[cfg(target_os = "android")]
pub struct CastWake {
    handle: PluginHandle<Wry>,
}

#[cfg(target_os = "android")]
impl CastWake {
    fn set(&self, enabled: bool) -> Result<(), String> {
        self.handle
            .run_mobile_plugin::<()>("setKeepAwake", serde_json::json!({ "enabled": enabled }))
            .map_err(|e| e.to_string())
    }
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("cast-wake")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "CastWakePlugin")?;
                _app.manage(CastWake { handle });
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn set_cast_keep_awake(app: AppHandle, enabled: bool) -> Result<(), String> {
    app.state::<CastWake>().set(enabled)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn set_cast_keep_awake(_enabled: bool) -> Result<(), String> {
    Ok(())
}
