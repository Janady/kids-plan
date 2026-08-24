use crate::db::AppState;
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::State;
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "m2ts", "mts", "mpg",
    "mpeg", "3gp",
];

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "aac", "ogg", "opus", "wav", "m4a", "wma", "aiff",
];

pub(crate) fn normalize_folder_path(raw: &str) -> String {
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

fn is_audio_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
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
    pub scan_video: i64,
    pub scan_audio: i64,
    pub audio_role: String,
    pub is_background: i64, // 1 = audio files also appear in background player
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
    pub scan_video: i64,
    pub scan_audio: i64,
    pub audio_role: String,
    pub is_background: i64,
    pub is_locked_by_priority: bool,
    pub video_count: i64,
    pub audio_count: i64,
    pub watched_count: i64,
    pub next_video_id: Option<i64>,
    pub next_video_title: Option<String>,
    pub next_video_status: Option<String>,
    pub next_video_progress: Option<i64>,
    pub next_video_duration: Option<i64>,
    pub next_video_sort_order: Option<i64>,
    pub next_video_media_type: Option<String>,
    pub recent_videos: Vec<PlanPreviewVideo>,
    pub created_at: String,
    pub updated_at: String,
}

// Report returned after adding/rescanning a plan, so the UI can tell the user
// exactly what the scan found: how many files on disk, how many were newly added,
// and how many were skipped because another plan already owns them.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanReport {
    pub found: i64,        // media files discovered on disk
    pub added: i64,        // newly inserted into this plan
    pub skipped: i64,      // ignored — already owned by another plan
    pub skipped_names: Vec<String>, // titles of skipped files (capped)
    pub plan: PlanWithCounts,
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
    scan_video: i64,
    scan_audio: i64,
    audio_role: String,
    is_background: i64,
    video_count: i64,
    audio_count: i64,
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
    media_type: String,
}

/// Up to 3 media items nearest the current learning position, shown on the plan list.
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct PlanPreviewVideo {
    pub id: i64,
    pub title: String,
    pub status: String,
    pub progress_seconds: i64,
    pub duration_seconds: Option<i64>,
    pub sort_order: i64,
    pub media_type: String,
    pub file_path: String,
}

async fn fetch_next_video(
    db: &sqlx::SqlitePool,
    plan_id: i64,
    plan_status: &str,
) -> Result<Option<NextVideoRow>, String> {
    if plan_status == "completed" {
        sqlx::query_as(
            "SELECT id, title, status, progress_seconds, duration_seconds, sort_order, media_type
             FROM videos WHERE plan_id = ? ORDER BY sort_order DESC LIMIT 1",
        )
        .bind(plan_id)
        .fetch_optional(db)
        .await
        .map_err(|e| e.to_string())
    } else {
        sqlx::query_as(
            "SELECT id, title, status, progress_seconds, duration_seconds, sort_order, media_type
             FROM videos WHERE plan_id = ? AND status IN ('watching', 'not_watched')
             ORDER BY CASE status WHEN 'watching' THEN 0 ELSE 1 END, sort_order ASC LIMIT 1",
        )
        .bind(plan_id)
        .fetch_optional(db)
        .await
        .map_err(|e| e.to_string())
    }
}

async fn fetch_recent_videos(
    db: &sqlx::SqlitePool,
    plan_id: i64,
) -> Result<Vec<PlanPreviewVideo>, String> {
    let cursor: Option<i64> = sqlx::query_scalar(
        "SELECT sort_order FROM videos
         WHERE plan_id = ? AND status IN ('watching', 'not_watched')
         ORDER BY CASE status WHEN 'watching' THEN 0 ELSE 1 END, sort_order ASC
         LIMIT 1",
    )
    .bind(plan_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;

    let cursor = match cursor {
        Some(s) => s,
        None => sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_order), 0) FROM videos WHERE plan_id = ?",
        )
        .bind(plan_id)
        .fetch_one(db)
        .await
        .map_err(|e| e.to_string())?,
    };

    let mut videos: Vec<PlanPreviewVideo> = sqlx::query_as(
        "SELECT id, title, status, progress_seconds, duration_seconds, sort_order, media_type, file_path
         FROM videos
         WHERE plan_id = ?
         ORDER BY ABS(sort_order - ?), sort_order ASC
         LIMIT 3",
    )
    .bind(plan_id)
    .bind(cursor)
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;

    videos.sort_by_key(|v| v.sort_order);
    Ok(videos)
}

fn build_plan_with_counts(
    r: PlanRow,
    next: Option<NextVideoRow>,
    is_locked_by_priority: bool,
    recent_videos: Vec<PlanPreviewVideo>,
) -> PlanWithCounts {
    PlanWithCounts {
        id: r.id,
        name: r.name,
        folder_path: r.folder_path,
        status: r.status,
        episodes_per_day: r.episodes_per_day,
        daily_schedule_active: r.daily_schedule_active,
        priority: r.priority,
        scan_video: r.scan_video,
        scan_audio: r.scan_audio,
        audio_role: r.audio_role,
        is_background: r.is_background,
        is_locked_by_priority,
        video_count: r.video_count,
        audio_count: r.audio_count,
        watched_count: r.watched_count,
        next_video_id: next.as_ref().map(|n| n.id),
        next_video_title: next.as_ref().map(|n| n.title.clone()),
        next_video_status: next.as_ref().map(|n| n.status.clone()),
        next_video_progress: next.as_ref().map(|n| n.progress_seconds),
        next_video_duration: next.as_ref().and_then(|n| n.duration_seconds),
        next_video_sort_order: next.as_ref().map(|n| n.sort_order),
        next_video_media_type: next.as_ref().map(|n| n.media_type.clone()),
        recent_videos,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

// Natural comparison: digit runs compare as numbers, other runs as text.
// "1v1v1" < "1v2" < "1v2v1"; "2" < "10"; handles differing digit widths and
// leading zeros. When one is a prefix of the other, the shorter one sorts first.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    fn chunk(s: &str) -> Vec<(bool, String)> {
        let mut out: Vec<(bool, String)> = Vec::new();
        for c in s.chars() {
            let is_digit = c.is_ascii_digit();
            match out.last_mut() {
                Some((d, buf)) if *d == is_digit => buf.push(c),
                _ => out.push((is_digit, c.to_string())),
            }
        }
        out
    }
    let (ca, cb) = (chunk(a), chunk(b));
    for (x, y) in ca.iter().zip(cb.iter()) {
        let ord = match (x.0, y.0) {
            (true, true) => {
                // Compare numerically without parsing (avoids overflow, ignores leading zeros).
                let (xs, ys) = (x.1.trim_start_matches('0'), y.1.trim_start_matches('0'));
                xs.len().cmp(&ys.len()).then_with(|| xs.cmp(ys))
            }
            (false, false) => x.1.to_lowercase().cmp(&y.1.to_lowercase()),
            (true, false) => Ordering::Less, // a number sorts before text
            (false, true) => Ordering::Greater,
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    // Shared prefix: the shorter (fewer chunks / shorter string) comes first.
    ca.len().cmp(&cb.len()).then_with(|| a.len().cmp(&b.len()))
}

// Compare two paths component-by-component with natural ordering, so directory
// structure is preserved while files within a folder sort naturally.
fn natural_path_cmp(a: &std::path::Path, b: &std::path::Path) -> std::cmp::Ordering {
    let mut ac = a.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
    let mut bc = b.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
    loop {
        match (ac.next(), bc.next()) {
            (Some(x), Some(y)) => {
                let ord = natural_cmp(&x, &y);
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (None, None) => return std::cmp::Ordering::Equal,
        }
    }
}

// Returns (file_path, title, sort_order, media_type)
fn scan_media_files(
    folder: &std::path::Path,
    scan_video: bool,
    scan_audio: bool,
) -> Result<Vec<(String, String, i64, String)>, String> {
    std::fs::read_dir(folder).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "没有读取此文件夹的权限，请在 系统设置 › 应用 › 特殊权限 › 所有文件访问权限 中开启本应用的权限".to_string()
        } else {
            format!("无法读取文件夹：{e}")
        }
    })?;

    let mut entries: Vec<(std::path::PathBuf, String)> = WalkDir::new(folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let path = e.path().to_path_buf();
            if scan_video && is_video_file(&path) {
                Some((path, "video".to_string()))
            } else if scan_audio && is_audio_file(&path) {
                Some((path, "audio".to_string()))
            } else {
                None
            }
        })
        .collect();
    entries.sort_by(|a, b| natural_path_cmp(&a.0, &b.0));

    Ok(entries
        .into_iter()
        .enumerate()
        .map(|(i, (p, media_type))| {
            let title = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();
            (p.to_string_lossy().into_owned(), title, i as i64, media_type)
        })
        .collect())
}

const PLAN_SELECT: &str =
    "SELECT p.id, p.name, p.folder_path, p.status, p.episodes_per_day, p.daily_schedule_active,
            p.priority, p.scan_video, p.scan_audio, p.audio_role, p.is_background, p.created_at, p.updated_at,
            COUNT(CASE WHEN v.media_type = 'video' THEN 1 END) as video_count,
            COUNT(CASE WHEN v.media_type = 'audio' THEN 1 END) as audio_count,
            COALESCE(SUM(CASE WHEN v.status = 'watched' THEN 1 ELSE 0 END), 0) as watched_count
     FROM plans p LEFT JOIN videos v ON v.plan_id = p.id";

#[tauri::command]
pub async fn add_plan(
    state: State<'_, AppState>,
    name: Option<String>,
    folder_path: String,
    scan_video: Option<i64>,
    scan_audio: Option<i64>,
    audio_role: Option<String>,
) -> Result<ScanReport, String> {
    let folder_path_str = normalize_folder_path(&folder_path);

    let folder = std::path::Path::new(&folder_path_str);
    let plan_name = name.unwrap_or_else(|| {
        folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("New Plan")
            .to_string()
    });

    // Default: scan both audio and video
    let sv = scan_video.unwrap_or(1);
    let sa = scan_audio.unwrap_or(1);
    let ar = audio_role.unwrap_or_else(|| "plan".to_string());

    let media_files = scan_media_files(folder, sv != 0, sa != 0)?;
    let now = now_str();
    let mut tx_db = state.db.begin().await.map_err(|e| e.to_string())?;

    let plan_id: i64 = sqlx::query_scalar(
        "INSERT INTO plans (name, folder_path, status, scan_video, scan_audio, audio_role, is_background, created_at, updated_at)
         VALUES (?, ?, 'not_started', ?, ?, ?, 0, ?, ?) RETURNING id",
    )
    .bind(&plan_name)
    .bind(&folder_path_str)
    .bind(sv)
    .bind(sa)
    .bind(&ar)
    .bind(&now)
    .bind(&now)
    .fetch_one(&mut *tx_db)
    .await
    .map_err(|e| e.to_string())?;

    let mut skipped_names: Vec<String> = Vec::new();
    let mut added = 0i64;
    for (file_path, title, sort_order, media_type) in &media_files {
        let res = sqlx::query(
            "INSERT OR IGNORE INTO videos
             (plan_id, file_path, title, status, progress_seconds, sort_order, media_type, created_at, updated_at)
             VALUES (?, ?, ?, 'not_watched', 0, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(file_path)
        .bind(title)
        .bind(sort_order)
        .bind(media_type)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx_db)
        .await
        .map_err(|e| e.to_string())?;

        if res.rows_affected() == 0 {
            // UNIQUE(file_path) conflict → file already belongs to another plan
            if skipped_names.len() < 20 {
                skipped_names.push(title.clone());
            }
        } else {
            added += 1;
        }
    }
    let skipped = media_files.len() as i64 - added;

    tx_db.commit().await.map_err(|e| e.to_string())?;

    let next = if ar == "background" {
        None
    } else {
        fetch_next_video(&state.db, plan_id, "not_started").await?
    };

    // Counts reflect what actually landed in this plan (excludes skipped duplicates)
    let (video_count, audio_count): (i64, i64) = sqlx::query_as(
        "SELECT
            COUNT(CASE WHEN media_type = 'video' THEN 1 END),
            COUNT(CASE WHEN media_type = 'audio' THEN 1 END)
         FROM videos WHERE plan_id = ?",
    )
    .bind(plan_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let plan = PlanWithCounts {
        id: plan_id,
        name: plan_name,
        folder_path: folder_path_str,
        status: "not_started".to_string(),
        episodes_per_day: 1,
        daily_schedule_active: 0,
        priority: 0,
        scan_video: sv,
        scan_audio: sa,
        audio_role: ar,
        is_background: 0,
        is_locked_by_priority: false,
        video_count,
        audio_count,
        watched_count: 0,
        next_video_id: next.as_ref().map(|n| n.id),
        next_video_title: next.as_ref().map(|n| n.title.clone()),
        next_video_status: next.as_ref().map(|n| n.status.clone()),
        next_video_progress: next.as_ref().map(|n| n.progress_seconds),
        next_video_duration: next.as_ref().and_then(|n| n.duration_seconds),
        next_video_sort_order: next.as_ref().map(|n| n.sort_order),
        next_video_media_type: next.as_ref().map(|n| n.media_type.clone()),
        recent_videos: fetch_recent_videos(&state.db, plan_id).await?,
        created_at: now.clone(),
        updated_at: now,
    };

    Ok(ScanReport {
        found: media_files.len() as i64,
        added,
        skipped,
        skipped_names,
        plan,
    })
}

// Whether a plan still has mandatory work *today* that blocks lower-priority plans.
// Priority locking only concerns today's tasks: a plan blocks lower priorities
// only while it's in the daily schedule and its today quota isn't met yet.
// Plans not in the daily schedule generate no "today" tasks, so they never block.
async fn plan_blocks_today(db: &sqlx::SqlitePool, plan: &PlanRow) -> Result<bool, String> {
    if plan.priority == 0 || plan.daily_schedule_active == 0 {
        return Ok(false);
    }

    // Pending learning items. Background-music audio (is_background plans) is
    // consumed via the background player and never marked "watched", so it must
    // not count as pending work.
    let (pending,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM videos
         WHERE plan_id = ? AND status IN ('watching', 'not_watched')
           AND NOT (? = 1 AND media_type = 'audio')",
    )
    .bind(plan.id)
    .bind(plan.is_background)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())?;

    if pending == 0 {
        return Ok(false); // nothing left to learn
    }

    // Blocks only until today's quota is met
    let (today_done,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM videos
         WHERE plan_id = ? AND status = 'watched'
           AND substr(updated_at, 1, 10) = date('now', 'localtime')",
    )
    .bind(plan.id)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(today_done < plan.episodes_per_day)
}

#[tauri::command]
pub async fn list_plans(state: State<'_, AppState>) -> Result<Vec<PlanWithCounts>, String> {
    let sql = format!(
        "{} GROUP BY p.id ORDER BY p.updated_at DESC",
        PLAN_SELECT
    );
    let rows: Vec<PlanRow> = sqlx::query_as(&sql)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Highest priority among plans whose *today's* mandatory work is not yet done
    let mut max_blocking = 0i64;
    for r in &rows {
        if plan_blocks_today(&state.db, r).await? {
            max_blocking = max_blocking.max(r.priority);
        }
    }

    let mut results = Vec::with_capacity(rows.len());
    for r in rows {
        let is_locked = max_blocking > 0 && r.priority < max_blocking;
        let next = fetch_next_video(&state.db, r.id, &r.status).await?;
        let recent = fetch_recent_videos(&state.db, r.id).await?;
        results.push(build_plan_with_counts(r, next, is_locked, recent));
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
) -> Result<ScanReport, String> {
    let plan: Plan = sqlx::query_as("SELECT * FROM plans WHERE id = ?")
        .bind(plan_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let real_path = normalize_folder_path(&plan.folder_path);
    let folder = std::path::Path::new(&real_path);
    let disk_files = scan_media_files(folder, plan.scan_video != 0, plan.scan_audio != 0)?;
    let disk_paths: std::collections::HashSet<String> =
        disk_files.iter().map(|(p, _, _, _)| p.clone()).collect();

    let now = now_str();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    let existing: Vec<(i64, String, String)> =
        sqlx::query_as("SELECT id, file_path, status FROM videos WHERE plan_id = ?")
            .bind(plan_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    for (vid_id, vid_path, status) in &existing {
        // Keep watched records even if their file is gone — the file may have been
        // intentionally cleaned up to save space; we preserve completion history.
        if !disk_paths.contains(vid_path) && status != "watched" {
            sqlx::query("DELETE FROM videos WHERE id = ?")
                .bind(vid_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    let existing_paths: std::collections::HashSet<String> =
        existing.into_iter().map(|(_, p, _)| p).collect();

    let mut skipped_names: Vec<String> = Vec::new();
    for (file_path, title, sort_order, media_type) in &disk_files {
        if existing_paths.contains(file_path) {
            continue; // already in this plan
        }
        let res = sqlx::query(
            "INSERT OR IGNORE INTO videos
             (plan_id, file_path, title, status, progress_seconds, sort_order, media_type, created_at, updated_at)
             VALUES (?, ?, ?, 'not_watched', 0, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(file_path)
        .bind(title)
        .bind(sort_order)
        .bind(media_type)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        if res.rows_affected() == 0 && skipped_names.len() < 20 {
            // owned by another plan (UNIQUE file_path conflict)
            skipped_names.push(title.clone());
        }
    }

    // Re-number every row present on disk to the freshly-computed natural order,
    // so files inserted in the middle (e.g. "1.5.mp4") re-flow correctly and any
    // previously-wrong ordering is fixed. Rows whose file is gone (kept watched
    // history) retain their old sort_order.
    for (file_path, _title, sort_order, _media_type) in &disk_files {
        sqlx::query("UPDATE videos SET sort_order = ? WHERE plan_id = ? AND file_path = ?")
            .bind(sort_order)
            .bind(plan_id)
            .bind(file_path)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
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

    // How many of the disk files are actually owned by *this* plan now
    let owned_here: i64 = {
        let mut n = 0i64;
        for (fp, _, _, _) in &disk_files {
            let (c,): (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM videos WHERE plan_id = ? AND file_path = ?",
            )
            .bind(plan_id)
            .bind(fp)
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;
            n += c;
        }
        n
    };

    let found = disk_files.len() as i64;
    let skipped = found - owned_here;

    let next = fetch_next_video(&state.db, row.id, &row.status).await?;
    let recent = fetch_recent_videos(&state.db, row.id).await?;
    let plan = build_plan_with_counts(row, next, false, recent);
    Ok(ScanReport {
        found,
        added: owned_here,
        skipped,
        skipped_names,
        plan,
    })
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

#[tauri::command]
pub async fn update_plan_media_settings(
    state: State<'_, AppState>,
    plan_id: i64,
    scan_video: i64,
    scan_audio: i64,
    audio_role: String,
) -> Result<PlanWithCounts, String> {
    let now = now_str();
    sqlx::query(
        "UPDATE plans SET scan_video = ?, scan_audio = ?, audio_role = ?, updated_at = ? WHERE id = ?",
    )
    .bind(scan_video)
    .bind(scan_audio)
    .bind(&audio_role)
    .bind(&now)
    .bind(plan_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rescan_plan(state, plan_id).await?.plan)
}

// ─── Background audio ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct BackgroundTrack {
    pub id: i64,
    pub plan_id: i64,
    pub plan_name: String,
    pub title: String,
    pub file_path: String,
    pub play_count_30d: i64,
}

#[derive(Debug, Serialize)]
pub struct BackgroundAudioPlan {
    pub id: i64,
    pub name: String,
    pub tracks: Vec<BackgroundTrack>,
}

#[derive(sqlx::FromRow)]
struct BgRow {
    id: i64,
    plan_id: i64,
    plan_name: String,
    title: String,
    file_path: String,
    play_count_30d: i64,
}

#[tauri::command]
pub async fn list_background_audio(
    state: State<'_, AppState>,
) -> Result<Vec<BackgroundAudioPlan>, String> {
    let rows: Vec<BgRow> = sqlx::query_as(
        "SELECT v.id, v.plan_id, p.name AS plan_name, v.title, v.file_path,
                COUNT(bp.id) AS play_count_30d
         FROM videos v
         JOIN plans p ON p.id = v.plan_id
         LEFT JOIN background_plays bp ON bp.video_id = v.id
              AND bp.played_at >= datetime('now', '-30 days')
         WHERE p.is_background = 1 AND v.media_type = 'audio'
         GROUP BY v.id
         ORDER BY p.id, v.sort_order",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let mut plans: Vec<BackgroundAudioPlan> = Vec::new();
    for row in rows {
        let entry = match plans.iter_mut().find(|p| p.id == row.plan_id) {
            Some(p) => p,
            None => {
                plans.push(BackgroundAudioPlan {
                    id: row.plan_id,
                    name: row.plan_name.clone(),
                    tracks: Vec::new(),
                });
                plans.last_mut().unwrap()
            }
        };
        entry.tracks.push(BackgroundTrack {
            id: row.id,
            plan_id: row.plan_id,
            plan_name: row.plan_name,
            title: row.title,
            file_path: row.file_path,
            play_count_30d: row.play_count_30d,
        });
    }

    Ok(plans)
}

#[tauri::command]
pub async fn get_recent_background_tracks(
    state: State<'_, AppState>,
    days: i64,
    limit: i64,
) -> Result<Vec<BackgroundTrack>, String> {
    let date_modifier = format!("-{} days", days);
    let rows: Vec<BgRow> = sqlx::query_as(
        "SELECT v.id, v.plan_id, p.name AS plan_name, v.title, v.file_path,
                COUNT(bp.id) AS play_count_30d
         FROM videos v
         JOIN plans p ON p.id = v.plan_id
         LEFT JOIN background_plays bp ON bp.video_id = v.id
              AND bp.played_at >= datetime('now', ?)
         WHERE p.is_background = 1 AND v.media_type = 'audio'
         GROUP BY v.id
         ORDER BY play_count_30d DESC, v.sort_order ASC
         LIMIT ?",
    )
    .bind(&date_modifier)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| BackgroundTrack {
            id: row.id,
            plan_id: row.plan_id,
            plan_name: row.plan_name,
            title: row.title,
            file_path: row.file_path,
            play_count_30d: row.play_count_30d,
        })
        .collect())
}

#[tauri::command]
pub async fn delete_background_track(
    state: State<'_, AppState>,
    video_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM videos WHERE id = ?")
        .bind(video_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_plan_background(
    state: State<'_, AppState>,
    plan_id: i64,
    is_background: i64,
) -> Result<(), String> {
    sqlx::query("UPDATE plans SET is_background = ?, updated_at = ? WHERE id = ?")
        .bind(is_background)
        .bind(now_str())
        .bind(plan_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
