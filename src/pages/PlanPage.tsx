import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useVideos } from "../hooks/useVideos";
import { useAppContext } from "../context/AppContext";
import {
  rescanPlan,
  deletePlan,
  activatePlan,
  deactivatePlan,
  listPlans,
  setPlanPriority,
  setPlanBackground,
  setPlanBgWatchedVideo,
  setPlanProtected,
  setPlanWeeklySchedule,
} from "../api/plans";
import { adjustVideoReps, batchAdjustPlanReps, setVideoBgTrack } from "../api/videos";
import { useState, useEffect, useCallback } from "react";
import { useCastListRefresh } from "../hooks/useCastListRefresh";
import { TagEditor } from "../components/Tags";
import {
  AudioList,
  BatchRepsControl,
  buildTree,
  DocumentList,
  PRIORITY_LABELS,
  todaySetting,
  VideoTreeLevel,
  WeeklyScheduleEditor,
} from "../components/planMedia";
import type { Plan, Video, WeekdaySetting } from "../types";

export default function PlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const id = Number(planId);
  const { videos, loading, error, refresh } = useVideos(id);
  const { isLimitExceeded, isParentMode, bgRefreshPlans, bgSetTrack, bgAudioPlans } = useAppContext();
  const [rescanning, setRescanning] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [activating, setActivating] = useState(false);
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"video" | "audio" | "document">("video");
  const [scanNotice, setScanNotice] = useState<string | null>(
    (location.state as { scanNotice?: string } | null)?.scanNotice ?? null,
  );

  const loadPlan = useCallback(async () => {
    const all = await listPlans();
    setPlan(all.find((p) => p.id === id) ?? null);
  }, [id]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  const refreshCastLists = useCallback(async () => {
    await Promise.all([refresh(), loadPlan()]);
  }, [refresh, loadPlan]);
  useCastListRefresh(refreshCastLists);

  const hasVideo = videos.some((v) => v.media_type === "video");
  const hasAudio = videos.some((v) => v.media_type === "audio");
  const hasDocument = videos.some((v) => v.media_type === "document");

  useEffect(() => {
    if (!hasVideo && !hasAudio && hasDocument) setActiveTab("document");
    else if (!hasVideo && hasAudio) setActiveTab("audio");
    else setActiveTab("video");
  }, [hasVideo, hasAudio, hasDocument]);

  const handleRescan = async () => {
    setRescanning(true);
    setScanNotice(null);
    try {
      const report = await rescanPlan(id);
      const parts = [`发现 ${report.found} 个媒体文件`, `本计划 ${report.added} 个`];
      if (report.skipped > 0) {
        const names = report.skipped_names.slice(0, 5).join("、");
        const more = report.skipped_names.length < report.skipped ? " 等" : "";
        parts.push(`${report.skipped} 个已被其它计划收录（${names}${more}）`);
      }
      setScanNotice(parts.join("，"));
      await refresh();
      await loadPlan();
    } finally {
      setRescanning(false);
    }
  };

  const handleDelete = async () => {
    if (plan?.is_protected) {
      alert("该计划已受保护，请先取消保护后再删除");
      return;
    }
    if (!confirm("确认删除此计划？（不会删除磁盘上的文件）")) return;
    await deletePlan(id);
    navigate("/plans");
  };

  const handleToggleProtected = async () => {
    if (!plan) return;
    const next = plan.is_protected ? 0 : 1;
    if (!next && !confirm("取消保护后，此计划及其文件可以被删除或清理。确认取消保护？")) return;
    await setPlanProtected(id, next);
    await loadPlan();
  };

  const handleActivate = async () => {
    setActivating(true);
    try {
      await activatePlan(id, 1);
      await loadPlan();
    } finally {
      setActivating(false);
    }
  };

  const handleSavePriority = async (p: number) => {
    await setPlanPriority(id, p);
    await loadPlan();
  };

  const handleBackgroundToggle = async (enabled: boolean) => {
    await setPlanBackground(id, enabled ? 1 : 0);
    await loadPlan();
    await bgRefreshPlans();
  };

  const handleSetBgTrack = async (videoId: number, checked: boolean) => {
    await setVideoBgTrack(videoId, checked);
    await refresh();
    await bgRefreshPlans();
  };

  const handleBgWatchedVideoToggle = async (enabled: boolean) => {
    await setPlanBgWatchedVideo(id, enabled ? 1 : 0);
    await loadPlan();
    await refresh();
    await bgRefreshPlans();
  };

  const handleListenAsAudio = async (video: Video) => {
    const findIdx = (plans: typeof bgAudioPlans) =>
      plans.find((p) => p.id === id)?.tracks.findIndex((t) => t.id === video.id) ?? -1;
    let idx = findIdx(bgAudioPlans);
    if (idx < 0) {
      let plans = await bgRefreshPlans();
      idx = findIdx(plans);
      if (idx < 0) {
        await setVideoBgTrack(video.id, true);
        await refresh();
        plans = await bgRefreshPlans();
        idx = findIdx(plans);
      }
    }
    if (idx >= 0) bgSetTrack(id, idx);
  };

  const handleSaveWeeklySchedule = async (schedule: WeekdaySetting[]) => {
    await setPlanWeeklySchedule(id, schedule);
    await loadPlan();
  };

  const handleAdjustReps = async (videoId: number, delta: number) => {
    await adjustVideoReps(videoId, delta);
    await refresh();
  };

  const handleBatchAdjustReps = async (delta: number) => {
    await batchAdjustPlanReps(id, delta);
    await refresh();
    await loadPlan();
  };

  const videoTree = plan ? buildTree(videos.filter((v) => v.media_type === "video"), plan.folder_path) : [];
  const isLockedOverall = (plan?.is_locked_by_priority ?? false) || isLimitExceeded;
  const typeCount = [hasVideo, hasAudio, hasDocument].filter(Boolean).length;
  const showTabs = typeCount > 1;
  const total = (plan?.video_count ?? 0) + (plan?.audio_count ?? 0);
  const pct = plan && total > 0 ? Math.round((plan.watched_count / total) * 100) : 0;
  const tabs = [
    { key: "video" as const, has: hasVideo, label: "视频" },
    { key: "audio" as const, has: hasAudio, label: "音频" },
    { key: "document" as const, has: hasDocument, label: "文档" },
  ].filter((tab) => tab.has);

  return (
    <div>
      <header className="month-head">
        <div>
          <button className="kicker" onClick={() => navigate("/plans")}>
            ← 计划
          </button>
          <h1>{plan?.name ?? "计划"}</h1>
        </div>
      </header>

      {plan && (
        <div className="card hero">
          <div className="k">{plan.status === "completed" ? "已完成" : "学习进度"}</div>
          <div className="n">
            {plan.watched_count}/{total || "—"}
          </div>
          <div className="hero-row">
            <span>
              {plan.video_count > 0 ? `${plan.video_count} 视频` : ""}
              {plan.audio_count > 0 ? ` · ${plan.audio_count} 音频` : ""}
              {plan.document_count > 0 ? ` · ${plan.document_count} 文档` : ""}
            </span>
            <span>{pct}%</span>
          </div>
          <div className={`progress mt-3 ${pct === 100 ? "leaf" : "sky"}`}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <TagEditor planId={id} boundTags={plan.tags ?? []} editable={isParentMode} onChange={loadPlan} />
        </div>
      )}

      {scanNotice && (
        <div className="card mb-3" style={{ padding: 12 }}>
          <div className="flex items-start gap-2 text-sm">
            <span className="flex-1">{scanNotice}</span>
            <button onClick={() => setScanNotice(null)} className="text-mute">
              ✕
            </button>
          </div>
        </div>
      )}

      {!isParentMode && (
        <p className="hint" style={{ paddingTop: 0 }}>
          儿童模式可重温已学内容。未学内容请在「今天」完成。
        </p>
      )}

      {showTabs && (
        <div className="seg" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((tab) => (
            <button key={tab.key} className={activeTab === tab.key ? "on" : ""} onClick={() => setActiveTab(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {(activeTab === "video" || !showTabs) && hasVideo && plan && (
        <div>
          {loading && <div className="empty">加载中…</div>}
          {error && <p className="warn">{error}</p>}
          {!loading && videoTree.length === 0 && (
            <div className="card empty">
              <p>此文件夹中没有找到视频文件</p>
              {isParentMode && (
                <button onClick={handleRescan} className="primary">
                  重新扫描
                </button>
              )}
            </div>
          )}
          {videoTree.length > 0 && (
            <div className="card">
              <VideoTreeLevel
                nodes={videoTree}
                planId={id}
                isLocked={isLockedOverall}
                isParentMode={isParentMode}
                episodeCounter={{ n: 0 }}
                onAdjustReps={handleAdjustReps}
                onSetBgTrack={handleSetBgTrack}
                onListenAsAudio={handleListenAsAudio}
              />
            </div>
          )}
        </div>
      )}

      {(activeTab === "audio" || (!showTabs && !hasVideo)) && hasAudio && plan && (
        <AudioList
          videos={videos}
          planId={id}
          plan={plan}
          isParentMode={isParentMode}
          onAdjustReps={handleAdjustReps}
          onSetBgTrack={handleSetBgTrack}
        />
      )}

      {(activeTab === "document" || (!showTabs && !hasVideo && !hasAudio)) && hasDocument && plan && (
        <DocumentList videos={videos} planId={id} />
      )}

      {loading && !videos.length && <div className="empty">加载中…</div>}
      {error && <p className="warn">{error}</p>}
      {!loading && !hasVideo && !hasAudio && !hasDocument && (
        <div className="card empty">
          <p>此文件夹中没有找到媒体文件</p>
          <p className="hint">
            若文件夹内确实有视频/音频，通常是这些文件已被上级目录（或其它）计划收录。每个文件只能属于一个计划。
          </p>
          {isParentMode && (
            <button onClick={handleRescan} className="primary">
              重新扫描
            </button>
          )}
        </div>
      )}

      {isParentMode && plan && (
        <div className="mt-4">
          <button className="section-title w-full" onClick={() => setSettingsOpen((v) => !v)}>
            <span>设置这册</span>
            <span>{settingsOpen ? "收起" : "展开"}</span>
          </button>
          {settingsOpen && (
            <div className="card me-list">
              <div className="me-item">
                <span>优先级</span>
                <div className="flex gap-1">
                  {PRIORITY_LABELS.map((label, i) => (
                    <button
                      key={i}
                      onClick={() => handleSavePriority(i)}
                      className={`chip ${plan.priority === i ? "sun" : "muted"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {plan.is_locked_by_priority && (
                <p className="hint" style={{ padding: "0 16px 8px" }}>
                  存在更高优先级计划未完成
                </p>
              )}
              <div className="me-item">
                <BatchRepsControl onAdjust={handleBatchAdjustReps} />
              </div>
              {hasAudio && (
                <label className="me-item">
                  <span>同时作为背景音乐</span>
                  <input
                    type="checkbox"
                    checked={plan.is_background === 1}
                    onChange={(e) => handleBackgroundToggle(e.target.checked)}
                  />
                </label>
              )}
              {hasVideo && (
                <label className="me-item">
                  <span>已看视频作为背景音</span>
                  <input
                    type="checkbox"
                    checked={plan.bg_watched_video === 1}
                    onChange={(e) => handleBgWatchedVideoToggle(e.target.checked)}
                  />
                </label>
              )}
              {plan.daily_schedule_active ? (
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">
                      今日推荐 {todaySetting(plan).episodes} 集
                      {todaySetting(plan).blank_minutes > 0 ? ` · 空白练习 ${todaySetting(plan).blank_minutes} 分钟` : ""}
                    </span>
                    <div className="flex gap-2">
                      <button className="text-btn" onClick={() => setScheduleExpanded((v) => !v)}>
                        {scheduleExpanded ? "收起" : "修改"}
                      </button>
                      <button
                        className="ghost-btn"
                        onClick={async () => {
                          await deactivatePlan(id);
                          await loadPlan();
                        }}
                      >
                        退出
                      </button>
                    </div>
                  </div>
                  <WeeklyScheduleEditor plan={plan} onSave={handleSaveWeeklySchedule} expanded={scheduleExpanded} />
                </div>
              ) : (
                <div className="me-item">
                  <span>未加入每日计划</span>
                  <button className="primary" style={{ padding: "8px 16px" }} onClick={handleActivate} disabled={activating}>
                    {activating ? "启动中…" : "开始计划"}
                  </button>
                </div>
              )}
              {bgAudioPlans.find((p) => p.id === id) && (
                <button
                  className="me-item"
                  onClick={() => {
                    bgSetTrack(id, 0);
                    navigate("/listen");
                  }}
                >
                  <span>到「听」里从头播放</span>
                  <small>▶</small>
                </button>
              )}
              <button className="me-item" onClick={handleRescan} disabled={rescanning}>
                <span>重新扫描</span>
                <small>{rescanning ? "扫描中…" : "更新文件"}</small>
              </button>
              <button className="me-item" onClick={handleToggleProtected}>
                <span>{plan.is_protected ? "已保护" : "保护这册"}</span>
                <small>{plan.is_protected ? "取消保护" : "防止删除"}</small>
              </button>
              <button className="danger-btn" onClick={handleDelete} disabled={!!plan.is_protected}>
                删除这册
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
