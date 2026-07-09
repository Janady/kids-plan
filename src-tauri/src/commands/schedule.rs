use crate::db::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
struct ActivePlan {
    id: i64,
    name: String,
    episodes_per_day: i64,
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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TodayDoneItem {
    pub video_id: i64,
    pub video_title: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TodayPlanItem {
    pub plan_id: i64,
    pub plan_name: String,
    pub episodes_per_day: i64,
    pub pending: Vec<TodayPendingItem>,
    pub done_today: Vec<TodayDoneItem>,
}

#[tauri::command]
pub async fn get_today_schedule(
    state: State<'_, AppState>,
) -> Result<Vec<TodayPlanItem>, String> {
    let active_plans: Vec<ActivePlan> = sqlx::query_as(
        "SELECT id, name, episodes_per_day FROM plans
         WHERE daily_schedule_active = 1 ORDER BY created_at ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let mut result: Vec<TodayPlanItem> = Vec::new();

    for plan in &active_plans {
        // Videos completed today — compare local-date portion of the RFC3339 timestamp
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

        // Remaining episodes to show for today
        let remaining = (plan.episodes_per_day - done_count).max(0);
        let mut pending: Vec<TodayPendingItem> = Vec::new();

        if remaining > 0 {
            let pending_videos: Vec<PendingVideo> = sqlx::query_as(
                "SELECT id, title, file_path, status, progress_seconds, duration_seconds, sort_order
                 FROM videos WHERE plan_id = ? AND status IN ('watching', 'not_watched')
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
                })
                .collect();
        }

        result.push(TodayPlanItem {
            plan_id: plan.id,
            plan_name: plan.name.clone(),
            episodes_per_day: plan.episodes_per_day,
            pending,
            done_today,
        });
    }

    Ok(result)
}
