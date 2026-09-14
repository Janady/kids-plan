import { createContext, useContext } from "react";
import type { BlockedTimeRange, BackgroundAudioPlan, LoopMode, CastQueueItem, CastStateSnapshot } from "../types";

export interface AppContextValue {
  dailyLimitSeconds: number;
  todayWatchedSeconds: number;
  todayAudioSeconds: number;
  isLimitExceeded: boolean;
  setDailyLimit: (seconds: number) => Promise<void>;
  refreshTodayTotal: () => Promise<void>;
  maxContinuousSeconds: number;
  breakDurationSeconds: number;
  restGapSeconds: number;
  blockedRanges: BlockedTimeRange[];
  isBreakRequired: boolean;
  breakRemainingSeconds: number;
  isBedtime: boolean;
  dismissBreak: (force?: boolean) => void;
  notifyVideoPlay: () => void;
  notifyVideoPause: () => void;
  saveBreakSettings: (maxMin: number, breakMin: number, restGapMin: number, ranges: BlockedTimeRange[]) => Promise<void>;
  // Parent/Child mode
  isParentMode: boolean;
  toggleParentMode: (password?: string) => Promise<{ success: boolean; error?: string }>;
  // Limit exceptions (parent-authorized)
  isDailyLimitSkippedToday: boolean;
  setSkipDailyLimitToday: (enabled: boolean) => Promise<void>;
  skipBreakOnce: (password: string) => Promise<{ success: boolean; error?: string }>;
  skipContinuousLimitToday: (password: string) => Promise<{ success: boolean; error?: string }>;
  // Whether children may skip ahead: drag the seek bar past watched position,
  // finish an episode early, or mark one as "already watched" without playing it
  allowSkipPlayback: boolean;
  setAllowSkipPlayback: (enabled: boolean) => Promise<void>;
  // Background audio player
  bgAudioPlans: BackgroundAudioPlan[];
  bgCurrentPlanId: number | null;
  bgCurrentTrackIdx: number;
  bgScopePlanId: number | null; // null = all plans; otherwise locked to one plan
  bgIsPlaying: boolean;
  bgLoopMode: LoopMode;
  bgFullscreen: boolean;
  bgRefreshPlans: () => Promise<BackgroundAudioPlan[]>;
  bgSetPlan: (planId: number) => void;
  bgSetTrack: (planId: number, idx: number) => void;
  bgSetScope: (planId: number | null) => void;
  bgTogglePlay: () => void;
  bgStop: () => void;
  bgNext: () => void;
  bgPrev: () => void;
  bgSetLoop: (mode: LoopMode) => void;
  bgOnEnded: () => void;
  bgSetFullscreen: (v: boolean) => void;
  // DLNA cast session (lifted from CastStatusBar so any video list can react)
  castSnapshot: CastStateSnapshot | null;
  isCastActive: boolean;
  switchCastVideo: (item: CastQueueItem) => Promise<{ success: boolean; error?: string }>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppProvider");
  return ctx;
}
