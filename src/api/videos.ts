import { invoke } from "@tauri-apps/api/core";
import type { Video, CleanupPlan, CleanupResult } from "../types";

export const listVideosForPlan = (planId: number): Promise<Video[]> =>
  invoke("list_videos_for_plan", { planId });

export const updateVideoStatus = (
  videoId: number,
  status: "watching" | "watched"
): Promise<Video> => invoke("update_video_status", { videoId, status });

// Mark as watched without using today's quota (content seen elsewhere).
export const markVideoWatchedEarlier = (videoId: number): Promise<Video> =>
  invoke("mark_video_watched_earlier", { videoId });

export const adjustVideoReps = (videoId: number, delta: number): Promise<Video> =>
  invoke("adjust_video_reps", { videoId, delta });

export const batchAdjustPlanReps = (planId: number, delta: number): Promise<void> =>
  invoke("batch_adjust_plan_reps", { planId, delta });

// Credit one playback rep; marks the video watched once required_reps is met.
export const completeVideoRep = (videoId: number): Promise<Video> =>
  invoke("complete_video_rep", { videoId });

export const updateVideoProgress = (
  videoId: number,
  progressSeconds: number
): Promise<void> => invoke("update_video_progress", { videoId, progressSeconds });

export const setVideoDuration = (
  videoId: number,
  durationSeconds: number
): Promise<void> => invoke("set_video_duration", { videoId, durationSeconds });

export const listCompletedForCleanup = (): Promise<CleanupPlan[]> =>
  invoke("list_completed_for_cleanup");

export const cleanupVideos = (videoIds: number[]): Promise<CleanupResult> =>
  invoke("cleanup_videos", { videoIds });
