use crate::db::AppState;
use chrono::{DateTime, Duration, Local, Utc};
use serde::Serialize;
use tauri::State;

const TICK_SECONDS: i64 = 3;

fn today_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

// Record one watch heartbeat. Ticks are meant to land every TICK_SECONDS, but the
// frontend timer can drift (backgrounding, pause/resume races, slow IPC), so the
// timestamp actually stored is reconciled against the most recent tick overall
// (any video — a switch between videos is still continuous watching):
//   gap < 2s        → drop (duplicate / retry-storm tick, would double-count)
//   2s <= gap <= 3s → snap to last_tick_at + TICK_SECONDS, keeping the tick grid
//                     exact instead of accumulating float drift
//   gap > 3s        → real pause happened; insert at the actual receive time so
//                     the stored gap reflects it
// The lock serializes the read-last-tick-then-insert sequence: without it, two
// ticks arriving within the same few milliseconds could both read the same
// "last tick" and both decide to insert, defeating the < 2s dedup above.
#[tauri::command]
pub async fn record_watch_tick(state: State<'_, AppState>, video_id: i64) -> Result<(), String> {
    let _guard = state.tick_lock.lock().await;

    let last: Option<(String,)> =
        sqlx::query_as("SELECT tick_at FROM watch_ticks ORDER BY tick_at DESC LIMIT 1")
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    let now = Utc::now();
    let last_ts = last
        .as_ref()
        .and_then(|(s,)| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    let tick_at = match last_ts {
        Some(last_ts) => {
            let gap = (now - last_ts).num_milliseconds() as f64 / 1000.0;
            if gap < 2.0 {
                return Ok(());
            } else if gap <= 3.0 {
                last_ts + Duration::seconds(TICK_SECONDS)
            } else {
                now
            }
        }
        None => now,
    };

    sqlx::query("INSERT INTO watch_ticks (video_id, date_key, tick_at) VALUES (?, ?, ?)")
        .bind(video_id)
        .bind(tick_at.with_timezone(&Local).format("%Y-%m-%d").to_string())
        .bind(tick_at.to_rfc3339())
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Only counts video ticks (used for daily video limit check)
#[tauri::command]
pub async fn get_today_watched_seconds(state: State<'_, AppState>) -> Result<i64, String> {
    let date_key = today_key();
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*)
         FROM watch_ticks wt
         JOIN videos v ON v.id = wt.video_id
         WHERE wt.date_key = ? AND v.media_type = 'video'",
    )
    .bind(&date_key)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(count * TICK_SECONDS)
}

// Only counts audio plan ticks (shown separately, not counted toward video limit)
#[tauri::command]
pub async fn get_today_audio_seconds(state: State<'_, AppState>) -> Result<i64, String> {
    let date_key = today_key();
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*)
         FROM watch_ticks wt
         JOIN videos v ON v.id = wt.video_id
         WHERE wt.date_key = ? AND v.media_type = 'audio'",
    )
    .bind(&date_key)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(count * TICK_SECONDS)
}

// Daily limit only checks video watch time (eye protection, not audio)
#[tauri::command]
pub async fn check_daily_limit(state: State<'_, AppState>) -> Result<bool, String> {
    let date_key = today_key();
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*)
         FROM watch_ticks wt
         JOIN videos v ON v.id = wt.video_id
         WHERE wt.date_key = ? AND v.media_type = 'video'",
    )
    .bind(&date_key)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    let today_total = count * TICK_SECONDS;

    let limit_row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'daily_limit_seconds'")
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    let limit: i64 = limit_row
        .and_then(|(v,)| v.parse().ok())
        .unwrap_or(3600);

    Ok(today_total >= limit)
}

// Continuous watch time: walk today's video ticks backward from now, summing
// the run of ticks whose gaps are all <= rest_gap_seconds. A gap larger than
// that (or the latest tick itself being older than that) breaks the streak.
// `since`, when given, additionally excludes any tick at or before that time —
// used to force a reset right after an enforced break ends, since a forced
// break's duration is independently configurable from rest_gap_seconds and
// isn't guaranteed to exceed it.
#[tauri::command]
pub async fn get_continuous_watch_seconds(
    state: State<'_, AppState>,
    rest_gap_seconds: i64,
    since: Option<String>,
) -> Result<i64, String> {
    let date_key = today_key();
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT wt.tick_at
         FROM watch_ticks wt
         JOIN videos v ON v.id = wt.video_id
         WHERE wt.date_key = ? AND v.media_type = 'video'
         ORDER BY wt.tick_at DESC",
    )
    .bind(&date_key)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let since_ts: Option<DateTime<Utc>> = since
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    let timestamps: Vec<DateTime<Utc>> = rows
        .iter()
        .filter_map(|(s,)| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .filter(|dt| since_ts.is_none_or(|since| *dt > since))
        .collect();

    let Some(latest) = timestamps.first() else {
        return Ok(0);
    };

    let now = Utc::now();
    if (now - *latest).num_seconds() > rest_gap_seconds {
        return Ok(0);
    }

    let mut count: i64 = 1;
    for i in 1..timestamps.len() {
        let gap = (timestamps[i - 1] - timestamps[i]).num_seconds();
        if gap > rest_gap_seconds {
            break;
        }
        count += 1;
    }

    Ok(count * TICK_SECONDS)
}

#[derive(Debug, Serialize)]
pub struct DistributionSegment {
    pub start: String,
    pub end: String,
    // Each tick represents a fixed TICK_SECONDS window, so a segment's real
    // duration is tick_count * TICK_SECONDS, NOT (end - start) — the latter
    // is short by one tick's worth of time (it only spans the gaps *between*
    // ticks) and must match the tick-count math used by get_daily_stats /
    // get_today_hourly_stats, or the two views of the same data disagree.
    pub seconds: i64,
}

// Merge a day's ticks (any media type) into contiguous segments for the
// "activity" timeline, joining ticks that are at most 4s apart (tolerates
// minor heartbeat jitter without merging genuinely separate sessions).
// `date_key`, when given, selects a specific day ("YYYY-MM-DD"); defaults to today.
#[tauri::command]
pub async fn get_today_distribution(
    state: State<'_, AppState>,
    date_key: Option<String>,
) -> Result<Vec<DistributionSegment>, String> {
    const MERGE_GAP_SECONDS: i64 = 4;
    let date_key = date_key.unwrap_or_else(today_key);
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT tick_at FROM watch_ticks WHERE date_key = ? ORDER BY tick_at ASC",
    )
    .bind(&date_key)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let timestamps: Vec<DateTime<Utc>> = rows
        .iter()
        .filter_map(|(s,)| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .collect();

    let mut segments: Vec<DistributionSegment> = Vec::new();
    let mut seg_start: Option<DateTime<Utc>> = None;
    let mut seg_end: Option<DateTime<Utc>> = None;
    let mut seg_count: i64 = 0;

    for ts in timestamps {
        match (seg_start, seg_end) {
            (Some(_), Some(end)) if (ts - end).num_seconds() <= MERGE_GAP_SECONDS => {
                seg_end = Some(ts);
                seg_count += 1;
            }
            (Some(start), Some(end)) => {
                segments.push(DistributionSegment {
                    start: start.with_timezone(&Local).to_rfc3339(),
                    end: end.with_timezone(&Local).to_rfc3339(),
                    seconds: seg_count * TICK_SECONDS,
                });
                seg_start = Some(ts);
                seg_end = Some(ts);
                seg_count = 1;
            }
            _ => {
                seg_start = Some(ts);
                seg_end = Some(ts);
                seg_count = 1;
            }
        }
    }
    if let (Some(start), Some(end)) = (seg_start, seg_end) {
        segments.push(DistributionSegment {
            start: start.with_timezone(&Local).to_rfc3339(),
            end: end.with_timezone(&Local).to_rfc3339(),
            seconds: seg_count * TICK_SECONDS,
        });
    }

    Ok(segments)
}

// Record a background audio play (for frequency ranking; does not count toward any time limit)
#[tauri::command]
pub async fn record_background_play(
    state: State<'_, AppState>,
    video_id: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO background_plays (video_id, played_at) VALUES (?, datetime('now'))",
    )
    .bind(video_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
