import { useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { AppContext } from "./AppContext";
import { getSetting, setSetting } from "../api/settings";
import { getTodayWatchedSeconds, getTodayAudioSeconds, getContinuousWatchSeconds } from "../api/sessions";
import { listBackgroundAudio } from "../api/plans";
import type { BlockedTimeRange, BackgroundAudioPlan, LoopMode } from "../types";

const DEFAULT_DAILY_LIMIT = 3600;
const DEFAULT_MAX_CONTINUOUS = 2700;
const DEFAULT_BREAK_DURATION = 300;
const DEFAULT_REST_GAP = 300;

function isInBlockedRange(start: string, end: string): boolean {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [dailyLimitSeconds, setDailyLimitSeconds] = useState(DEFAULT_DAILY_LIMIT);
  const [todayWatchedSeconds, setTodayWatchedSeconds] = useState(0);
  const [todayAudioSeconds, setTodayAudioSeconds] = useState(0);
  const [maxContinuousSeconds, setMaxContinuousSeconds] = useState(DEFAULT_MAX_CONTINUOUS);
  const [breakDurationSeconds, setBreakDurationSeconds] = useState(DEFAULT_BREAK_DURATION);
  const [restGapSeconds, setRestGapSeconds] = useState(DEFAULT_REST_GAP);
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
  const [skipDailyLimitDate, setSkipDailyLimitDate] = useState<string | null>(null);
  const [skipContinuousLimitDate, setSkipContinuousLimitDate] = useState<string | null>(null);

  // Background audio state
  const [bgAudioPlans, setBgAudioPlans] = useState<BackgroundAudioPlan[]>([]);
  const [bgCurrentPlanId, setBgCurrentPlanId] = useState<number | null>(null);
  const [bgCurrentTrackIdx, setBgCurrentTrackIdx] = useState(0);
  const [bgScopePlanId, setBgScopePlanId] = useState<number | null>(null); // null = all plans
  const [bgIsPlaying, setBgIsPlaying] = useState(false);
  const [bgLoopMode, setBgLoopMode] = useState<LoopMode>("all");
  const [bgFullscreen, setBgFullscreen] = useState(false);

  // Whether a video is currently playing — drives the continuous-watch poll below.
  const isVideoPlayingRef = useRef(false);
  // Persist break-end timestamp so a forced break survives app restart
  const breakEndsAtRef = useRef<number | null>(
    (() => {
      const stored = localStorage.getItem("breakEndsAt");
      const ts = stored ? parseInt(stored, 10) : NaN;
      return !isNaN(ts) && ts > Date.now() ? ts : null;
    })()
  );
  // When a forced break ends, ticks from before this timestamp are excluded from
  // the continuous-watch calculation — otherwise, if the user's configured rest
  // gap isn't shorter than the break duration itself, the pre-break streak still
  // counts as continuous and the break re-triggers the instant a new tick lands.
  const lastBreakEndAtRef = useRef<string | null>(null);

  const refreshTodayTotal = useCallback(async () => {
    const [video, audio] = await Promise.all([
      getTodayWatchedSeconds(),
      getTodayAudioSeconds(),
    ]);
    setTodayWatchedSeconds(video);
    setTodayAudioSeconds(audio);
  }, []);

  const bgRefreshPlans = useCallback(async () => {
    // Tracks arrive pre-sorted by plan + file order (backend ORDER BY sort_order)
    const plans = await listBackgroundAudio();
    setBgAudioPlans(plans);
    setBgCurrentPlanId((prev) => {
      if (prev !== null && plans.some((p) => p.id === prev)) return prev;
      return plans.length > 0 ? plans[0].id : null;
    });
  }, []);

  useEffect(() => {
    Promise.all([
      getSetting("daily_limit_seconds"),
      getSetting("max_continuous_minutes"),
      getSetting("break_duration_minutes"),
      getSetting("rest_gap_minutes"),
      getSetting("blocked_time_ranges"),
      getSetting("skip_daily_limit_date"),
      getSetting("skip_continuous_limit_date"),
    ]).then(([limit, maxCont, breakDur, restGap, blocked, skipDaily, skipCont]) => {
      if (limit) setDailyLimitSeconds(parseInt(limit, 10));
      if (maxCont) setMaxContinuousSeconds(parseInt(maxCont, 10) * 60);
      if (breakDur) setBreakDurationSeconds(parseInt(breakDur, 10) * 60);
      if (restGap) setRestGapSeconds(parseInt(restGap, 10) * 60);
      if (blocked) { try { setBlockedRanges(JSON.parse(blocked)); } catch {} }
      if (skipDaily) setSkipDailyLimitDate(skipDaily);
      if (skipCont) setSkipContinuousLimitDate(skipCont);
    });
    refreshTodayTotal();
    bgRefreshPlans();
  }, [refreshTodayTotal, bgRefreshPlans]);

  const setDailyLimit = useCallback(async (seconds: number) => {
    await setSetting("daily_limit_seconds", String(seconds));
    setDailyLimitSeconds(seconds);
  }, []);

  const saveBreakSettings = useCallback(
    async (maxMin: number, breakMin: number, restGapMin: number, ranges: BlockedTimeRange[]) => {
      await Promise.all([
        setSetting("max_continuous_minutes", String(maxMin)),
        setSetting("break_duration_minutes", String(breakMin)),
        setSetting("rest_gap_minutes", String(restGapMin)),
        setSetting("blocked_time_ranges", JSON.stringify(ranges)),
      ]);
      setMaxContinuousSeconds(maxMin * 60);
      setBreakDurationSeconds(breakMin * 60);
      setRestGapSeconds(restGapMin * 60);
      setBlockedRanges(ranges);
    },
    []
  );

  // Continuous-watch check: only meaningful while a video is actually playing,
  // so this polls the backend (which derives it from real tick timestamps,
  // not wall-clock time) rather than tracking any elapsed time itself.
  const isDailyLimitSkippedToday = skipDailyLimitDate === todayDateKey();
  const isContinuousLimitSkippedToday = skipContinuousLimitDate === todayDateKey();

  useEffect(() => {
    const tick = async () => {
      if (isVideoPlayingRef.current && !isBreakRequired && !isContinuousLimitSkippedToday) {
        const elapsed = await getContinuousWatchSeconds(restGapSeconds, lastBreakEndAtRef.current ?? undefined);
        if (elapsed >= maxContinuousSeconds) {
          const endsAt = Date.now() + breakDurationSeconds * 1000;
          breakEndsAtRef.current = endsAt;
          localStorage.setItem("breakEndsAt", String(endsAt));
          setBreakRemainingSeconds(breakDurationSeconds);
          setIsBreakRequired(true);
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
  }, [isBreakRequired, maxContinuousSeconds, breakDurationSeconds, restGapSeconds, blockedRanges, isContinuousLimitSkippedToday]);

  const notifyVideoPlay = useCallback(() => {
    isVideoPlayingRef.current = true;
  }, []);

  const notifyVideoPause = useCallback(() => {
    isVideoPlayingRef.current = false;
  }, []);

  const dismissBreak = useCallback((force = false) => {
    if (force || breakRemainingSeconds <= 0) {
      setIsBreakRequired(false);
      breakEndsAtRef.current = null;
      lastBreakEndAtRef.current = new Date().toISOString();
      localStorage.removeItem("breakEndsAt");
    }
  }, [breakRemainingSeconds]);

  const verifyParentPassword = useCallback(async (password: string) => {
    const stored = await getSetting("parent_password");
    return !(stored && stored !== "" && stored !== password);
  }, []);

  const toggleParentMode = useCallback(
    async (password?: string) => {
      if (isParentMode) {
        setIsParentMode(false);
        localStorage.setItem("parentMode", "false");
        return { success: true };
      }
      const ok = await verifyParentPassword(password ?? "");
      if (!ok) {
        return { success: false, error: "密码不正确" };
      }
      setIsParentMode(true);
      localStorage.setItem("parentMode", "true");
      return { success: true };
    },
    [isParentMode, verifyParentPassword]
  );

  const setSkipDailyLimitToday = useCallback(async (enabled: boolean) => {
    const value = enabled ? todayDateKey() : "";
    await setSetting("skip_daily_limit_date", value);
    setSkipDailyLimitDate(enabled ? value : null);
  }, []);

  const skipBreakOnce = useCallback(
    async (password: string) => {
      const ok = await verifyParentPassword(password);
      if (!ok) return { success: false, error: "密码不正确" };
      dismissBreak(true);
      return { success: true };
    },
    [verifyParentPassword, dismissBreak]
  );

  const skipContinuousLimitToday = useCallback(
    async (password: string) => {
      const ok = await verifyParentPassword(password);
      if (!ok) return { success: false, error: "密码不正确" };
      const value = todayDateKey();
      await setSetting("skip_continuous_limit_date", value);
      setSkipContinuousLimitDate(value);
      dismissBreak(true);
      return { success: true };
    },
    [verifyParentPassword, dismissBreak]
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
    setBgIsPlaying((prev) => !prev);
  }, []);

  // Stop background playback (e.g. when entering the video player).
  const bgStop = useCallback(() => {
    setBgIsPlaying(false);
  }, []);

  const bgSetPlan = useCallback((planId: number) => {
    setBgCurrentPlanId(planId);
    setBgCurrentTrackIdx(0);
    setBgIsPlaying(true);
  }, []);

  const bgSetTrack = useCallback((planId: number, idx: number) => {
    setBgCurrentPlanId(planId);
    setBgCurrentTrackIdx(idx);
    setBgIsPlaying(true);
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
        isLimitExceeded: !isDailyLimitSkippedToday && todayWatchedSeconds >= dailyLimitSeconds,
        setDailyLimit, refreshTodayTotal,
        maxContinuousSeconds, breakDurationSeconds, restGapSeconds, blockedRanges,
        isBreakRequired, breakRemainingSeconds, isBedtime,
        dismissBreak, notifyVideoPlay, notifyVideoPause, saveBreakSettings,
        isParentMode, toggleParentMode,
        isDailyLimitSkippedToday, setSkipDailyLimitToday, skipBreakOnce, skipContinuousLimitToday,
        bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx, bgScopePlanId, bgIsPlaying, bgLoopMode, bgFullscreen,
        bgRefreshPlans, bgSetPlan, bgSetTrack, bgSetScope, bgTogglePlay, bgStop, bgNext, bgPrev, bgSetLoop, bgOnEnded,
        bgSetFullscreen,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
