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
    // Not a DB column — filled after query by checking the disk.
    // false means the file was cleaned up (or is otherwise missing).
    #[sqlx(default)]
    pub file_exists: bool,
}

// Check whether a video's file is present on disk (Android SAF paths normalized).
fn file_present(file_path: &str) -> bool {
    let real = crate::commands::plans::normalize_folder_path(file_path);
    std::path::Path::new(&real).exists()
}

#[tauri::command]
pub async fn list_videos_for_plan(
    state: State<'_, AppState>,
    plan_id: i64,
) -> Result<Vec<Video>, String> {
    let mut videos: Vec<Video> = sqlx::query_as(
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

    for v in &mut videos {
        v.file_exists = file_present(&v.file_path);
    }
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
    let mut v: Video = sqlx::query_as(
        "SELECT id, plan_id, file_path, title, duration_seconds, status,
                progress_seconds, sort_order, media_type, updated_at
         FROM videos WHERE id = ?",
    )
    .bind(video_id)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())?;
    v.file_exists = file_present(&v.file_path);
    Ok(v)
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

// ─── Completed-video cleanup (free disk space) ───────────────────────────────

#[derive(Serialize)]
pub struct CleanupVideo {
    pub id: i64,
    pub title: String,
    pub file_path: String,
    pub file_size: i64,
}

#[derive(Serialize)]
pub struct CleanupPlan {
    pub plan_id: i64,
    pub plan_name: String,
    pub videos: Vec<CleanupVideo>,
    pub total_size: i64,
}

#[derive(Serialize)]
pub struct CleanupResult {
    pub deleted: i64,          // files actually removed from disk
    pub freed_bytes: i64,
    pub not_found: i64,        // record's path didn't resolve to an existing file
    pub failed: Vec<String>,   // "<title>: <reason>" for files that couldn't be deleted
}

// List completed videos whose files still exist on disk, grouped by plan.
// Audio and already-cleared (missing) files are excluded.
#[tauri::command]
pub async fn list_completed_for_cleanup(
    state: State<'_, AppState>,
) -> Result<Vec<CleanupPlan>, String> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        plan_id: i64,
        plan_name: String,
        title: String,
        file_path: String,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT v.id, v.plan_id, p.name AS plan_name, v.title, v.file_path
         FROM videos v
         JOIN plans p ON p.id = v.plan_id
         WHERE v.status = 'watched' AND v.media_type = 'video' AND p.is_protected = 0
         ORDER BY p.updated_at DESC, v.sort_order ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let mut plans: Vec<CleanupPlan> = Vec::new();
    for row in rows {
        let real = crate::commands::plans::normalize_folder_path(&row.file_path);
        let size = match std::fs::metadata(&real) {
            Ok(m) => m.len() as i64,
            Err(_) => continue, // file already gone (cleaned up) → skip
        };

        let entry = match plans.iter_mut().find(|p| p.plan_id == row.plan_id) {
            Some(p) => p,
            None => {
                plans.push(CleanupPlan {
                    plan_id: row.plan_id,
                    plan_name: row.plan_name.clone(),
                    videos: Vec::new(),
                    total_size: 0,
                });
                plans.last_mut().unwrap()
            }
        };
        entry.total_size += size;
        entry.videos.push(CleanupVideo {
            id: row.id,
            title: row.title,
            file_path: row.file_path,
            file_size: size,
        });
    }

    Ok(plans)
}

// Delete the disk files of the given completed videos. DB records are kept
// (they stay "watched"); only the files are removed. Non-watched videos are
// refused. A missing file counts as success (already freed).
#[tauri::command]
pub async fn cleanup_videos(
    state: State<'_, AppState>,
    video_ids: Vec<i64>,
) -> Result<CleanupResult, String> {
    let mut deleted = 0i64;
    let mut freed_bytes = 0i64;
    let mut not_found = 0i64;
    let mut failed: Vec<String> = Vec::new();

    for id in video_ids {
        let row: Option<(String, String, String, i64)> = sqlx::query_as(
            "SELECT v.file_path, v.status, v.title, p.is_protected
             FROM videos v JOIN plans p ON p.id = v.plan_id WHERE v.id = ?",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        let (file_path, status, title, is_protected) = match row {
            Some(r) => r,
            None => continue,
        };
        if is_protected != 0 {
            failed.push(format!("{title}: 计划已受保护，跳过"));
            continue;
        }
        // Only completed videos may be cleaned up
        if status != "watched" {
            failed.push(format!("{title}: 未完成，跳过"));
            continue;
        }

        let real = crate::commands::plans::normalize_folder_path(&file_path);
        let path = std::path::Path::new(&real);

        // Report — but do NOT silently count a missing file as deleted, so the
        // UI reflects reality (this masked failures on Android before).
        if !path.exists() {
            not_found += 1;
            failed.push(format!("{title}: 未找到文件 {real}"));
            continue;
        }

        let size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
        match std::fs::remove_file(path) {
            Ok(_) => {
                deleted += 1;
                freed_bytes += size;
            }
            Err(e) => {
                failed.push(format!("{title}: {} ({real})", e.kind()));
            }
        }
    }

    Ok(CleanupResult { deleted, freed_bytes, not_found, failed })
}
