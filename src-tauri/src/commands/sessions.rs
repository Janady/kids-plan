use crate::db::AppState;
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::State;

fn today_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WatchSessionInput {
    pub video_id: i64,
    pub seconds_watched: i64,
    pub started_at: String,
    pub ended_at: String,
}

#[tauri::command]
pub async fn record_watch_session(
    state: State<'_, AppState>,
    session: WatchSessionInput,
) -> Result<(), String> {
    if session.seconds_watched <= 0 {
        return Ok(());
    }
    let date_key = today_key();
    sqlx::query(
        "INSERT INTO watch_sessions (video_id, date_key, seconds_watched, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(session.video_id)
    .bind(&date_key)
    .bind(session.seconds_watched)
    .bind(&session.started_at)
    .bind(&session.ended_at)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_today_watched_seconds(state: State<'_, AppState>) -> Result<i64, String> {
    let date_key = today_key();
    let (total,): (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(seconds_watched), 0) FROM watch_sessions WHERE date_key = ?",
    )
    .bind(&date_key)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(total)
}

#[tauri::command]
pub async fn check_daily_limit(state: State<'_, AppState>) -> Result<bool, String> {
    let today_total: i64 = {
        let date_key = today_key();
        let (t,): (i64,) = sqlx::query_as(
            "SELECT COALESCE(SUM(seconds_watched), 0) FROM watch_sessions WHERE date_key = ?",
        )
        .bind(&date_key)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;
        t
    };

    let limit_row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'daily_limit_seconds'")
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    let limit: i64 = limit_row
        .and_then(|(v,)| v.parse().ok())
        .unwrap_or(3600);

    Ok(today_total >= limit)
}
