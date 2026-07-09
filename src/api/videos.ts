import { invoke } from "@tauri-apps/api/core";
import type { Video } from "../types";

export const listVideosForPlan = (planId: number): Promise<Video[]> =>
  invoke("list_videos_for_plan", { planId });

export const updateVideoStatus = (
  videoId: number,
  status: "watching" | "watched"
): Promise<Video> => invoke("update_video_status", { videoId, status });

export const updateVideoProgress = (
  videoId: number,
  progressSeconds: number
): Promise<void> => invoke("update_video_progress", { videoId, progressSeconds });

export const setVideoDuration = (
  videoId: number,
  durationSeconds: number
): Promise<void> => invoke("set_video_duration", { videoId, durationSeconds });
