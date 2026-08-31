use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Wry,
};
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

// Android's FileProvider requires a content:// URI (not a raw file:// path) to
// share a file with another app's ACTION_VIEW intent — this delegates to a
// Kotlin plugin (DocumentOpenerPlugin, registered below) that does the
// FileProvider conversion, since that API has no JNI-friendly Rust equivalent.
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.janady.video_plan";

#[cfg(target_os = "android")]
pub struct DocumentOpener {
    handle: PluginHandle<Wry>,
}

#[cfg(target_os = "android")]
impl DocumentOpener {
    pub fn open_document(&self, file_path: String) -> Result<(), String> {
        self.handle
            .run_mobile_plugin::<()>("openDocument", serde_json::json!({ "filePath": file_path }))
            .map_err(|e| e.to_string())
    }
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("document-opener")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "DocumentOpenerPlugin")?;
                _app.manage(DocumentOpener { handle });
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn open_document_with_system(app: AppHandle, file_path: String) -> Result<(), String> {
    app.state::<DocumentOpener>().open_document(file_path)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn open_document_with_system(_app: AppHandle, _file_path: String) -> Result<(), String> {
    Err("This command is Android-only".to_string())
}
