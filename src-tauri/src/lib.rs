mod cast;
mod commands;
mod db;
mod thumbnail_cache;
mod video_server;

use cast::{cast_pause, cast_resume, cast_stop, cast_switch_video, discover_renderers, get_cast_state, start_cast, CastState};
use commands::{plans::*, schedule::*, sessions::*, settings::*, stats::*, videos::*};
use db::AppState;
use thumbnail_cache::{cache_thumbnail, get_cached_thumbnail};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::str::FromStr;
use tauri::Manager;

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

                video_server::start().await;

                pool
            });

            app.manage(AppState { db: pool, tick_lock: tokio::sync::Mutex::new(()) });
            app.manage(CastState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_storage_accessible,
            list_dir,
            get_video_server_port,
            get_cached_thumbnail,
            cache_thumbnail,
            get_setting,
            set_setting,
            add_plan,
            list_plans,
            delete_plan,
            rescan_plan,
            activate_plan,
            deactivate_plan,
            update_plan_media_settings,
            list_background_audio,
            get_recent_background_tracks,
            delete_background_track,
            set_plan_background,
            set_plan_protected,
            list_videos_for_plan,
            update_video_status,
            mark_video_watched_earlier,
            list_completed_for_cleanup,
            cleanup_videos,
            update_video_progress,
            set_video_duration,
            record_watch_tick,
            get_today_watched_seconds,
            get_today_audio_seconds,
            get_continuous_watch_seconds,
            get_today_distribution,
            record_background_play,
            check_daily_limit,
            get_today_schedule,
            get_daily_stats,
            get_today_hourly_stats,
            get_plan_time_stats,
            get_overall_stats,
            set_plan_priority,
            discover_renderers,
            start_cast,
            cast_pause,
            cast_resume,
            cast_stop,
            cast_switch_video,
            get_cast_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
