CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    folder_path TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'not_started',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id          INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    file_path        TEXT NOT NULL UNIQUE,
    title            TEXT NOT NULL,
    duration_seconds INTEGER,
    status           TEXT NOT NULL DEFAULT 'not_watched',
    progress_seconds INTEGER NOT NULL DEFAULT 0,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id        INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    date_key        TEXT NOT NULL,
    seconds_watched INTEGER NOT NULL,
    started_at      TEXT NOT NULL,
    ended_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_plan_id ON videos(plan_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date  ON watch_sessions(date_key);
CREATE INDEX IF NOT EXISTS idx_sessions_video ON watch_sessions(video_id);
