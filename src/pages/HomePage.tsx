import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getTodaySchedule } from "../api/schedule";
import { listPlans } from "../api/plans";
import { markVideoWatchedEarlier } from "../api/videos";
import { getVideoUrl } from "../api/videoSrc";
import { getCachedThumbnail, cacheThumbnail } from "../api/thumbnails";
import { useAppContext } from "../context/AppContext";
import { usePlatform } from "../hooks/usePlatform";
import { CastDevicePickerModal } from "../components/CastDevicePickerModal";
import type { TodayPlanItem, TodayPendingItem, Plan, CastQueueItem } from "../types";

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}


// ─── Lazy video thumbnail ─────────────────────────────────────────────────────
// Only creates the <video> element when the card scrolls into view.
// Clears src on unmount so Chromium releases the buffered media data.
//
// Every re-mount used to re-fetch the video over the (Android-only) local
// HTTP server just to grab one preview frame — with rootMargin pulling most
// cards into view at once, repeatedly navigating home rapidly saturates that
// server's small connection budget. So before touching the video at all, we
// check a Rust-side in-memory cache (keyed by file path) over plain Tauri IPC;
// a hit renders an <img> with zero network involvement. On a miss we decode
// exactly as before, then opportunistically snapshot the frame into that
// cache for next time — best-effort, so if it ever fails the thumbnail still
// renders exactly as it always has.

const THUMB_RETRY_DELAYS = [1000, 2000, 4000, 8000];
const THUMB_MAX_WIDTH = 320;
// Same time-based backstop as PlayerPage: a hung (not failed) request never
// fires 'error', so THUMB_RETRY_DELAYS alone can leave a card stuck loading
// forever. See PlayerPage.tsx's STALL_TIMEOUTS for the full rationale.
const THUMB_STALL_TIMEOUTS = [2000, 3000, 5000, 8000];

function LazyVideoThumb({ filePath }: { filePath: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const [cacheChecked, setCacheChecked] = useState(false);
  const [cachedUrl, setCachedUrl] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturedRef = useRef(false);

  // Start observing once; disconnect after first intersection (stay loaded)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect(); } },
      { rootMargin: "80px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Check the Rust-side cache before ever creating a <video> element.
  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    getCachedThumbnail(filePath)
      .then((url) => { if (!cancelled) setCachedUrl(url); })
      .catch(() => { if (!cancelled) setCachedUrl(null); })
      .finally(() => { if (!cancelled) setCacheChecked(true); });
    return () => { cancelled = true; };
  }, [inView, filePath]);

  // Critical: release buffered video data when the card unmounts
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      const v = videoRef.current;
      if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    };
  }, []);

  // Arm the stall watchdog once a fresh load actually starts (initial mount
  // on cache miss, and again after each retry below, and again around the
  // post-metadata seek — each of those is its own network request that can
  // hang instead of failing).
  const armStallWatchdog = () => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    const timeout = THUMB_STALL_TIMEOUTS[Math.min(retryCountRef.current, THUMB_STALL_TIMEOUTS.length - 1)];
    stallTimerRef.current = setTimeout(() => { handleError(); }, timeout);
  };

  // Guards the initial connect + metadata fetch as soon as the <video>
  // element mounts with a src (cache miss). Re-armed for the seek in
  // onLoadedMetadata below and for each retry inside handleError.
  useEffect(() => {
    if (!inView || !cacheChecked || cachedUrl) return;
    armStallWatchdog();
    return () => { if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, cacheChecked, cachedUrl, filePath]);

  // The local video server has a small shared per-origin connection budget
  // (browsers cap ~6 concurrent HTTP/1.1 connections per host:port), so a
  // thumbnail can transiently fail to grab a socket while other cards or the
  // active player are using it. <video> doesn't retry network errors on its
  // own, so without this the card stays broken even once a slot frees up.
  const handleError = () => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    if (retryCountRef.current >= THUMB_RETRY_DELAYS.length) return;
    const delay = THUMB_RETRY_DELAYS[retryCountRef.current];
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      videoRef.current?.load();
      armStallWatchdog();
    }, delay);
  };

  // Fires once the seeked-to frame is actually decoded and ready. Snapshot it
  // into the shared thumbnail cache so future mounts skip the video server
  // entirely for this file.
  const handleSeeked = () => {
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    if (capturedRef.current) return;
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    capturedRef.current = true;
    try {
      const scale = Math.min(1, THUMB_MAX_WIDTH / v.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      cacheThumbnail(filePath, dataUrl).catch(() => {});
    } catch {
      // Tainted canvas or transient decode failure — the <video> thumbnail
      // still renders normally, we just skip caching this one.
    }
  };

  if (inView && cacheChecked && cachedUrl) {
    return (
      <div ref={wrapRef} className="absolute inset-0 bg-gray-900">
        <img
          src={cachedUrl}
          className="w-full h-full object-cover"
          style={{ pointerEvents: "none" }}
        />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="absolute inset-0 bg-gray-900">
      {inView && cacheChecked && (
        <video
          ref={videoRef}
          src={getVideoUrl(filePath)}
          crossOrigin="anonymous"
          preload="metadata"
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ pointerEvents: "none" }}
          onLoadedMetadata={(e) => {
            armStallWatchdog();
            const el = e.currentTarget;
            el.currentTime = Math.min(3, (el.duration || 3) * 0.15);
          }}
          onSeeked={handleSeeked}
          onError={handleError}
        />
      )}
    </div>
  );
}

// ─── Task card ────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TodayPendingItem;
  planId: number;
  planName: string;
  isLocked: boolean;
  onMarkWatched: (videoId: number) => void;
}

function TaskCard({ task, planId, planName, isLocked, onMarkWatched }: TaskCardProps) {
  const navigate = useNavigate();
  const { isCastActive, castSnapshot, switchCastVideo, allowSkipPlayback } = useAppContext();
  const isWatching = task.video_status === "watching";
  const isAudio = task.media_type === "audio";
  const isCastingThis = castSnapshot?.current?.video_id === task.video_id;
  const pct =
    isWatching && task.video_duration && task.video_duration > 0
      ? Math.min(100, (task.video_progress / task.video_duration) * 100)
      : 0;

  const handleClick = () => {
    if (isLocked) return;
    if (!isAudio && isCastActive) {
      switchCastVideo({
        video_id: task.video_id,
        file_path: task.file_path,
        title: task.video_title,
        duration_seconds: task.video_duration,
      }).catch(() => {});
      return;
    }
    navigate(`/plan/${planId}/video/${task.video_id}`);
  };

  // Audio tasks get a distinct purple theme + icon-based cover (no video thumbnail)
  const accentHover = isAudio
    ? "hover:border-purple-500 focus:border-purple-500 hover:shadow-purple-900/20 focus:shadow-purple-900/20"
    : "hover:border-sky-500 focus:border-sky-500 hover:shadow-sky-900/20 focus:shadow-sky-900/20";

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
      tabIndex={isLocked ? -1 : 0}
      role="button"
      className={`group rounded-xl overflow-hidden border transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 ${
        isAudio ? "focus:ring-purple-400" : "focus:ring-sky-400"
      } ${
        isLocked
          ? "border-gray-800 opacity-50 cursor-not-allowed"
          : `border-gray-700 cursor-pointer hover:shadow-lg focus:shadow-lg ${accentHover}`
      } bg-gray-800`}
    >
      {/* Cover */}
      <div className="relative aspect-video bg-gray-900 overflow-hidden">
        {isAudio ? (
          // Audio: vinyl disc + equalizer waveform (CSS only, no media loaded)
          <div
            className="absolute inset-0 flex items-center justify-center overflow-hidden"
            style={{ background: "radial-gradient(circle at 50% 38%, #2a1f45 0%, #14101f 78%)" }}
          >
            {/* Vinyl record with grooves */}
            <div
              className="relative w-20 h-20 rounded-full flex items-center justify-center"
              style={{
                background:
                  "repeating-radial-gradient(circle at 50% 50%, #1a1428 0px, #1a1428 2px, #241a38 3px, #1a1428 4px)",
                border: "1px solid rgba(167,139,250,0.25)",
                animation: isWatching ? "vinylspin 4s linear infinite" : "none",
              }}
            >
              {/* Center label */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "rgba(167,139,250,0.25)" }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-purple-200/70" />
              </div>
            </div>

            {/* Equalizer bars along the bottom */}
            <div className="absolute bottom-3 left-0 right-0 flex items-end justify-center gap-[3px] h-6">
              {[0.5, 0.8, 0.4, 1, 0.6, 0.9, 0.45, 0.75, 0.55].map((base, bi) => (
                <span
                  key={bi}
                  className="w-[3px] rounded-full bg-purple-400/70"
                  style={{
                    height: `${base * 100}%`,
                    transformOrigin: "bottom",
                    animation: isWatching ? `eq 900ms ease-in-out ${bi * 90}ms infinite alternate` : "none",
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <LazyVideoThumb filePath={task.file_path} />
        )}

        {/* Dim overlay + play icon */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all ${
            isLocked ? "bg-black/50" : "bg-black/30 group-hover:bg-black/15"
          }`}
        >
          {isLocked ? (
            <span className="text-2xl">🔒</span>
          ) : isCastingThis ? (
            <div className="px-3 py-1.5 rounded-full bg-sky-500/90 text-white text-xs font-semibold flex items-center gap-1">
              <span>📺</span> 投屏中
            </div>
          ) : (
            <div className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-white text-base pl-0.5">▶</span>
            </div>
          )}
        </div>

        {/* Media-type badge (top-right) */}
        <div
          className={`absolute top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            isAudio ? "bg-purple-500/90 text-white" : "bg-sky-500/90 text-white"
          }`}
        >
          {isAudio ? "🎵 音频" : "🎬 视频"}
        </div>

        {/* Watch progress bar at bottom of cover */}
        {isWatching && pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
            <div className={`h-full ${isAudio ? "bg-purple-400" : "bg-yellow-400"}`} style={{ width: `${pct}%` }} />
          </div>
        )}

        {/* Watching badge (top-left) */}
        {isWatching && (
          <div className="absolute top-2 left-2 text-[10px] bg-yellow-500/90 text-black font-semibold px-1.5 py-0.5 rounded">
            {isAudio ? "继续收听" : "继续观看"}
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="px-3 pt-2.5 pb-3">
        <div className={`text-[10px] font-medium truncate mb-1 ${isAudio ? "text-purple-400" : "text-sky-400"}`}>
          {planName}
        </div>
        <div className="text-sm font-medium text-gray-200 line-clamp-2 leading-snug mb-1.5">
          {task.video_title}
        </div>
        {isWatching && task.video_progress > 0 ? (
          <div className={`text-[10px] ${isAudio ? "text-purple-400" : "text-yellow-400"}`}>
            {isAudio ? "已听至" : "已看至"} {formatTime(task.video_progress)}
            {task.video_duration ? ` / ${formatTime(task.video_duration)}` : ""}
          </div>
        ) : task.video_duration ? (
          <div className="text-[10px] text-gray-600">{formatTime(task.video_duration)}</div>
        ) : null}

        {/* Mark as already-watched (skip without using today's quota) */}
        {!isLocked && allowSkipPlayback && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("标记为「之前已看过」？将跳过此条且不占用今日名额。")) {
                onMarkWatched(task.video_id);
              }
            }}
            className="mt-2 text-[10px] text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-500 rounded px-2 py-0.5 transition-colors"
          >
            ✓ 之前已看过
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const navigate = useNavigate();
  const { isLimitExceeded, todayWatchedSeconds, todayAudioSeconds, dailyLimitSeconds, bgAudioPlans, bgSetTrack, bgCurrentPlanId, bgCurrentTrackIdx, bgIsPlaying, bgSetFullscreen, isParentMode, toggleParentMode } = useAppContext();
  const { isTV, isAndroid } = usePlatform();
  const [todayItems, setTodayItems] = useState<TodayPlanItem[]>([]);
  const [allPlans, setAllPlans] = useState<Plan[]>([]);
  const [showCastPicker, setShowCastPicker] = useState(false);

  // Flatten background tracks from AppContext (already loaded, includes play_count_30d)
  const bgTopTracks = bgAudioPlans
    .flatMap((plan) => plan.tracks)
    .sort((a, b) => b.play_count_30d - a.play_count_30d)
    .slice(0, 5);

  const loadData = useCallback(async () => {
    const [schedule, plans] = await Promise.all([getTodaySchedule(), listPlans()]);
    setTodayItems(schedule);
    setAllPlans(plans);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleMarkWatched = useCallback(async (videoId: number) => {
    await markVideoWatchedEarlier(videoId);
    await loadData();
  }, [loadData]);

  // Flatten all pending tasks across active plans
  const allPendingTasks = todayItems.flatMap((item) =>
    item.pending.map((task) => ({
      task,
      planId: item.plan_id,
      planName: item.plan_name,
    }))
  );

  // Find the matching plan for each item to check priority lock
  const planMap = new Map(allPlans.map((p) => [p.id, p]));

  const completedItems = todayItems.flatMap((item) =>
    item.done_today.map((d) => ({ ...d, planName: item.plan_name }))
  );

  const hasActivePlans = todayItems.length > 0;
  const allDoneToday = hasActivePlans && allPendingTasks.length === 0;

  // Cast queue: same flattened order as allPendingTasks above (plan priority,
  // then within-plan sort order — get_today_schedule already returns it that
  // way), audio-only items excluded for v1.
  const castQueue: CastQueueItem[] = allPendingTasks
    .filter(({ task }) => task.media_type === "video")
    .map(({ task }) => ({
      video_id: task.video_id,
      file_path: task.file_path,
      title: task.video_title,
      duration_seconds: task.video_duration,
    }));

  return (
    <div>
      {showCastPicker && (
        <CastDevicePickerModal
          queue={castQueue}
          onCancel={() => setShowCastPicker(false)}
          onStarted={() => setShowCastPicker(false)}
        />
      )}
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-100">今日学习</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {new Date().toLocaleDateString("zh-CN", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          {/* 手机端进度条（NavBar 不显示时在此展示） */}
          {isAndroid && !isTV && (() => {
            const pct = Math.min(100, Math.round((todayWatchedSeconds / dailyLimitSeconds) * 100));
            return (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-sky-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-xs shrink-0 ${pct >= 100 ? "text-red-400" : "text-gray-500"}`}>
                    {formatSeconds(todayWatchedSeconds)}/{formatSeconds(dailyLimitSeconds)}
                  </span>
                </div>
                {todayAudioSeconds > 0 && (
                  <div className="text-[10px] text-purple-400">
                    🎵 音频学习 {formatSeconds(todayAudioSeconds)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAndroid && !isTV && !isParentMode && castQueue.length > 0 && (
            <button
              onClick={() => setShowCastPicker(true)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
            >
              📺 投屏
            </button>
          )}
        </div>
      </div>

      {/* ── Today's tasks ── */}
      {/* In parent mode, playback records no progress and can't advance tasks,
          so showing today's tasks would be misleading (and tempting to use by
          mistake). Hide them and prompt to switch back to child mode. */}
      {isParentMode ? (
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl px-6 py-8 text-center mb-8">
          <p className="text-3xl mb-3">👨‍👦</p>
          <p className="text-amber-300 font-medium mb-1">家长模式中，今日任务已隐藏</p>
          <p className="text-sm text-gray-500 mb-4">
            家长模式下播放不计时、不推进任务。请切换回儿童模式再开始今日学习。
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => navigate("/plans")}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
            >
              去配置计划
            </button>
            <button
              onClick={() => toggleParentMode()}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors"
            >
              切换到儿童模式
            </button>
          </div>
        </div>
      ) : !hasActivePlans ? (
        <div className="bg-gray-800/40 border border-dashed border-gray-700 rounded-xl px-6 py-10 text-center mb-8">
          <p className="text-3xl mb-3">📋</p>
          <p className="text-gray-300 font-medium mb-1">还没有每日学习计划</p>
          <p className="text-sm text-gray-500 mb-4">
            进入某个计划，点击「加入每日计划」，首页会每天推荐要看的集数
          </p>
          <button
            onClick={() => navigate("/plans")}
            className="text-sky-400 text-sm hover:text-sky-300 transition-colors"
          >
            去计划页浏览全部计划 →
          </button>
        </div>
      ) : allDoneToday ? (
        <div className="bg-green-900/15 border border-green-800/30 rounded-xl px-6 py-8 text-center mb-8">
          <p className="text-4xl mb-3">🎉</p>
          <p className="text-green-400 font-semibold text-lg mb-1">今日任务全部完成！</p>
          <p className="text-sm text-gray-500">休息一下，明天继续</p>
        </div>
      ) : (
        <div className="mb-8">
          {/* Responsive grid: 1 col on mobile, 2 on sm, 3 on lg, 4 on xl; TV: fixed 3 cols */}
          <div className={`grid gap-4 ${isTV ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
            {allPendingTasks.map(({ task, planId, planName }) => (
              <TaskCard
                key={task.video_id}
                task={task}
                planId={planId}
                planName={planName}
                isLocked={isLimitExceeded || !!(planMap.get(planId)?.is_locked_by_priority)}
                onMarkWatched={handleMarkWatched}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Completed today (hidden in parent mode) ── */}
      {!isParentMode && completedItems.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-3">
            今日已完成 ✓
          </h2>
          <div className="flex flex-col gap-2">
            {completedItems.map((d) => (
              <div
                key={d.video_id}
                className="flex items-center gap-3 px-4 py-2.5 bg-gray-800/40 border border-gray-700/40 rounded-lg"
              >
                <span className="text-green-500 text-sm">✓</span>
                <span className="text-xs text-gray-500 shrink-0">{d.planName}</span>
                <span className="flex-1 text-sm text-gray-400 truncate">{d.video_title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Background audio section ── */}
      {bgAudioPlans.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-purple-500 uppercase tracking-wider">
              🎶 背景音乐
            </h2>
            <button
              onClick={() => navigate("/background-audio")}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              全部 →
            </button>
          </div>

          {bgTopTracks.length === 0 ? (
            /* No tracks yet — prompt to pick a plan */
            <div className="px-4 py-3 bg-purple-900/10 border border-purple-900/30 rounded-lg text-sm text-gray-500">
              还没有音频被设为背景音乐。在计划页的音频 Tab 中勾选「同时作为背景音乐」即可加入。
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {bgTopTracks.map((track) => {
                const plan = bgAudioPlans.find((p) => p.id === track.plan_id);
                const idx = plan ? plan.tracks.findIndex((t) => t.id === track.id) : -1;
                const isThisPlaying =
                  bgIsPlaying &&
                  bgCurrentPlanId === track.plan_id &&
                  plan?.tracks[bgCurrentTrackIdx]?.id === track.id;

                return (
                  <div
                    key={track.id}
                    onClick={() => {
                      if (idx >= 0) { bgSetTrack(track.plan_id, idx); bgSetFullscreen(true); }
                    }}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-all ${
                      isThisPlaying
                        ? "border-purple-600/60 bg-purple-900/25 hover:border-purple-500"
                        : "border-purple-900/30 bg-purple-900/10 hover:border-purple-700/50 hover:bg-purple-900/20"
                    }`}
                  >
                    <span className={`text-base shrink-0 ${isThisPlaying ? "text-purple-400" : "text-purple-600"}`}>
                      {isThisPlaying ? "♪" : "▶"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 truncate">{track.title}</div>
                      <div className="text-[10px] text-gray-500 truncate">{track.plan_name}</div>
                    </div>
                    {track.play_count_30d > 0 && (
                      <span className="text-[10px] text-purple-600 shrink-0">{track.play_count_30d}次</span>
                    )}
                  </div>
                );
              })}

              {/* Show-all shortcut when more tracks exist */}
              {bgAudioPlans.reduce((s, p) => s + p.tracks.length, 0) > bgTopTracks.length && (
                <button
                  onClick={() => navigate("/background-audio")}
                  className="text-xs text-purple-500 hover:text-purple-400 transition-colors text-center py-1"
                >
                  查看全部 {bgAudioPlans.reduce((s, p) => s + p.tracks.length, 0)} 首 →
                </button>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
