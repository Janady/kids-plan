import { invoke } from "@tauri-apps/api/core";
import type { WatchSessionInput } from "../types";

export const recordWatchSession = (session: WatchSessionInput): Promise<void> =>
  invoke("record_watch_session", { session });

export const getTodayWatchedSeconds = (): Promise<number> =>
  invoke("get_today_watched_seconds");

export const getTodayAudioSeconds = (): Promise<number> =>
  invoke("get_today_audio_seconds");

export const checkDailyLimit = (): Promise<boolean> =>
  invoke("check_daily_limit");

export const recordBackgroundPlay = (videoId: number): Promise<void> =>
  invoke("record_background_play", { videoId });
