import { invoke } from "@tauri-apps/api/core";
import type { DistributionSegment } from "../types";

export const recordWatchTick = (videoId: number): Promise<void> =>
  invoke("record_watch_tick", { videoId });

export const getTodayWatchedSeconds = (): Promise<number> =>
  invoke("get_today_watched_seconds");

export const getTodayAudioSeconds = (): Promise<number> =>
  invoke("get_today_audio_seconds");

export const getContinuousWatchSeconds = (restGapSeconds: number, since?: string): Promise<number> =>
  invoke("get_continuous_watch_seconds", { restGapSeconds, since: since ?? null });

export const getTodayDistribution = (dateKey?: string): Promise<DistributionSegment[]> =>
  invoke("get_today_distribution", { dateKey: dateKey ?? null });

export const checkDailyLimit = (): Promise<boolean> =>
  invoke("check_daily_limit");

export const recordBackgroundPlay = (videoId: number): Promise<void> =>
  invoke("record_background_play", { videoId });
