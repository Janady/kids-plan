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
    pub required_reps: i64,
    pub completed_reps: i64,
    pub last_rep_date: Option<String>,
    pub updated_at: String,
    pub is_bg_track: i64, // 1 = explicitly selected as background music (see set_video_bg_track)
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
                progress_seconds, sort_order, media_type, required_reps, completed_reps, last_rep_date, updated_at, is_bg_track
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
// A plan can only be "completed" once every day's blank-practice minutes is 0 —
// non-zero blank practice is a recurring daily task with no end state, so a
// plan that still asks for it can never be considered fully done.
pub(crate) async fn recompute_plan_status(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    plan_id: i64,
    now: &str,
) -> Result<(), String> {
    let (is_background, weekly_schedule): (i64, String) =
        sqlx::query_as("SELECT is_background, weekly_schedule FROM plans WHERE id = ?")
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
         WHERE plan_id = ? AND NOT (? = 1 AND media_type = 'audio') AND media_type != 'document'",
    )
    .bind(plan_id)
    .bind(is_background)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;

    let blank_all_zero = crate::commands::plans::weekly_blank_all_zero(&weekly_schedule);
    let plan_status = if total > 0 && watched == total && blank_all_zero {
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
                progress_seconds, sort_order, media_type, required_reps, completed_reps, last_rep_date, updated_at, is_bg_track
         FROM videos WHERE id = ?",
    )
    .bind(video_id)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())?;
    v.file_exists = file_present(&v.file_path);
    Ok(v)
}

// Single source of truth for deriving `status` from required/completed reps.
// required <= completed (including required == 0) always means "watched" —
// nothing left to do. Otherwise, if the row was "watched" only because the
// requirement used to be lower/zero, it must be downgraded now that more
// reps are required: "watching" if at least one rep was already banked,
// "not_watched" if none were. A row that wasn't "watched" is left as-is —
// increasing its requirement shouldn't disturb in-progress playback state.
fn derive_reps_status(required_reps: i64, completed_reps: i64, prior_status: &str) -> String {
    if completed_reps >= required_reps {
        "watched".to_string()
    } else if prior_status == "watched" {
        if completed_reps > 0 { "watching".to_string() } else { "not_watched".to_string() }
    } else {
        prior_status.to_string()
    }
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
    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // completed_reps is also forced to required_reps so this video doesn't
    // reappear as "still needs more reps" the next time it's evaluated.
    sqlx::query(
        "UPDATE videos SET status = 'watched', completed_reps = required_reps,
                last_rep_date = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&today)
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

// Adjust how many times a video must be played to count as complete.
// Clamped at 0 (never negative). If the new requirement is already met by
// completed_reps — including being lowered all the way to 0 — the video is
// marked complete immediately.
#[tauri::command]
pub async fn adjust_video_reps(
    state: State<'_, AppState>,
    video_id: i64,
    delta: i64,
) -> Result<Video, String> {
    let now = now_str();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    let (required_reps, completed_reps): (i64, i64) = sqlx::query_as(
        "SELECT required_reps, completed_reps FROM videos WHERE id = ?",
    )
    .bind(video_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let new_required = (required_reps + delta).max(0);
    let (plan_id, status): (i64, String) = sqlx::query_as(
        "SELECT plan_id, status FROM videos WHERE id = ?",
    )
    .bind(video_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let new_status = derive_reps_status(new_required, completed_reps, &status);

    sqlx::query("UPDATE videos SET required_reps = ?, status = ?, updated_at = ? WHERE id = ?")
        .bind(new_required)
        .bind(&new_status)
        .bind(&now)
        .bind(video_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    recompute_plan_status(&mut tx, plan_id, &now).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    fetch_video(&state.db, video_id).await
}

// Bulk version of adjust_video_reps for every video in a plan, including
// already-'watched' ones — otherwise a completed video's required_reps could
// never be raised again, and a fully-completed plan's status would never be
// re-derived when reps change (see recompute_plan_status below).
#[tauri::command]
pub async fn batch_adjust_plan_reps(
    state: State<'_, AppState>,
    plan_id: i64,
    delta: i64,
) -> Result<(), String> {
    let now = now_str();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    let rows: Vec<(i64, i64, i64, String)> = sqlx::query_as(
        "SELECT id, required_reps, completed_reps, status FROM videos WHERE plan_id = ?",
    )
    .bind(plan_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    for (id, required_reps, completed_reps, status) in rows {
        let new_required = (required_reps + delta).max(0);
        let new_status = derive_reps_status(new_required, completed_reps, &status);
        sqlx::query("UPDATE videos SET required_reps = ?, status = ?, updated_at = ? WHERE id = ?")
            .bind(new_required)
            .bind(&new_status)
            .bind(&now)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    recompute_plan_status(&mut tx, plan_id, &now).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

// Credit one playback rep for a video. At most one rep is credited per
// calendar day, so replaying the same video repeatedly in one sitting can't
// satisfy a multi-rep requirement in a single day. Once completed_reps
// reaches required_reps the video is marked 'watched'; otherwise it stays
// 'watching' so it keeps showing up in today's pending list until the
// requirement is met (potentially across several days).
#[tauri::command]
pub async fn complete_video_rep(state: State<'_, AppState>, video_id: i64) -> Result<Video, String> {
    let now = now_str();
    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    let (required_reps, completed_reps, last_rep_date): (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT required_reps, completed_reps, last_rep_date FROM videos WHERE id = ?",
    )
    .bind(video_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let already_credited_today = last_rep_date.as_deref() == Some(today.as_str());
    let new_completed = if already_credited_today {
        completed_reps
    } else {
        (completed_reps + 1).min(required_reps)
    };
    let new_status = if new_completed >= required_reps { "watched" } else { "watching" };

    sqlx::query(
        "UPDATE videos SET completed_reps = ?, last_rep_date = ?, status = ?,
                progress_seconds = 0, updated_at = ? WHERE id = ?",
    )
    .bind(new_completed)
    .bind(&today)
    .bind(new_status)
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

// Manually include/exclude a single audio file from its plan's background
// music, overriding the "use every audio file" default (see
// plans::resolve_bg_track_ids for how this combines with is_background).
#[tauri::command]
pub async fn set_video_bg_track(
    state: State<'_, AppState>,
    video_id: i64,
    is_bg_track: i64,
) -> Result<(), String> {
    sqlx::query("UPDATE videos SET is_bg_track = ?, updated_at = ? WHERE id = ?")
        .bind(is_bg_track)
        .bind(now_str())
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
