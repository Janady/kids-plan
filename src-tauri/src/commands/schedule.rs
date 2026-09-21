use crate::commands::plans::{effective_day_setting, plan_has_unmet_today_quota, today_weekday_idx};
use crate::db::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
struct ActivePlan {
    id: i64,
    name: String,
    weekly_schedule: String,
    #[allow(dead_code)]
    priority: i64,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
struct DoneVideo {
    id: i64,
    title: String,
    sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
struct PendingVideo {
    id: i64,
    title: String,
    file_path: String,
    status: String,
    progress_seconds: i64,
    duration_seconds: Option<i64>,
    sort_order: i64,
    media_type: String,
    required_reps: i64,
    completed_reps: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TodayPendingItem {
    pub video_id: i64,
    pub video_title: String,
    pub file_path: String,
    pub video_status: String,
    pub video_progress: i64,
    pub video_duration: Option<i64>,
    pub sort_order: i64,
    pub media_type: String,
    pub required_reps: i64,
    pub completed_reps: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TodayDoneItem {
    pub video_id: i64,
    pub video_title: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TodayBlankPractice {
    pub plan_id: i64,
    pub minutes: i64,
    pub completed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TodayPlanItem {
    pub plan_id: i64,
    pub plan_name: String,
    pub episodes_per_day: i64,
    pub pending: Vec<TodayPendingItem>,
    pub done_today: Vec<TodayDoneItem>,
    pub blank_practice: Option<TodayBlankPractice>,
}

#[tauri::command]
pub async fn get_today_schedule(
    state: State<'_, AppState>,
) -> Result<Vec<TodayPlanItem>, String> {
    let weekday_idx = today_weekday_idx();

    // Exclude background audio plans from the mandatory schedule
    // Higher priority first, then creation order — so mandatory high-priority
    // plans surface at the top of today's tasks.
    let active_plans: Vec<ActivePlan> = sqlx::query_as(
        "SELECT id, name, weekly_schedule, priority FROM plans
         WHERE daily_schedule_active = 1
         ORDER BY priority DESC, created_at ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let mut result: Vec<TodayPlanItem> = Vec::new();

    for plan in &active_plans {
        let (quota, blank_minutes) = effective_day_setting(&plan.weekly_schedule, weekday_idx);

        let done_videos: Vec<DoneVideo> = sqlx::query_as(
            "SELECT id, title, sort_order FROM videos
             WHERE plan_id = ? AND status = 'watched'
             AND substr(updated_at, 1, 10) = date('now', 'localtime')
             ORDER BY updated_at DESC",
        )
        .bind(plan.id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        let done_count = done_videos.len() as i64;
        let done_today: Vec<TodayDoneItem> = done_videos
            .into_iter()
            .map(|v| TodayDoneItem {
                video_id: v.id,
                video_title: v.title,
                sort_order: v.sort_order,
            })
            .collect();

        let remaining = (quota - done_count).max(0);
        let mut pending: Vec<TodayPendingItem> = Vec::new();

        if remaining > 0 {
            let pending_videos: Vec<PendingVideo> = sqlx::query_as(
                "SELECT id, title, file_path, status, progress_seconds, duration_seconds, sort_order, media_type,
                        required_reps, completed_reps
                 FROM videos WHERE plan_id = ? AND status IN ('watching', 'not_watched') AND media_type != 'document'
                 ORDER BY CASE status WHEN 'watching' THEN 0 ELSE 1 END, sort_order ASC
                 LIMIT ?",
            )
            .bind(plan.id)
            .bind(remaining)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;

            pending = pending_videos
                .into_iter()
                .map(|v| TodayPendingItem {
                    video_id: v.id,
                    video_title: v.title,
                    file_path: v.file_path,
                    video_status: v.status,
                    video_progress: v.progress_seconds,
                    video_duration: v.duration_seconds,
                    sort_order: v.sort_order,
                    media_type: v.media_type,
                    required_reps: v.required_reps,
                    completed_reps: v.completed_reps,
                })
                .collect();
        }

        let blank_practice = if blank_minutes > 0 {
            let row: Option<(i64, String)> = sqlx::query_as(
                "SELECT minutes, completed_at FROM blank_practice_log
                 WHERE plan_id = ? AND date_key = date('now', 'localtime')",
            )
            .bind(plan.id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;

            Some(TodayBlankPractice {
                plan_id: plan.id,
                minutes: blank_minutes,
                completed: row.is_some(),
            })
        } else {
            None
        };

        result.push(TodayPlanItem {
            plan_id: plan.id,
            plan_name: plan.name.clone(),
            episodes_per_day: quota,
            pending,
            done_today,
            blank_practice,
        });
    }

    Ok(result)
}

#[derive(Debug, Clone)]
pub(crate) struct NextTodayVideo {
    pub video_id: i64,
    pub file_path: String,
    pub title: String,
    pub duration_seconds: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct CastCandidatePlan {
    id: i64,
    weekly_schedule: String,
    priority: i64,
    is_background: i64,
}

// Next unlocked *video* still due today, after `skip_video_id` has been
// marked watched. Re-evaluates priority locks and today's remaining quota
// so a cast session can continue into newly unlocked lower-priority plans
// instead of stopping when the frozen start-of-session queue runs out.
pub(crate) async fn next_unlocked_today_video(
    db: &sqlx::SqlitePool,
    skip_video_id: Option<i64>,
) -> Result<Option<NextTodayVideo>, String> {
    let weekday_idx = today_weekday_idx();
    let active_plans: Vec<CastCandidatePlan> = sqlx::query_as(
        "SELECT id, weekly_schedule, priority, is_background FROM plans
         WHERE daily_schedule_active = 1
         ORDER BY priority DESC, created_at ASC",
    )
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;

    let mut max_blocking = 0i64;
    for plan in &active_plans {
        if plan_has_unmet_today_quota(
            db,
            plan.id,
            plan.priority,
            1,
            &plan.weekly_schedule,
            plan.is_background,
        )
        .await?
        {
            max_blocking = max_blocking.max(plan.priority);
        }
    }

    let skip = skip_video_id.unwrap_or(-1);
    for plan in &active_plans {
        if max_blocking > 0 && plan.priority < max_blocking {
            continue;
        }

        let (quota, _) = effective_day_setting(&plan.weekly_schedule, weekday_idx);
        let (done_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM videos
             WHERE plan_id = ? AND status = 'watched'
               AND substr(updated_at, 1, 10) = date('now', 'localtime')",
        )
        .bind(plan.id)
        .fetch_one(db)
        .await
        .map_err(|e| e.to_string())?;

        if (quota - done_count).max(0) == 0 {
            continue;
        }

        let row: Option<(i64, String, String, Option<i64>)> = sqlx::query_as(
            "SELECT id, title, file_path, duration_seconds
             FROM videos
             WHERE plan_id = ? AND status IN ('watching', 'not_watched')
               AND media_type = 'video'
               AND id != ?
             ORDER BY CASE status WHEN 'watching' THEN 0 ELSE 1 END, sort_order ASC
             LIMIT 1",
        )
        .bind(plan.id)
        .bind(skip)
        .fetch_optional(db)
        .await
        .map_err(|e| e.to_string())?;

        if let Some((video_id, title, file_path, duration_seconds)) = row {
            return Ok(Some(NextTodayVideo {
                video_id,
                file_path,
                title,
                duration_seconds,
            }));
        }
    }

    Ok(None)
}

// Records a blank (offline) practice session as done for today. The date is
// always today's server-local date — never trusts a client-supplied date —
// so a session started but abandoned before completion simply never calls
// this and counts as not done for that day.
#[tauri::command]
pub async fn complete_blank_practice(
    state: State<'_, AppState>,
    plan_id: i64,
    minutes: i64,
) -> Result<(), String> {
    let now = chrono::Local::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO blank_practice_log (plan_id, date_key, minutes, completed_at)
         VALUES (?, date('now', 'localtime'), ?, ?)
         ON CONFLICT(plan_id, date_key) DO UPDATE SET minutes = excluded.minutes, completed_at = excluded.completed_at",
    )
    .bind(plan_id)
    .bind(minutes)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
