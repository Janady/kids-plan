use crate::db::AppState;
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::State;
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "m2ts", "mts", "mpg",
    "mpeg", "3gp",
];

// Android SAF "primary" document tree URI → real path on /storage/emulated/0
fn normalize_folder_path(raw: &str) -> String {
    const SAF_PREFIX: &str =
        "content://com.android.externalstorage.documents/tree/primary%3A";
    if let Some(rest) = raw.strip_prefix(SAF_PREFIX) {
        let decoded = rest.replace("%2F", "/").replace("%20", " ").replace("%3A", ":");
        if decoded.is_empty() {
            "/storage/emulated/0".to_string()
        } else {
            format!("/storage/emulated/0/{}", decoded)
        }
    } else {
        raw.to_string()
    }
}

fn is_video_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| VIDEO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn now_str() -> String {
    Local::now().to_rfc3339()
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Plan {
    pub id: i64,
    pub name: String,
    pub folder_path: String,
    pub status: String,
    pub episodes_per_day: i64,
    pub daily_schedule_active: i64,
    pub priority: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlanWithCounts {
    pub id: i64,
    pub name: String,
    pub folder_path: String,
    pub status: String,
    pub episodes_per_day: i64,
    pub daily_schedule_active: i64,
    pub priority: i64,
    pub is_locked_by_priority: bool,
    pub video_count: i64,
    pub watched_count: i64,
    pub next_video_id: Option<i64>,
    pub next_video_title: Option<String>,
    pub next_video_status: Option<String>,
    pub next_video_progress: Option<i64>,
    pub next_video_duration: Option<i64>,
    pub next_video_sort_order: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(sqlx::FromRow)]
struct PlanRow {
    id: i64,
    name: String,
    folder_path: String,
    status: String,
    episodes_per_day: i64,
    daily_schedule_active: i64,
    priority: i64,
    video_count: i64,
    watched_count: i64,
    created_at: String,
    updated_at: String,
}

#[derive(sqlx::FromRow)]
struct NextVideoRow {
    id: i64,
    title: String,
    status: String,
    progress_seconds: i64,
    duration_seconds: Option<i64>,
    sort_order: i64,
}

async fn fetch_next_video(
    db: &sqlx::SqlitePool,
    plan_id: i64,
    plan_status: &str,
) -> Result<Option<NextVideoRow>, String> {
    if plan_status == "completed" {
        sqlx::query_as(
            "SELECT id, title, status, progress_seconds, duration_seconds, sort_order
             FROM videos WHERE plan_id = ? ORDER BY sort_order DESC LIMIT 1",
        )
        .bind(plan_id)
        .fetch_optional(db)
        .await
        .map_err(|e| e.to_string())
    } else {
        sqlx::query_as(
            "SELECT id, title, status, progress_seconds, duration_seconds, sort_order
             FROM videos WHERE plan_id = ? AND status IN ('watching', 'not_watched')
             ORDER BY CASE status WHEN 'watching' THEN 0 ELSE 1 END, sort_order ASC LIMIT 1",
        )
        .bind(plan_id)
        .fetch_optional(db)
        .await
        .map_err(|e| e.to_string())
    }
}

fn build_plan_with_counts(r: PlanRow, next: Option<NextVideoRow>, is_locked_by_priority: bool) -> PlanWithCounts {
    PlanWithCounts {
        id: r.id,
        name: r.name,
        folder_path: r.folder_path,
        status: r.status,
        episodes_per_day: r.episodes_per_day,
        daily_schedule_active: r.daily_schedule_active,
        priority: r.priority,
        is_locked_by_priority,
        video_count: r.video_count,
        watched_count: r.watched_count,
        next_video_id: next.as_ref().map(|n| n.id),
        next_video_title: next.as_ref().map(|n| n.title.clone()),
        next_video_status: next.as_ref().map(|n| n.status.clone()),
        next_video_progress: next.as_ref().map(|n| n.progress_seconds),
        next_video_duration: next.as_ref().and_then(|n| n.duration_seconds),
        next_video_sort_order: next.as_ref().map(|n| n.sort_order),
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

fn scan_videos(folder: &std::path::Path) -> Result<Vec<(String, String, i64)>, String> {
    // Fail early with a clear error instead of silently returning empty on permission denied
    std::fs::read_dir(folder).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "没有读取此文件夹的权限，请在 系统设置 › 应用 › 特殊权限 › 所有文件访问权限 中开启本应用的权限".to_string()
        } else {
            format!("无法读取文件夹：{e}")
        }
    })?;

    let mut entries: Vec<std::path::PathBuf> = WalkDir::new(folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_video_file(e.path()))
        .map(|e| e.path().to_path_buf())
        .collect();
    entries.sort();
    Ok(entries
        .into_iter()
        .enumerate()
        .map(|(i, p)| {
            let title = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();
            (p.to_string_lossy().into_owned(), title, i as i64)
        })
        .collect())
}

const PLAN_SELECT: &str =
    "SELECT p.id, p.name, p.folder_path, p.status, p.episodes_per_day, p.daily_schedule_active,
            p.priority, p.created_at, p.updated_at,
            COUNT(v.id) as video_count,
            COALESCE(SUM(CASE WHEN v.status = 'watched' THEN 1 ELSE 0 END), 0) as watched_count
     FROM plans p LEFT JOIN videos v ON v.plan_id = p.id";

#[tauri::command]
pub async fn add_plan(
    state: State<'_, AppState>,
    name: Option<String>,
    folder_path: String,
) -> Result<PlanWithCounts, String> {
    let folder_path_str = normalize_folder_path(&folder_path);

    let folder = std::path::Path::new(&folder_path_str);
    let plan_name = name.unwrap_or_else(|| {
        folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("New Plan")
            .to_string()
    });

    let videos = scan_videos(folder)?;
    let now = now_str();
    let mut tx_db = state.db.begin().await.map_err(|e| e.to_string())?;

    let plan_id: i64 = sqlx::query_scalar(
        "INSERT INTO plans (name, folder_path, status, created_at, updated_at)
         VALUES (?, ?, 'not_started', ?, ?) RETURNING id",
    )
    .bind(&plan_name)
    .bind(&folder_path_str)
    .bind(&now)
    .bind(&now)
    .fetch_one(&mut *tx_db)
    .await
    .map_err(|e| e.to_string())?;

    for (file_path, title, sort_order) in &videos {
        sqlx::query(
            "INSERT OR IGNORE INTO videos
             (plan_id, file_path, title, status, progress_seconds, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, 'not_watched', 0, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(file_path)
        .bind(title)
        .bind(sort_order)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx_db)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx_db.commit().await.map_err(|e| e.to_string())?;

    let next = fetch_next_video(&state.db, plan_id, "not_started").await?;
    let video_count = videos.len() as i64;
    Ok(PlanWithCounts {
        id: plan_id,
        name: plan_name,
        folder_path: folder_path_str,
        status: "not_started".to_string(),
        episodes_per_day: 1,
        daily_schedule_active: 0,
        priority: 0,
        is_locked_by_priority: false,
        video_count,
        watched_count: 0,
        next_video_id: next.as_ref().map(|n| n.id),
        next_video_title: next.as_ref().map(|n| n.title.clone()),
        next_video_status: next.as_ref().map(|n| n.status.clone()),
        next_video_progress: next.as_ref().map(|n| n.progress_seconds),
        next_video_duration: next.as_ref().and_then(|n| n.duration_seconds),
        next_video_sort_order: next.as_ref().map(|n| n.sort_order),
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub async fn list_plans(state: State<'_, AppState>) -> Result<Vec<PlanWithCounts>, String> {
    let sql = format!(
        "{} GROUP BY p.id ORDER BY
         CASE p.status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
         p.daily_schedule_active DESC, p.created_at DESC",
        PLAN_SELECT
    );
    let rows: Vec<PlanRow> = sqlx::query_as(&sql)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Compute the highest priority among incomplete plans — used to lock lower-priority plans
    let max_blocking = rows
        .iter()
        .filter(|r| r.priority > 0 && r.status != "completed")
        .map(|r| r.priority)
        .max()
        .unwrap_or(0);

    let mut results = Vec::with_capacity(rows.len());
    for r in rows {
        let is_locked = max_blocking > 0 && r.priority < max_blocking;
        let next = fetch_next_video(&state.db, r.id, &r.status).await?;
        results.push(build_plan_with_counts(r, next, is_locked));
    }
    Ok(results)
}

#[tauri::command]
pub async fn delete_plan(state: State<'_, AppState>, plan_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM plans WHERE id = ?")
        .bind(plan_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rescan_plan(
    state: State<'_, AppState>,
    plan_id: i64,
) -> Result<PlanWithCounts, String> {
    let plan: Plan = sqlx::query_as("SELECT * FROM plans WHERE id = ?")
        .bind(plan_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let real_path = normalize_folder_path(&plan.folder_path);
    let folder = std::path::Path::new(&real_path);
    let disk_videos = scan_videos(folder)?;
    let disk_paths: std::collections::HashSet<String> =
        disk_videos.iter().map(|(p, _, _)| p.clone()).collect();

    let now = now_str();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    let existing: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, file_path FROM videos WHERE plan_id = ?")
            .bind(plan_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    for (vid_id, vid_path) in &existing {
        if !disk_paths.contains(vid_path) {
            sqlx::query("DELETE FROM videos WHERE id = ?")
                .bind(vid_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    let existing_paths: std::collections::HashSet<String> =
        existing.into_iter().map(|(_, p)| p).collect();

    for (file_path, title, sort_order) in &disk_videos {
        if !existing_paths.contains(file_path) {
            sqlx::query(
                "INSERT OR IGNORE INTO videos
                 (plan_id, file_path, title, status, progress_seconds, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, 'not_watched', 0, ?, ?, ?)",
            )
            .bind(plan_id)
            .bind(file_path)
            .bind(title)
            .bind(sort_order)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    let row: PlanRow = sqlx::query_as(&format!(
        "{} WHERE p.id = ? GROUP BY p.id",
        PLAN_SELECT
    ))
    .bind(plan_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let next = fetch_next_video(&state.db, row.id, &row.status).await?;
    Ok(build_plan_with_counts(row, next, false))
}

#[tauri::command]
pub async fn activate_plan(
    state: State<'_, AppState>,
    plan_id: i64,
    episodes_per_day: i64,
) -> Result<(), String> {
    let now = now_str();
    sqlx::query(
        "UPDATE plans SET daily_schedule_active = 1, episodes_per_day = ?, updated_at = ? WHERE id = ?",
    )
    .bind(episodes_per_day)
    .bind(&now)
    .bind(plan_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn deactivate_plan(state: State<'_, AppState>, plan_id: i64) -> Result<(), String> {
    let now = now_str();
    sqlx::query("UPDATE plans SET daily_schedule_active = 0, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(plan_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_plan_priority(
    state: State<'_, AppState>,
    plan_id: i64,
    priority: i64,
) -> Result<(), String> {
    sqlx::query("UPDATE plans SET priority = ?, updated_at = ? WHERE id = ?")
        .bind(priority)
        .bind(now_str())
        .bind(plan_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
