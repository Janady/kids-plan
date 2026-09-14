-- When set, every watched video in this plan is eligible for the background
-- player (audio-only). Combined with videos.is_bg_track the same way
-- is_background is: flag any file to narrow the set to just those files.
ALTER TABLE plans ADD COLUMN bg_watched_video INTEGER NOT NULL DEFAULT 0;
