import { createContext, useContext } from "react";
import type { BlockedTimeRange, BackgroundAudioPlan, LoopMode } from "../types";

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
  dismissBreak: () => void;
  notifyVideoPlay: () => void;
  notifyVideoPause: () => void;
  saveBreakSettings: (maxMin: number, breakMin: number, restGapMin: number, ranges: BlockedTimeRange[]) => Promise<void>;
  // Parent/Child mode
  isParentMode: boolean;
  toggleParentMode: (password?: string) => Promise<{ success: boolean; error?: string }>;
  // Background audio player
  bgAudioPlans: BackgroundAudioPlan[];
  bgCurrentPlanId: number | null;
  bgCurrentTrackIdx: number;
  bgScopePlanId: number | null; // null = all plans; otherwise locked to one plan
  bgIsPlaying: boolean;
  bgLoopMode: LoopMode;
  bgFullscreen: boolean;
  bgRefreshPlans: () => Promise<void>;
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
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppProvider");
  return ctx;
}
