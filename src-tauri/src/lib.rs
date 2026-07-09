mod commands;
mod db;
mod video_server;

use commands::{plans::*, schedule::*, sessions::*, settings::*, stats::*, videos::*};
use db::AppState;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::str::FromStr;
use tauri::Manager;

/// On Windows: if a `.portable` file sits next to the exe, store data in `<exe-dir>/data/`
/// instead of the system AppData folder. This enables zero-install portable mode.
fn portable_data_dir(default: std::path::PathBuf) -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                if dir.join(".portable").exists() {
                    return dir.join("data");
                }
            }
        }
    }
    default
}

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
        .map(|e| DirEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            path: e.path().to_string_lossy().into_owned(),
        })
        .collect();
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
fn get_video_server_port() -> u16 {
    video_server::get_port()
}

#[tauri::command]
fn check_storage_accessible() -> bool {
    std::fs::read_dir("/storage/emulated/0")
        .map(|_| true)
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let data_dir = portable_data_dir(
                app.path().app_data_dir().expect("Failed to resolve app data directory"),
            );
            std::fs::create_dir_all(&data_dir)?;

            let db_path = data_dir.join("video_plan.db");
            let db_url = format!("sqlite:{}", db_path.to_string_lossy());

            let pool = tauri::async_runtime::block_on(async move {
                let options = SqliteConnectOptions::from_str(&db_url)
                    .expect("Invalid DB URL")
                    .create_if_missing(true);

                let pool = SqlitePool::connect_with(options)
                    .await
                    .expect("Failed to open database");

                sqlx::migrate!("./migrations")
                    .run(&pool)
                    .await
                    .expect("Failed to run migrations");

                // Start local video HTTP server (needed for Android Range-request support)
                video_server::start().await;

                pool
            });

            app.manage(AppState { db: pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_storage_accessible,
            list_dir,
            get_video_server_port,
            get_setting,
            set_setting,
            add_plan,
            list_plans,
            delete_plan,
            rescan_plan,
            activate_plan,
            deactivate_plan,
            list_videos_for_plan,
            update_video_status,
            update_video_progress,
            set_video_duration,
            record_watch_session,
            get_today_watched_seconds,
            check_daily_limit,
            get_today_schedule,
            get_daily_stats,
            get_overall_stats,
            set_plan_priority,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
