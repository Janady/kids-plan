use crate::db::AppState;
use chrono::{Duration, Local};
use serde::Serialize;
use tauri::State;

const TICK_SECONDS: i64 = 3;

#[derive(Serialize, sqlx::FromRow)]
pub struct DayStat {
    pub date_key: String,
    pub total_seconds: i64,
}

#[derive(Serialize)]
pub struct OverallStats {
    pub total_seconds: i64,
    pub videos_watched: i64,
    pub plans_completed: i64,
    pub active_days: i64,
}

#[derive(Serialize)]
pub struct PlanTimeStat {
    pub plan_id: i64,
    pub plan_name: String,
    pub seconds: i64,
}

fn today_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

// Range start (inclusive) as a date_key string. Ticks never have a future
// date_key, so "day" collapses to just today's exact key via the same >= filter.
fn range_start_key(range: &str) -> String {
    let days_back = match range {
        "week" => 6,
        "month" => 29,
        _ => 0,
    };
    (Local::now() - Duration::days(days_back))
        .format("%Y-%m-%d")
        .to_string()
}

#[tauri::command]
pub async fn get_daily_stats(state: State<'_, AppState>) -> Result<Vec<DayStat>, String> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT date_key, COUNT(*) as tick_count
         FROM watch_ticks
         WHERE date_key >= date('now', 'localtime', '-364 days')
         GROUP BY date_key
         ORDER BY date_key ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(date_key, tick_count)| DayStat {
            date_key,
            total_seconds: tick_count * TICK_SECONDS,
        })
        .collect())
}

// Today's watch time broken down by local hour (0-23), in seconds.
#[tauri::command]
pub async fn get_today_hourly_stats(state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    let rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT CAST(strftime('%H', tick_at, 'localtime') AS INTEGER) as hour, COUNT(*) as cnt
         FROM watch_ticks
         WHERE date_key = ?
         GROUP BY hour",
    )
    .bind(today_key())
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let mut hours = vec![0i64; 24];
    for (hour, cnt) in rows {
        if let Some(slot) = hours.get_mut(hour as usize) {
            *slot = cnt * TICK_SECONDS;
        }
    }
    Ok(hours)
}

// Per-plan watch time for a range ("day" | "week" | "month"), sorted by
// seconds descending. "week"/"month" are rolling windows ending today.
#[tauri::command]
pub async fn get_plan_time_stats(
    state: State<'_, AppState>,
    range: String,
) -> Result<Vec<PlanTimeStat>, String> {
    let start_key = range_start_key(&range);
    let rows: Vec<(i64, String, i64)> = sqlx::query_as(
        "SELECT p.id, p.name, COUNT(*) as tick_count
         FROM watch_ticks wt
         JOIN videos v ON v.id = wt.video_id
         JOIN plans p ON p.id = v.plan_id
         WHERE wt.date_key >= ?
         GROUP BY p.id
         ORDER BY tick_count DESC",
    )
    .bind(&start_key)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(plan_id, plan_name, tick_count)| PlanTimeStat {
            plan_id,
            plan_name,
            seconds: tick_count * TICK_SECONDS,
        })
        .collect())
}

#[tauri::command]
pub async fn get_overall_stats(state: State<'_, AppState>) -> Result<OverallStats, String> {
    let (tick_count, active_days): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COUNT(DISTINCT date_key) FROM watch_ticks",
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    let total_seconds = tick_count * TICK_SECONDS;

    let (videos_watched,): (i64,) =
        sqlx::query_as("SELECT COUNT(DISTINCT video_id) FROM watch_ticks")
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    let (plans_completed,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM plans WHERE status = 'completed'")
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    Ok(OverallStats { total_seconds, videos_watched, plans_completed, active_days })
}
