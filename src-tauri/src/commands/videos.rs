use crate::db::AppState;
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::State;

fn now_str() -> String {
    Local::now().to_rfc3339()
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Video {
    pub id: i64,
    pub plan_id: i64,
    pub file_path: String,
    pub title: String,
    pub duration_seconds: Option<i64>,
    pub status: String,
    pub progress_seconds: i64,
    pub sort_order: i64,
    pub updated_at: String,
}

#[tauri::command]
pub async fn list_videos_for_plan(
    state: State<'_, AppState>,
    plan_id: i64,
) -> Result<Vec<Video>, String> {
    let videos: Vec<Video> = sqlx::query_as(
        "SELECT id, plan_id, file_path, title, duration_seconds, status,
                progress_seconds, sort_order, updated_at
         FROM videos
         WHERE plan_id = ?
         ORDER BY
             CASE status
                 WHEN 'watching' THEN 0
                 WHEN 'not_watched' THEN 1
                 WHEN 'watched' THEN 2
                 ELSE 3
             END,
             sort_order ASC",
    )
    .bind(plan_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(videos)
}

#[tauri::command]
pub async fn update_video_status(
    state: State<'_, AppState>,
    video_id: i64,
    status: String,
) -> Result<Video, String> {
    let now = now_str();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("UPDATE videos SET status = ?, updated_at = ? WHERE id = ?")
        .bind(&status)
        .bind(&now)
        .bind(video_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let (plan_id,): (i64,) = sqlx::query_as("SELECT plan_id FROM videos WHERE id = ?")
        .bind(video_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let (total, watched, not_watched): (i64, i64, i64) = sqlx::query_as(
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN status = 'watched' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'not_watched' THEN 1 ELSE 0 END), 0)
         FROM videos WHERE plan_id = ?",
    )
    .bind(plan_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let plan_status = if total > 0 && watched == total {
        "completed"
    } else if total > 0 && not_watched == total {
        "not_started"
    } else {
        "in_progress"
    };

    sqlx::query("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?")
        .bind(plan_status)
        .bind(&now)
        .bind(plan_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    let video: Video = sqlx::query_as(
        "SELECT id, plan_id, file_path, title, duration_seconds, status,
                progress_seconds, sort_order, updated_at
         FROM videos WHERE id = ?",
    )
    .bind(video_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(video)
}

#[tauri::command]
pub async fn update_video_progress(
    state: State<'_, AppState>,
    video_id: i64,
    progress_seconds: i64,
) -> Result<(), String> {
    let now = now_str();
    sqlx::query("UPDATE videos SET progress_seconds = ?, updated_at = ? WHERE id = ?")
        .bind(progress_seconds)
        .bind(&now)
        .bind(video_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_video_duration(
    state: State<'_, AppState>,
    video_id: i64,
    duration_seconds: i64,
) -> Result<(), String> {
    let now = now_str();
    sqlx::query("UPDATE videos SET duration_seconds = ?, updated_at = ? WHERE id = ?")
        .bind(duration_seconds)
        .bind(&now)
        .bind(video_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
