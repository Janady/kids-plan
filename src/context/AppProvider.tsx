import { useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { AppContext } from "./AppContext";
import { getSetting, setSetting } from "../api/settings";
import { getTodayWatchedSeconds } from "../api/sessions";
import type { BlockedTimeRange } from "../types";

const DEFAULT_DAILY_LIMIT = 3600;
const DEFAULT_MAX_CONTINUOUS = 2700;
const DEFAULT_BREAK_DURATION = 300;

function isInBlockedRange(start: string, end: string): boolean {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [dailyLimitSeconds, setDailyLimitSeconds] = useState(DEFAULT_DAILY_LIMIT);
  const [todayWatchedSeconds, setTodayWatchedSeconds] = useState(0);
  const [maxContinuousSeconds, setMaxContinuousSeconds] = useState(DEFAULT_MAX_CONTINUOUS);
  const [breakDurationSeconds, setBreakDurationSeconds] = useState(DEFAULT_BREAK_DURATION);
  const [blockedRanges, setBlockedRanges] = useState<BlockedTimeRange[]>([]);
  const [isBreakRequired, setIsBreakRequired] = useState(false);
  const [breakRemainingSeconds, setBreakRemainingSeconds] = useState(0);
  const [isBedtime, setIsBedtime] = useState(false);
  const [isParentMode, setIsParentMode] = useState(
    () => localStorage.getItem("parentMode") === "true"
  );

  const continuousStartRef = useRef<number | null>(null);
  const pauseResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breakEndsAtRef = useRef<number | null>(null);

  const refreshTodayTotal = useCallback(async () => {
    const total = await getTodayWatchedSeconds();
    setTodayWatchedSeconds(total);
  }, []);

  useEffect(() => {
    Promise.all([
      getSetting("daily_limit_seconds"),
      getSetting("max_continuous_minutes"),
      getSetting("break_duration_minutes"),
      getSetting("blocked_time_ranges"),
    ]).then(([limit, maxCont, breakDur, blocked]) => {
      if (limit) setDailyLimitSeconds(parseInt(limit, 10));
      if (maxCont) setMaxContinuousSeconds(parseInt(maxCont, 10) * 60);
      if (breakDur) setBreakDurationSeconds(parseInt(breakDur, 10) * 60);
      if (blocked) { try { setBlockedRanges(JSON.parse(blocked)); } catch {} }
    });
    refreshTodayTotal();
  }, [refreshTodayTotal]);

  const setDailyLimit = useCallback(async (seconds: number) => {
    await setSetting("daily_limit_seconds", String(seconds));
    setDailyLimitSeconds(seconds);
  }, []);

  const saveBreakSettings = useCallback(
    async (maxMin: number, breakMin: number, ranges: BlockedTimeRange[]) => {
      await Promise.all([
        setSetting("max_continuous_minutes", String(maxMin)),
        setSetting("break_duration_minutes", String(breakMin)),
        setSetting("blocked_time_ranges", JSON.stringify(ranges)),
      ]);
      setMaxContinuousSeconds(maxMin * 60);
      setBreakDurationSeconds(breakMin * 60);
      setBlockedRanges(ranges);
    },
    []
  );

  useEffect(() => {
    const tick = () => {
      if (continuousStartRef.current !== null && !isBreakRequired) {
        const elapsed = (Date.now() - continuousStartRef.current) / 1000;
        if (elapsed >= maxContinuousSeconds) {
          breakEndsAtRef.current = Date.now() + breakDurationSeconds * 1000;
          setBreakRemainingSeconds(breakDurationSeconds);
          setIsBreakRequired(true);
          continuousStartRef.current = null;
        }
      }
      if (isBreakRequired && breakEndsAtRef.current !== null) {
        const remaining = Math.max(0, Math.ceil((breakEndsAtRef.current - Date.now()) / 1000));
        setBreakRemainingSeconds(remaining);
      }
      setIsBedtime(blockedRanges.some((r) => isInBlockedRange(r.start, r.end)));
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [isBreakRequired, maxContinuousSeconds, breakDurationSeconds, blockedRanges]);

  const notifyVideoPlay = useCallback(() => {
    if (pauseResetTimerRef.current) { clearTimeout(pauseResetTimerRef.current); pauseResetTimerRef.current = null; }
    if (continuousStartRef.current === null) continuousStartRef.current = Date.now();
  }, []);

  const notifyVideoPause = useCallback(() => {
    pauseResetTimerRef.current = setTimeout(() => { continuousStartRef.current = null; }, 5 * 60 * 1000);
  }, []);

  const dismissBreak = useCallback(() => {
    if (breakRemainingSeconds <= 0) {
      setIsBreakRequired(false);
      breakEndsAtRef.current = null;
    }
  }, [breakRemainingSeconds]);

  const toggleParentMode = useCallback(
    async (password?: string) => {
      if (isParentMode) {
        // Exit parent mode — no password needed
        setIsParentMode(false);
        localStorage.setItem("parentMode", "false");
        return { success: true };
      }
      // Enter parent mode — check password if set
      const stored = await getSetting("parent_password");
      if (stored && stored !== "" && stored !== password) {
        return { success: false, error: "密码不正确" };
      }
      setIsParentMode(true);
      localStorage.setItem("parentMode", "true");
      return { success: true };
    },
    [isParentMode]
  );

  return (
    <AppContext.Provider
      value={{
        dailyLimitSeconds, todayWatchedSeconds,
        isLimitExceeded: todayWatchedSeconds >= dailyLimitSeconds,
        setDailyLimit, refreshTodayTotal,
        maxContinuousSeconds, breakDurationSeconds, blockedRanges,
        isBreakRequired, breakRemainingSeconds, isBedtime,
        dismissBreak, notifyVideoPlay, notifyVideoPause, saveBreakSettings,
        isParentMode, toggleParentMode,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
