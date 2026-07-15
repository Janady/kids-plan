import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { getTodaySchedule } from "../api/schedule";
import { addPlan, listPlans } from "../api/plans";
import { markVideoWatchedEarlier } from "../api/videos";
import { getSetting } from "../api/settings";
import { getVideoUrl } from "../api/videoSrc";
import { useAppContext } from "../context/AppContext";
import { usePlatform } from "../hooks/usePlatform";
import { FolderPickerModal } from "../components/FolderPickerModal";
import type { TodayPlanItem, TodayPendingItem, Plan } from "../types";

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

function LazyVideoThumb({ filePath }: { filePath: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);

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

  // Critical: release buffered video data when the card unmounts
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 bg-gray-900">
      {inView && (
        <video
          ref={videoRef}
          src={getVideoUrl(filePath)}
          preload="metadata"
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ pointerEvents: "none" }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            el.currentTime = Math.min(3, (el.duration || 3) * 0.15);
          }}
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
  const isWatching = task.video_status === "watching";
  const isAudio = task.media_type === "audio";
  const pct =
    isWatching && task.video_duration && task.video_duration > 0
      ? Math.min(100, (task.video_progress / task.video_duration) * 100)
      : 0;

  const handleClick = () => {
    if (!isLocked) navigate(`/plan/${planId}/video/${task.video_id}`);
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
        {!isLocked && (
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

// ─── Compact plan card for "all plans" section ────────────────────────────────

function MiniPlanCard({ plan }: { plan: Plan }) {
  const navigate = useNavigate();
  const total = plan.video_count + plan.audio_count;
  const pct = total > 0 ? Math.round((plan.watched_count / total) * 100) : 0;

  return (
    <div
      onClick={() => navigate(`/plan/${plan.id}`)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(`/plan/${plan.id}`); }}
      tabIndex={0}
      role="button"
      className="bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-sky-600 focus:border-sky-500 rounded-lg px-4 py-3 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-gray-950"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm font-medium text-gray-200 truncate">{plan.name}</span>
        {!!plan.daily_schedule_active && (
          <span className="shrink-0 text-[10px] bg-sky-800/60 text-sky-300 px-1.5 py-0.5 rounded">
            每日{plan.episodes_per_day}集
          </span>
        )}
      </div>
      {/* Media type counts */}
      <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-1.5">
        {plan.video_count > 0 && <span>🎬 {plan.video_count}</span>}
        {plan.audio_count > 0 && <span>🎵 {plan.audio_count}</span>}
        {plan.is_background === 1 && <span className="text-purple-400">🎶</span>}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : "bg-sky-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-500 shrink-0">
          {plan.watched_count}/{total}
        </span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const navigate = useNavigate();
  const { isLimitExceeded, todayWatchedSeconds, todayAudioSeconds, dailyLimitSeconds, bgAudioPlans, bgSetTrack, bgCurrentPlanId, bgCurrentTrackIdx, bgIsPlaying, bgSetFullscreen } = useAppContext();
  const { isTV, isAndroid } = usePlatform();
  const [todayItems, setTodayItems] = useState<TodayPlanItem[]>([]);
  const [allPlans, setAllPlans] = useState<Plan[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [scanRoot, setScanRoot] = useState<string>("");

  // Load the configured scan root (Settings) so add-plan can start from there
  useEffect(() => {
    getSetting("scan_root_dir").then((v) => { if (v) setScanRoot(v); });
  }, []);

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

  const doAddPlan = async (folderPath: string) => {
    setAdding(true);
    setAddError(null);
    setAddNotice(null);
    try {
      const report = await addPlan(folderPath);
      // Tell the user exactly what the scan found
      const parts = [`发现 ${report.found} 个媒体文件`, `新增 ${report.added} 个`];
      if (report.skipped > 0) {
        const names = report.skipped_names.slice(0, 5).join("、");
        const more = report.skipped_names.length < report.skipped ? " 等" : "";
        parts.push(`${report.skipped} 个已被其它计划收录（${names}${more}）`);
      }
      setAddNotice(parts.join("，"));
      await loadData();
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleAddPlan = async () => {
    if (isAndroid) {
      setShowFolderPicker(true);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: scanRoot || undefined,
      });
      if (selected) await doAddPlan(String(selected));
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  };

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

  return (
    <div>
      {showFolderPicker && (
        <FolderPickerModal
          initialPath={scanRoot || undefined}
          onSelect={(path) => { setShowFolderPicker(false); doAddPlan(path); }}
          onCancel={() => setShowFolderPicker(false)}
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
        <button
          onClick={handleAddPlan}
          disabled={adding}
          className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded-lg text-sm transition-colors"
        >
          {adding ? "选择中…" : "+ 添加计划"}
        </button>
      </div>

      {addError && (
        <div className="mb-4 px-4 py-3 bg-red-900/50 border border-red-700 rounded-lg text-sm text-red-300">
          {addError}
        </div>
      )}

      {addNotice && (
        <div className="mb-4 px-4 py-3 bg-sky-900/40 border border-sky-700/60 rounded-lg text-sm text-sky-200 flex items-start gap-2">
          <span className="shrink-0">📋</span>
          <span className="flex-1">{addNotice}</span>
          <button onClick={() => setAddNotice(null)} className="shrink-0 text-sky-400 hover:text-sky-200">✕</button>
        </div>
      )}

      {/* ── Today's tasks ── */}
      {!hasActivePlans ? (
        <div className="bg-gray-800/40 border border-dashed border-gray-700 rounded-xl px-6 py-10 text-center mb-8">
          <p className="text-3xl mb-3">📋</p>
          <p className="text-gray-300 font-medium mb-1">还没有每日学习计划</p>
          <p className="text-sm text-gray-500 mb-4">
            进入某个计划，点击「加入每日计划」，首页会每天推荐要看的集数
          </p>
          <p className="text-sky-400 text-sm">下方可浏览全部计划 ↓</p>
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

      {/* ── Completed today ── */}
      {completedItems.length > 0 && (
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

      {/* ── All plans ── */}
      {allPlans.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              全部计划 ({allPlans.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allPlans.map((plan) => (
              <MiniPlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
