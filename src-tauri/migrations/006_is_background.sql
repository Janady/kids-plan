ALTER TABLE plans ADD COLUMN is_background INTEGER NOT NULL DEFAULT 0;
-- Migrate existing background-only plans
UPDATE plans SET is_background = 1 WHERE audio_role = 'background';
