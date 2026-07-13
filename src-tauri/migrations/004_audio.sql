ALTER TABLE plans ADD COLUMN scan_video INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plans ADD COLUMN scan_audio INTEGER NOT NULL DEFAULT 0;
-- 'plan' = mandatory scheduled learning, 'background' = freely accessible background audio
ALTER TABLE plans ADD COLUMN audio_role TEXT NOT NULL DEFAULT 'plan';

-- 'video' | 'audio'
ALTER TABLE videos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video';
