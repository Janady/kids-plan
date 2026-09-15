export type PlanStatus = "not_started" | "in_progress" | "completed";
export type VideoStatus = "not_watched" | "watching" | "watched";
export type MediaType = "video" | "audio" | "document";
export type AudioRole = "plan" | "background";
export type LoopMode = "shuffle" | "track" | "all";

export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface WeekdaySetting {
  episodes: number;
  blank_minutes: number;
}

export interface PlanPreviewVideo {
  id: number;
  title: string;
  status: VideoStatus;
  progress_seconds: number;
  duration_seconds: number | null;
  sort_order: number;
  media_type: MediaType;
  file_path: string;
}

export interface Plan {
  id: number;
  name: string;
  folder_path: string;
  status: PlanStatus;
  episodes_per_day: number;
  daily_schedule_active: number;
  priority: number; // 0=None, 1=Low, 2=Medium, 3=High
  scan_video: number; // 0|1
  scan_audio: number; // 0|1
  scan_document: number; // 0|1
  audio_role: AudioRole;
  is_background: number; // 0|1 — audio files also appear in background player
  bg_watched_video: number; // 0|1 — watched videos also appear in background player (audio-only)
  is_protected: number; // 0|1 — plan and its files cannot be deleted/cleaned up
  weekly_schedule: WeekdaySetting[]; // length 7, index 0=Monday..6=Sunday
  is_locked_by_priority: boolean;
  video_count: number;  // only video files
  audio_count: number;  // only audio files
  document_count: number; // only document files (images/pdf/office docs)
  watched_count: number; // all watched items
  next_video_id: number | null;
  next_video_title: string | null;
  next_video_status: VideoStatus | null;
  next_video_progress: number | null;
  next_video_duration: number | null;
  next_video_sort_order: number | null;
  next_video_media_type: MediaType | null;
  recent_videos: PlanPreviewVideo[];
  tags: Tag[];
  created_at: string;
  updated_at: string;
}

export interface Video {
  id: number;
  plan_id: number;
  file_path: string;
  title: string;
  duration_seconds: number | null;
  status: VideoStatus;
  progress_seconds: number;
  sort_order: number;
  media_type: MediaType;
  required_reps: number;
  completed_reps: number;
  last_rep_date: string | null;
  updated_at: string;
  is_bg_track: number; // 0|1 — explicitly selected as background music
  file_exists: boolean; // false = file cleaned up / missing on disk
}

export interface CleanupVideo {
  id: number;
  title: string;
  file_path: string;
  file_size: number;
}

export interface CleanupPlan {
  plan_id: number;
  plan_name: string;
  videos: CleanupVideo[];
  total_size: number;
}

export interface CleanupResult {
  deleted: number;
  freed_bytes: number;
  not_found: number;
  failed: string[];
}

export interface DistributionSegment {
  start: string;
  end: string;
  seconds: number;
}

export interface TodayPendingItem {
  video_id: number;
  video_title: string;
  file_path: string;
  video_status: VideoStatus;
  video_progress: number;
  video_duration: number | null;
  sort_order: number;
  media_type: MediaType;
  required_reps: number;
  completed_reps: number;
}

export interface TodayDoneItem {
  video_id: number;
  video_title: string;
  sort_order: number;
}

export interface TodayBlankPractice {
  plan_id: number;
  minutes: number;
  completed: boolean;
}

export interface TodayPlanItem {
  plan_id: number;
  plan_name: string;
  episodes_per_day: number;
  pending: TodayPendingItem[];
  done_today: TodayDoneItem[];
  blank_practice: TodayBlankPractice | null;
}

export interface BlockedTimeRange {
  start: string;
  end: string;
}

export interface DayStat {
  date_key: string;
  total_seconds: number;
}

export interface OverallStats {
  total_seconds: number;
  videos_watched: number;
  plans_completed: number;
  active_days: number;
}

export type StatsRange = "day" | "week" | "month";

export interface PlanTimeStat {
  plan_id: number;
  plan_name: string;
  seconds: number;
}

export interface BackgroundTrack {
  id: number;
  plan_id: number;
  plan_name: string;
  title: string;
  file_path: string;
  media_type: MediaType;
  play_count_30d: number;
}

export interface BackgroundAudioPlan {
  id: number;
  name: string;
  tracks: BackgroundTrack[];
}

export interface ScanReport {
  found: number;          // media files discovered on disk
  added: number;          // now owned by this plan
  skipped: number;        // skipped — already owned by another plan
  skipped_names: string[]; // titles of skipped files (capped at 20)
  plan: Plan;
}

export interface RendererInfo {
  id: string;
  name: string;
  location: string;
}

export interface CastQueueItem {
  video_id: number;
  file_path: string;
  title: string;
  duration_seconds: number | null;
}

export type TransportState =
  | "playing"
  | "paused"
  | "stopped"
  | "transitioning"
  | "no_media_present"
  | "unknown";

export type CastPhase =
  | "loading"
  | "playing"
  | "paused"
  | "finished"
  | "stopped"
  | "error";

export interface CastStateSnapshot {
  renderer_name: string;
  current: CastQueueItem | null;
  index: number;
  total: number;
  queue: CastQueueItem[];
  transport_state: TransportState;
  is_paused_by_break: boolean;
  phase: CastPhase;
  error: string | null;
}
