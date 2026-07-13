export type PlanStatus = "not_started" | "in_progress" | "completed";
export type VideoStatus = "not_watched" | "watching" | "watched";
export type MediaType = "video" | "audio";
export type AudioRole = "plan" | "background";
export type LoopMode = "shuffle" | "track" | "all";

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
  audio_role: AudioRole;
  is_background: number; // 0|1 — audio files also appear in background player
  is_locked_by_priority: boolean;
  video_count: number;  // only video files
  audio_count: number;  // only audio files
  watched_count: number; // all watched items
  next_video_id: number | null;
  next_video_title: string | null;
  next_video_status: VideoStatus | null;
  next_video_progress: number | null;
  next_video_duration: number | null;
  next_video_sort_order: number | null;
  next_video_media_type: MediaType | null;
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
  updated_at: string;
}

export interface WatchSessionInput {
  video_id: number;
  seconds_watched: number;
  started_at: string;
  ended_at: string;
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
}

export interface TodayDoneItem {
  video_id: number;
  video_title: string;
  sort_order: number;
}

export interface TodayPlanItem {
  plan_id: number;
  plan_name: string;
  episodes_per_day: number;
  pending: TodayPendingItem[];
  done_today: TodayDoneItem[];
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

export interface BackgroundTrack {
  id: number;
  plan_id: number;
  plan_name: string;
  title: string;
  file_path: string;
  play_count_30d: number;
}

export interface BackgroundAudioPlan {
  id: number;
  name: string;
  tracks: BackgroundTrack[];
}
