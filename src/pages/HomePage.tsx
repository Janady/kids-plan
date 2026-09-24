import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getTodaySchedule } from "../api/schedule";
import { listPlans } from "../api/plans";
import { markVideoWatchedEarlier } from "../api/videos";
import { useAppContext } from "../context/AppContext";
import { useCastListRefresh } from "../hooks/useCastListRefresh";
import { usePlatform } from "../hooks/usePlatform";
import { CastDevicePickerModal } from "../components/CastDevicePickerModal";
import { parseTagIdsParam, planMatchesTags, TagFilterBar, uniqueTags } from "../components/Tags";
import { BlankPracticeCard, TaskCard } from "../components/TaskCard";
import type { TodayPlanItem, Plan, CastQueueItem } from "../types";

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}小时 ${m}分钟` : `${m}分钟`;
}

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    isLimitExceeded,
    todayWatchedSeconds,
    todayAudioSeconds,
    dailyLimitSeconds,
    isParentMode,
    toggleParentMode,
  } = useAppContext();
  const { isAndroid, isTV } = usePlatform();
  const [todayItems, setTodayItems] = useState<TodayPlanItem[]>([]);
  const [allPlans, setAllPlans] = useState<Plan[]>([]);
  const [showCastPicker, setShowCastPicker] = useState(false);
  const selectedTagIds = parseTagIdsParam(searchParams.get("tags"));

  const loadData = useCallback(async () => {
    const [schedule, plans] = await Promise.all([getTodaySchedule(), listPlans()]);
    setTodayItems(schedule);
    setAllPlans(plans);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);
  useCastListRefresh(loadData);

  const handleMarkWatched = useCallback(
    async (videoId: number) => {
      await markVideoWatchedEarlier(videoId);
      await loadData();
    },
    [loadData],
  );

  const allPendingTasks = todayItems.flatMap((item) =>
    item.pending.map((task) => ({
      task,
      planId: item.plan_id,
      planName: item.plan_name,
    })),
  );

  const planMap = new Map(allPlans.map((p) => [p.id, p]));
  const completedItems = todayItems.flatMap((item) =>
    item.done_today.map((d) => ({ ...d, planName: item.plan_name })),
  );
  const pendingBlankPractices = todayItems.filter((item) => item.blank_practice && !item.blank_practice.completed);
  const completedBlankPractices = todayItems.filter((item) => item.blank_practice?.completed);
  const todayPlanIds = new Set(todayItems.map((item) => item.plan_id));
  const filterTags = uniqueTags(allPlans.filter((p) => todayPlanIds.has(p.id)));
  const visiblePendingTasks = allPendingTasks.filter(({ planId }) =>
    planMatchesTags(planMap.get(planId), selectedTagIds),
  );
  const visibleBlankPractices = pendingBlankPractices.filter((item) =>
    planMatchesTags(planMap.get(item.plan_id), selectedTagIds),
  );
  const filterEmpty = selectedTagIds.length > 0 && visiblePendingTasks.length === 0 && visibleBlankPractices.length === 0;
  const hasActivePlans = todayItems.length > 0;
  const remaining = visiblePendingTasks.length + visibleBlankPractices.length;
  const allDoneToday = hasActivePlans && allPendingTasks.length === 0 && pendingBlankPractices.length === 0;
  const pct = Math.min(100, Math.round((todayWatchedSeconds / dailyLimitSeconds) * 100));

  const castQueue: CastQueueItem[] = allPendingTasks
    .filter(({ task, planId }) => task.media_type === "video" && !planMap.get(planId)?.is_locked_by_priority)
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

      <header className="month-head">
        <div>
          <div className="kicker">
            {new Date().toLocaleDateString("zh-CN", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <h1>今天</h1>
        </div>
        <div className="sums">
          <div>
            <b>{formatSeconds(todayWatchedSeconds)}</b>已学
          </div>
          {isAndroid && !isTV && !isParentMode && castQueue.length > 0 && (
            <button className="text-btn" onClick={() => setShowCastPicker(true)}>
              投屏
            </button>
          )}
        </div>
      </header>

      <div className="card hero">
        <div className="k">
          {isParentMode ? "家长模式" : !hasActivePlans ? "还没有计划" : allDoneToday ? "都看完啦" : "待学习"}
        </div>
        <div className="n">{isParentMode ? "—" : !hasActivePlans ? "—" : remaining}</div>
        <div className="hero-row">
          <span>
            {isParentMode
              ? "切回儿童模式再开始今日学习"
              : !hasActivePlans
                ? "到「计划」里加入每日学习"
                : allDoneToday
                  ? "休息一下，明天继续"
                  : "点一张卡片，开始今天的学习"}
          </span>
          <span>
            {formatSeconds(todayWatchedSeconds)}/{formatSeconds(dailyLimitSeconds)}
          </span>
        </div>
        <div className={`progress mt-3 ${pct >= 100 ? "berry" : pct >= 80 ? "sun" : "sky"}`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        {todayAudioSeconds > 0 && <div className="text-[11px] text-grape mt-2">音频学习 {formatSeconds(todayAudioSeconds)}</div>}
      </div>

      {isParentMode ? (
        <div className="card" style={{ padding: "28px 20px", textAlign: "center", marginBottom: 16 }}>
          <p className="text-3xl mb-3">👨‍👦</p>
          <p className="font-semibold mb-1">今日任务已隐藏</p>
          <p className="hint" style={{ paddingTop: 0 }}>
            家长模式下播放不计时、不推进任务。
          </p>
          <div className="flex justify-center gap-3">
            <button className="text-btn" onClick={() => navigate("/plans")}>
              去配置计划
            </button>
            <button className="primary" onClick={() => toggleParentMode()}>
              切换到儿童模式
            </button>
          </div>
        </div>
      ) : !hasActivePlans ? (
        <div className="card empty">
          <p className="text-3xl mb-3">📋</p>
          <p className="font-semibold text-ink mb-1">还没有每日学习计划</p>
          <p className="hint" style={{ paddingTop: 8 }}>
            进入某个计划，点「加入每日计划」，首页会每天推荐要看的集数
          </p>
          <button className="primary" onClick={() => navigate("/plans")}>
            去计划页
          </button>
        </div>
      ) : allDoneToday ? (
        <div className="card empty">
          <p className="text-4xl mb-3">🎉</p>
          <p className="font-semibold text-leaf text-lg mb-1">今日任务全部完成！</p>
          <p className="hint" style={{ paddingTop: 8 }}>
            休息一下，明天继续
          </p>
        </div>
      ) : (
        <div className="mb-6">
          {filterTags.length > 0 && (
            <TagFilterBar
              tags={filterTags}
              selectedIds={selectedTagIds}
              onChange={(ids) => setSearchParams(ids.length ? { tags: ids.join(",") } : {})}
            />
          )}
          {filterEmpty ? (
            <div className="card empty">
              <p className="font-semibold text-ink mb-1">没有该标签的今日学习任务</p>
              <p className="hint" style={{ paddingTop: 8 }}>
                试试其它标签，或点「全部」查看今日全部任务
              </p>
            </div>
          ) : (
            <div className="task-grid">
              {visiblePendingTasks.map(({ task, planId, planName }) => (
                <TaskCard
                  key={task.video_id}
                  task={task}
                  planId={planId}
                  planName={planName}
                  isLocked={isLimitExceeded || !!planMap.get(planId)?.is_locked_by_priority}
                  onMarkWatched={handleMarkWatched}
                />
              ))}
              {visibleBlankPractices.map((item) => (
                <BlankPracticeCard
                  key={`blank-${item.plan_id}`}
                  planId={item.plan_id}
                  planName={item.plan_name}
                  minutes={item.blank_practice!.minutes}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!isParentMode && (completedItems.length > 0 || completedBlankPractices.length > 0) && (
        <div className="mb-6">
          <div className="section-title">今日已完成</div>
          <div className="card">
            {completedItems.map((d) => (
              <div key={d.video_id} className="acc">
                <span className="acc-ico" style={{ background: "var(--good-bg)", color: "#2a7a4e" }}>
                  ✓
                </span>
                <span className="acc-main">
                  <b>{d.video_title}</b>
                  <small>{d.planName}</small>
                </span>
              </div>
            ))}
            {completedBlankPractices.map((item) => (
              <div key={`blank-${item.plan_id}`} className="acc">
                <span className="acc-ico" style={{ background: "var(--good-bg)", color: "#2a7a4e" }}>
                  📝
                </span>
                <span className="acc-main">
                  <b>空白练习已完成</b>
                  <small>{item.plan_name}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
