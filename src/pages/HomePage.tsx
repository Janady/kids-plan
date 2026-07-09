import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getTodaySchedule } from "../api/schedule";
import { addPlan, listPlans } from "../api/plans";
import { useAppContext } from "../context/AppContext";
import type { TodayPlanItem, TodayPendingItem, Plan } from "../types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const PLANS_PER_PAGE = 6;

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
          src={convertFileSrc(filePath)}
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
}

function TaskCard({ task, planId, planName, isLocked }: TaskCardProps) {
  const navigate = useNavigate();
  const isWatching = task.video_status === "watching";
  const pct =
    isWatching && task.video_duration && task.video_duration > 0
      ? Math.min(100, (task.video_progress / task.video_duration) * 100)
      : 0;

  const handleClick = () => {
    if (!isLocked) navigate(`/plan/${planId}/video/${task.video_id}`);
  };

  return (
    <div
      onClick={handleClick}
      className={`group rounded-xl overflow-hidden border transition-all ${
        isLocked
          ? "border-gray-800 opacity-50 cursor-not-allowed"
          : "border-gray-700 hover:border-sky-500 cursor-pointer hover:shadow-lg hover:shadow-sky-900/20"
      } bg-gray-800`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-900 overflow-hidden">
        <LazyVideoThumb filePath={task.file_path} />

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

        {/* Watch progress bar at bottom of thumbnail */}
        {isWatching && pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
            <div className="h-full bg-yellow-400" style={{ width: `${pct}%` }} />
          </div>
        )}

        {/* Watching badge */}
        {isWatching && (
          <div className="absolute top-2 left-2 text-[10px] bg-yellow-500/90 text-black font-semibold px-1.5 py-0.5 rounded">
            继续观看
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="px-3 pt-2.5 pb-3">
        <div className="text-[10px] text-sky-400 font-medium truncate mb-1">{planName}</div>
        <div className="text-sm font-medium text-gray-200 line-clamp-2 leading-snug mb-1.5">
          {task.video_title}
        </div>
        {isWatching && task.video_progress > 0 ? (
          <div className="text-[10px] text-yellow-400">
            已看至 {formatTime(task.video_progress)}
            {task.video_duration ? ` / ${formatTime(task.video_duration)}` : ""}
          </div>
        ) : task.video_duration ? (
          <div className="text-[10px] text-gray-600">{formatTime(task.video_duration)}</div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Compact plan card for "all plans" section ────────────────────────────────

function MiniPlanCard({ plan }: { plan: Plan }) {
  const navigate = useNavigate();
  const pct =
    plan.video_count > 0
      ? Math.round((plan.watched_count / plan.video_count) * 100)
      : 0;

  return (
    <div
      onClick={() => navigate(`/plan/${plan.id}`)}
      className="bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-sky-600 rounded-lg px-4 py-3 cursor-pointer transition-all"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-200 truncate">{plan.name}</span>
        {!!plan.daily_schedule_active && (
          <span className="shrink-0 text-[10px] bg-sky-800/60 text-sky-300 px-1.5 py-0.5 rounded">
            每日{plan.episodes_per_day}集
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : "bg-sky-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-500 shrink-0">
          {plan.watched_count}/{plan.video_count}
        </span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { isLimitExceeded } = useAppContext();
  const [todayItems, setTodayItems] = useState<TodayPlanItem[]>([]);
  const [allPlans, setAllPlans] = useState<Plan[]>([]);
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [schedule, plans] = await Promise.all([getTodaySchedule(), listPlans()]);
    setTodayItems(schedule);
    setAllPlans(plans);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAddPlan = async () => {
    setAdding(true);
    setAddError(null);
    try {
      await addPlan();
      await loadData();
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("No folder selected")) setAddError(msg);
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
  const visiblePlans = showAllPlans ? allPlans : allPlans.slice(0, PLANS_PER_PAGE);
  const hiddenCount = allPlans.length - PLANS_PER_PAGE;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">今日学习</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {new Date().toLocaleDateString("zh-CN", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
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

      {/* ── Today's tasks ── */}
      {!hasActivePlans ? (
        <div className="bg-gray-800/40 border border-dashed border-gray-700 rounded-xl px-6 py-10 text-center mb-8">
          <p className="text-3xl mb-3">📋</p>
          <p className="text-gray-300 font-medium mb-1">还没有每日学习计划</p>
          <p className="text-sm text-gray-500 mb-4">
            进入某个计划，点击「加入每日计划」，首页会每天推荐要看的集数
          </p>
          <button
            onClick={() => setShowAllPlans(true)}
            className="text-sky-400 text-sm hover:text-sky-300 transition-colors"
          >
            浏览全部计划 →
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
          {/* Responsive grid: 1 col on mobile, 2 on sm, 3 on lg, 4 on xl */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {allPendingTasks.map(({ task, planId, planName }) => (
              <TaskCard
                key={task.video_id}
                task={task}
                planId={planId}
                planName={planName}
                isLocked={isLimitExceeded || !!(planMap.get(planId)?.is_locked_by_priority)}
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

      {/* ── All plans ── */}
      {allPlans.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              全部计划 ({allPlans.length})
            </h2>
            {hiddenCount > 0 && !showAllPlans && (
              <button
                onClick={() => setShowAllPlans(true)}
                className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
              >
                查看全部 +{hiddenCount} 个
              </button>
            )}
            {showAllPlans && allPlans.length > PLANS_PER_PAGE && (
              <button
                onClick={() => setShowAllPlans(false)}
                className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
              >
                收起
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visiblePlans.map((plan) => (
              <MiniPlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
