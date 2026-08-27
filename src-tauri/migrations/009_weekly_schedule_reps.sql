-- Weekly per-weekday schedule, index 0=Monday .. 6=Sunday:
--   [{"episodes":1,"blank_minutes":0}, ...]
-- Backfilled from the existing episodes_per_day so every plan starts with the
-- same quota on all 7 days (equivalent to today's behavior) and no blank
-- practice enabled.
ALTER TABLE plans ADD COLUMN weekly_schedule TEXT NOT NULL DEFAULT '[]';

UPDATE plans SET weekly_schedule =
  '[' ||
  '{"episodes":' || episodes_per_day || ',"blank_minutes":0},' ||
  '{"episodes":' || episodes_per_day || ',"blank_minutes":0},' ||
  '{"episodes":' || episodes_per_day || ',"blank_minutes":0},' ||
  '{"episodes":' || episodes_per_day || ',"blank_minutes":0},' ||
  '{"episodes":' || episodes_per_day || ',"blank_minutes":0},' ||
  '{"episodes":' || episodes_per_day || ',"blank_minutes":0},' ||
  '{"episodes":' || episodes_per_day || ',"blank_minutes":0}' ||
  ']';

-- Per-video required/completed repetition counts, and the last date a rep
-- was credited (so repeated same-day playback never counts more than once).
ALTER TABLE videos ADD COLUMN required_reps INTEGER NOT NULL DEFAULT 1;
ALTER TABLE videos ADD COLUMN completed_reps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE videos ADD COLUMN last_rep_date TEXT;

-- Blank (offline) practice completion, one row per plan per day.
CREATE TABLE blank_practice_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    date_key TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    UNIQUE(plan_id, date_key)
);
