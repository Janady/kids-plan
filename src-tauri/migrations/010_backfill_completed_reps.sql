-- 009_weekly_schedule_reps.sql backfilled every existing video (including
-- ones already status='watched') with required_reps=1, completed_reps=0.
-- That leaves historically-completed videos indistinguishable from "0 reps
-- required, never played" under the new completed_reps>0 ⇒ "已学" UI rule.
-- Bring completed_reps up to required_reps for anything already 'watched'
-- so they keep reading as actually completed.
UPDATE videos SET completed_reps = required_reps
WHERE status = 'watched' AND completed_reps < required_reps;
