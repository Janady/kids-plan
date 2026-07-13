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
    pub media_type: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn list_videos_for_plan(
    state: State<'_, AppState>,
    plan_id: i64,
) -> Result<Vec<Video>, String> {
    let videos: Vec<Video> = sqlx::query_as(
        "SELECT id, plan_id, file_path, title, duration_seconds, status,
                progress_seconds, sort_order, media_type, updated_at
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

// Recompute and persist a plan's overall status from its videos.
// Background-music audio is excluded so a mixed plan can still reach "completed".
async fn recompute_plan_status(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    plan_id: i64,
    now: &str,
) -> Result<(), String> {
    let (is_background,): (i64,) = sqlx::query_as("SELECT is_background FROM plans WHERE id = ?")
        .bind(plan_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;

    let (total, watched, not_watched): (i64, i64, i64) = sqlx::query_as(
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN status = 'watched' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'not_watched' THEN 1 ELSE 0 END), 0)
         FROM videos
         WHERE plan_id = ? AND NOT (? = 1 AND media_type = 'audio')",
    )
    .bind(plan_id)
    .bind(is_background)
    .fetch_one(&mut **tx)
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
        .bind(now)
        .bind(plan_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn fetch_video(db: &sqlx::SqlitePool, video_id: i64) -> Result<Video, String> {
    sqlx::query_as(
        "SELECT id, plan_id, file_path, title, duration_seconds, status,
                progress_seconds, sort_order, media_type, updated_at
         FROM videos WHERE id = ?",
    )
    .bind(video_id)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())
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

    recompute_plan_status(&mut tx, plan_id, &now).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    fetch_video(&state.db, video_id).await
}

// Mark a video as watched *without* counting toward today's quota.
// Used for content the user already watched elsewhere: it's removed from the
// pending list and counts toward plan completion, but its updated_at is set to
// a sentinel past date so get_today_schedule won't treat it as "done today".
#[tauri::command]
pub async fn mark_video_watched_earlier(
    state: State<'_, AppState>,
    video_id: i64,
) -> Result<Video, String> {
    let now = now_str();
    // A fixed past timestamp — never matches date('now','localtime')
    const PAST: &str = "1970-01-01T00:00:00+00:00";
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("UPDATE videos SET status = 'watched', updated_at = ? WHERE id = ?")
        .bind(PAST)
        .bind(video_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let (plan_id,): (i64,) = sqlx::query_as("SELECT plan_id FROM videos WHERE id = ?")
        .bind(video_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    recompute_plan_status(&mut tx, plan_id, &now).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    fetch_video(&state.db, video_id).await
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
