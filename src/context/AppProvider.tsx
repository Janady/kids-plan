import { useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { AppContext } from "./AppContext";
import { getSetting, setSetting } from "../api/settings";
import { getTodayWatchedSeconds, getTodayAudioSeconds } from "../api/sessions";
import { listBackgroundAudio } from "../api/plans";
import type { BlockedTimeRange, BackgroundAudioPlan, LoopMode } from "../types";

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
  const [todayAudioSeconds, setTodayAudioSeconds] = useState(0);
  const [maxContinuousSeconds, setMaxContinuousSeconds] = useState(DEFAULT_MAX_CONTINUOUS);
  const [breakDurationSeconds, setBreakDurationSeconds] = useState(DEFAULT_BREAK_DURATION);
  const [blockedRanges, setBlockedRanges] = useState<BlockedTimeRange[]>([]);
  const [isBreakRequired, setIsBreakRequired] = useState(() => {
    const stored = localStorage.getItem("breakEndsAt");
    const ts = stored ? parseInt(stored, 10) : NaN;
    return !isNaN(ts) && ts > Date.now();
  });
  const [breakRemainingSeconds, setBreakRemainingSeconds] = useState(0);
  const [isBedtime, setIsBedtime] = useState(false);
  const [isParentMode, setIsParentMode] = useState(
    () => localStorage.getItem("parentMode") === "true"
  );

  // Background audio state
  const [bgAudioPlans, setBgAudioPlans] = useState<BackgroundAudioPlan[]>([]);
  const [bgCurrentPlanId, setBgCurrentPlanId] = useState<number | null>(null);
  const [bgCurrentTrackIdx, setBgCurrentTrackIdx] = useState(0);
  const [bgScopePlanId, setBgScopePlanId] = useState<number | null>(null); // null = all plans
  const [bgIsPlaying, setBgIsPlaying] = useState(false);
  const [bgLoopMode, setBgLoopMode] = useState<LoopMode>("all");
  const [bgFullscreen, setBgFullscreen] = useState(false);
  const bgManuallyStopped = useRef(false);
  const bgAutoStartedRef = useRef(false);

  const continuousStartRef = useRef<number | null>(null);
  const pauseResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persist break-end timestamp so a forced break survives app restart
  const breakEndsAtRef = useRef<number | null>(
    (() => {
      const stored = localStorage.getItem("breakEndsAt");
      const ts = stored ? parseInt(stored, 10) : NaN;
      return !isNaN(ts) && ts > Date.now() ? ts : null;
    })()
  );

  const refreshTodayTotal = useCallback(async () => {
    const [video, audio] = await Promise.all([
      getTodayWatchedSeconds(),
      getTodayAudioSeconds(),
    ]);
    setTodayWatchedSeconds(video);
    setTodayAudioSeconds(audio);
  }, []);

  const bgRefreshPlans = useCallback(async () => {
    const plans = await listBackgroundAudio();
    // Sort tracks within each plan by play count (most-played first)
    const sorted = plans.map((p) => ({
      ...p,
      tracks: [...p.tracks].sort((a, b) => b.play_count_30d - a.play_count_30d),
    }));
    setBgAudioPlans(sorted);
    setBgCurrentPlanId((prev) => {
      if (prev !== null && sorted.some((p) => p.id === prev)) return prev;
      return sorted.length > 0 ? sorted[0].id : null;
    });
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
    bgRefreshPlans();
  }, [refreshTodayTotal, bgRefreshPlans]);

  // Auto-start background audio when video limit is first exceeded
  useEffect(() => {
    const isExceeded = todayWatchedSeconds >= dailyLimitSeconds;
    if (isExceeded && !bgAutoStartedRef.current && bgAudioPlans.length > 0 && !bgManuallyStopped.current) {
      bgAutoStartedRef.current = true;
      setBgIsPlaying(true);
    }
    if (!isExceeded) {
      bgAutoStartedRef.current = false;
    }
  }, [todayWatchedSeconds, dailyLimitSeconds, bgAudioPlans.length]);

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
          const endsAt = Date.now() + breakDurationSeconds * 1000;
          breakEndsAtRef.current = endsAt;
          localStorage.setItem("breakEndsAt", String(endsAt));
          setBreakRemainingSeconds(breakDurationSeconds);
          setIsBreakRequired(true);
          continuousStartRef.current = null;
          localStorage.removeItem("continuousStart");
        }
      }
      if (isBreakRequired && breakEndsAtRef.current !== null) {
        const remaining = Math.max(0, Math.ceil((breakEndsAtRef.current - Date.now()) / 1000));
        setBreakRemainingSeconds(remaining);
      }
      setIsBedtime(blockedRanges.some((r) => isInBlockedRange(r.start, r.end)));
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [isBreakRequired, maxContinuousSeconds, breakDurationSeconds, blockedRanges]);

  const notifyVideoPlay = useCallback(() => {
    if (pauseResetTimerRef.current) { clearTimeout(pauseResetTimerRef.current); pauseResetTimerRef.current = null; }
    if (continuousStartRef.current === null) {
      // Resume a persisted continuous-watch window only if it's still fresh.
      // A stale value can linger in localStorage when the app is killed/backgrounded
      // before the pause-reset timer fires; resuming it the next day would compute a
      // huge "elapsed" and wrongly force a break on open. Treat anything older than
      // the max continuous window as expired and start fresh.
      const stored = localStorage.getItem("continuousStart");
      const ts = stored ? parseInt(stored, 10) : NaN;
      const fresh = !isNaN(ts) && Date.now() - ts < maxContinuousSeconds * 1000;
      const start = fresh ? ts : Date.now();
      continuousStartRef.current = start;
      localStorage.setItem("continuousStart", String(start));
    }
  }, [maxContinuousSeconds]);

  const notifyVideoPause = useCallback(() => {
    pauseResetTimerRef.current = setTimeout(() => {
      continuousStartRef.current = null;
      localStorage.removeItem("continuousStart");
    }, 5 * 60 * 1000);
  }, []);

  const dismissBreak = useCallback(() => {
    if (breakRemainingSeconds <= 0) {
      setIsBreakRequired(false);
      breakEndsAtRef.current = null;
      localStorage.removeItem("breakEndsAt");
    }
  }, [breakRemainingSeconds]);

  const toggleParentMode = useCallback(
    async (password?: string) => {
      if (isParentMode) {
        setIsParentMode(false);
        localStorage.setItem("parentMode", "false");
        return { success: true };
      }
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

  // ── Background audio controls ────────────────────────────────────────────────

  // Flattened track list for the active scope.
  // scope = null → every background plan's tracks in order (cross-plan playback).
  // scope = <id> → only that plan's tracks.
  const bgScopedTracks = useCallback((): { planId: number; idx: number }[] => {
    const plans =
      bgScopePlanId === null
        ? bgAudioPlans
        : bgAudioPlans.filter((p) => p.id === bgScopePlanId);
    return plans.flatMap((p) => p.tracks.map((_, idx) => ({ planId: p.id, idx })));
  }, [bgAudioPlans, bgScopePlanId]);

  const bgTogglePlay = useCallback(() => {
    setBgIsPlaying((prev) => {
      const next = !prev;
      bgManuallyStopped.current = !next;
      return next;
    });
  }, []);

  const bgSetPlan = useCallback((planId: number) => {
    setBgCurrentPlanId(planId);
    setBgCurrentTrackIdx(0);
    setBgIsPlaying(true);
    bgManuallyStopped.current = false;
  }, []);

  const bgSetTrack = useCallback((planId: number, idx: number) => {
    setBgCurrentPlanId(planId);
    setBgCurrentTrackIdx(idx);
    setBgIsPlaying(true);
    bgManuallyStopped.current = false;
  }, []);

  // Lock playback to a single plan (and start it), or null for all plans.
  // Locking always jumps to the plan's first track and plays — this is the single
  // "play this directory" action (scope + play merged).
  const bgSetScope = useCallback((planId: number | null) => {
    setBgScopePlanId(planId);
    if (planId !== null) {
      const target = bgAudioPlans.find((p) => p.id === planId);
      if (target && target.tracks.length > 0) {
        setBgCurrentPlanId(planId);
        setBgCurrentTrackIdx(0);
        setBgIsPlaying(true);
        bgManuallyStopped.current = false;
      }
    }
  }, [bgAudioPlans]);

  // Find the current track's position within the scoped flat list
  const bgScopedPos = useCallback(
    (flat: { planId: number; idx: number }[]) =>
      flat.findIndex((t) => t.planId === bgCurrentPlanId && t.idx === bgCurrentTrackIdx),
    [bgCurrentPlanId, bgCurrentTrackIdx]
  );

  const bgGoTo = useCallback((t: { planId: number; idx: number }) => {
    setBgCurrentPlanId(t.planId);
    setBgCurrentTrackIdx(t.idx);
  }, []);

  // Random position in the flat list, avoiding the current one when possible
  const randomPos = useCallback((count: number, current: number): number => {
    if (count <= 1) return 0;
    let i = Math.floor(Math.random() * (count - 1));
    if (i >= current) i += 1;
    return i;
  }, []);

  const bgNext = useCallback(() => {
    const flat = bgScopedTracks();
    if (flat.length === 0) return;
    const pos = bgScopedPos(flat);
    if (bgLoopMode === "shuffle") {
      bgGoTo(flat[randomPos(flat.length, pos < 0 ? 0 : pos)]);
      return;
    }
    const nextPos = pos < 0 ? 0 : (pos + 1) % flat.length; // wrap around
    bgGoTo(flat[nextPos]);
  }, [bgScopedTracks, bgScopedPos, bgLoopMode, bgGoTo, randomPos]);

  const bgPrev = useCallback(() => {
    const flat = bgScopedTracks();
    if (flat.length === 0) return;
    const pos = bgScopedPos(flat);
    if (bgLoopMode === "shuffle") {
      bgGoTo(flat[randomPos(flat.length, pos < 0 ? 0 : pos)]);
      return;
    }
    const prevPos = pos <= 0 ? flat.length - 1 : pos - 1;
    bgGoTo(flat[prevPos]);
  }, [bgScopedTracks, bgScopedPos, bgLoopMode, bgGoTo, randomPos]);

  const bgSetLoop = useCallback((mode: LoopMode) => {
    setBgLoopMode(mode);
  }, []);

  const bgSetFullscreen = useCallback((v: boolean) => {
    setBgFullscreen(v);
  }, []);

  // Called when a track finishes playing on its own.
  // ("track" mode is handled by the player element restarting the same track.)
  const bgOnEnded = useCallback(() => {
    const flat = bgScopedTracks();
    if (flat.length === 0) return;
    const pos = bgScopedPos(flat);
    if (bgLoopMode === "shuffle") {
      bgGoTo(flat[randomPos(flat.length, pos < 0 ? 0 : pos)]);
    } else {
      // "all" — advance across the scope and wrap around
      const nextPos = pos < 0 ? 0 : (pos + 1) % flat.length;
      bgGoTo(flat[nextPos]);
    }
  }, [bgScopedTracks, bgScopedPos, bgLoopMode, bgGoTo, randomPos]);

  return (
    <AppContext.Provider
      value={{
        dailyLimitSeconds, todayWatchedSeconds, todayAudioSeconds,
        isLimitExceeded: todayWatchedSeconds >= dailyLimitSeconds,
        setDailyLimit, refreshTodayTotal,
        maxContinuousSeconds, breakDurationSeconds, blockedRanges,
        isBreakRequired, breakRemainingSeconds, isBedtime,
        dismissBreak, notifyVideoPlay, notifyVideoPause, saveBreakSettings,
        isParentMode, toggleParentMode,
        bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx, bgScopePlanId, bgIsPlaying, bgLoopMode, bgFullscreen,
        bgRefreshPlans, bgSetPlan, bgSetTrack, bgSetScope, bgTogglePlay, bgNext, bgPrev, bgSetLoop, bgOnEnded,
        bgSetFullscreen,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
