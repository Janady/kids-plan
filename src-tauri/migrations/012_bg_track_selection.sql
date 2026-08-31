-- Per-file override for which audio counts as background music. When a plan
-- has is_background=1 but none of its audio files are flagged here, the whole
-- plan's audio is used (existing behavior). Flagging any file switches that
-- plan to using only the flagged files.
ALTER TABLE videos ADD COLUMN is_bg_track INTEGER NOT NULL DEFAULT 0;
