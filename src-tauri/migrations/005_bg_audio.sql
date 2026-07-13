CREATE TABLE IF NOT EXISTS background_plays (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  played_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bg_plays_video ON background_plays(video_id);
CREATE INDEX IF NOT EXISTS idx_bg_plays_at ON background_plays(played_at);
