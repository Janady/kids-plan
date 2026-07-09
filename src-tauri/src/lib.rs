mod commands;
mod db;

use commands::{plans::*, schedule::*, sessions::*, settings::*, stats::*, videos::*};
use db::AppState;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::str::FromStr;
use tauri::Manager;

#[tauri::command]
fn check_storage_accessible() -> bool {
    std::path::Path::new("/storage/emulated/0").is_dir()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
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

                pool
            });

            app.manage(AppState { db: pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_storage_accessible,
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
