import { createContext, useContext } from "react";
import type { BlockedTimeRange } from "../types";

export interface AppContextValue {
  dailyLimitSeconds: number;
  todayWatchedSeconds: number;
  isLimitExceeded: boolean;
  setDailyLimit: (seconds: number) => Promise<void>;
  refreshTodayTotal: () => Promise<void>;
  maxContinuousSeconds: number;
  breakDurationSeconds: number;
  blockedRanges: BlockedTimeRange[];
  isBreakRequired: boolean;
  breakRemainingSeconds: number;
  isBedtime: boolean;
  dismissBreak: () => void;
  notifyVideoPlay: () => void;
  notifyVideoPause: () => void;
  saveBreakSettings: (maxMin: number, breakMin: number, ranges: BlockedTimeRange[]) => Promise<void>;
  // Parent/Child mode
  isParentMode: boolean;
  toggleParentMode: (password?: string) => Promise<{ success: boolean; error?: string }>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppProvider");
  return ctx;
}
