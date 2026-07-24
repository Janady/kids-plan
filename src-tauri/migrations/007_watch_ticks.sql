CREATE TABLE watch_ticks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id  INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    date_key  TEXT NOT NULL,
    tick_at   TEXT NOT NULL
);

CREATE INDEX idx_ticks_date  ON watch_ticks(date_key);
CREATE INDEX idx_ticks_video ON watch_ticks(video_id);
CREATE INDEX idx_ticks_time  ON watch_ticks(tick_at);

-- Migrate historical watch_sessions into evenly-interpolated 3-second ticks.
-- These are approximations (not real playback heartbeats) used only to
-- preserve historical totals and give the distribution chart a rough shape.
INSERT INTO watch_ticks (video_id, date_key, tick_at)
SELECT
  ws.video_id,
  ws.date_key,
  datetime(
    julianday(ws.started_at) +
    (julianday(ws.ended_at) - julianday(ws.started_at)) *
      (CAST(n.value AS REAL) / MAX(ws.seconds_watched / 3, 1))
  )
FROM watch_sessions ws
JOIN (
  WITH RECURSIVE seq(value) AS (
    SELECT 0 UNION ALL SELECT value + 1 FROM seq WHERE value < 1200
  )
  SELECT value FROM seq
) n ON n.value < MAX(ws.seconds_watched / 3, 1);

DROP TABLE watch_sessions;
