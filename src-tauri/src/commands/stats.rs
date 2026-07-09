use crate::db::AppState;
use serde::Serialize;
use tauri::State;

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

#[tauri::command]
pub async fn get_daily_stats(state: State<'_, AppState>) -> Result<Vec<DayStat>, String> {
    sqlx::query_as(
        "SELECT date_key, SUM(seconds_watched) as total_seconds
         FROM watch_sessions
         WHERE date_key >= date('now', 'localtime', '-364 days')
         GROUP BY date_key
         ORDER BY date_key ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_overall_stats(state: State<'_, AppState>) -> Result<OverallStats, String> {
    let (total_seconds, active_days): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(seconds_watched), 0), COUNT(DISTINCT date_key) FROM watch_sessions",
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let (videos_watched,): (i64,) =
        sqlx::query_as("SELECT COUNT(DISTINCT video_id) FROM watch_sessions")
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
