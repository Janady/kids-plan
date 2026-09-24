import { useState, useEffect } from "react";
import { deleteBackgroundTrack } from "../api/plans";
import { useAppContext } from "../context/AppContext";
import { LoopIcon } from "../components/LoopIcon";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon } from "../components/MediaIcons";
import type { LoopMode } from "../types";

export default function BackgroundAudioPage() {
  const {
    isParentMode,
    bgAudioPlans,
    bgRefreshPlans,
    bgSetTrack,
    bgSetScope,
    bgCurrentPlanId,
    bgCurrentTrackIdx,
    bgScopePlanId,
    bgIsPlaying,
    bgLoopMode,
    bgTogglePlay,
    bgNext,
    bgPrev,
    bgSetLoop,
  } = useAppContext();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [expandedPlans, setExpandedPlans] = useState<Set<number>>(new Set());

  useEffect(() => {
    bgRefreshPlans();
  }, [bgRefreshPlans]);

  const handleDelete = async (videoId: number) => {
    if (
      !confirm(
        "确认将此条目从背景音乐中移除？（音频会从计划中拿掉，重新扫描后可恢复；已看视频只会取消背景标记，学习记录仍保留）",
      )
    )
      return;
    setDeleting(videoId);
    try {
      await deleteBackgroundTrack(videoId);
      await bgRefreshPlans();
    } finally {
      setDeleting(null);
    }
  };

  const toggleExpand = (planId: number) =>
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      next.has(planId) ? next.delete(planId) : next.add(planId);
      return next;
    });

  const cycleLoop = () => {
    const modes: LoopMode[] = ["all", "track", "shuffle"];
    bgSetLoop(modes[(modes.indexOf(bgLoopMode) + 1) % modes.length]);
  };

  const totalTracks = bgAudioPlans.reduce((s, p) => s + p.tracks.length, 0);
  const currentPlan = bgAudioPlans.find((p) => p.id === bgCurrentPlanId) ?? null;
  const currentTrack = currentPlan?.tracks[bgCurrentTrackIdx] ?? null;

  return (
    <div>
      <header className="month-head">
        <div>
          <div className="kicker">背景音乐</div>
          <h1>听</h1>
        </div>
        {totalTracks > 0 && (
          <div className="sums">
            <div>
              <b>{totalTracks}</b>首
            </div>
          </div>
        )}
      </header>

      <div className="card hero">
        <div className="k">{currentTrack ? "正在听" : "点一首开始"}</div>
        <div className="n" style={{ fontSize: 22, lineHeight: 1.3 }}>
          {currentTrack ? currentTrack.title : "—"}
        </div>
        <div className="hero-row">
          <span>{currentPlan?.name ?? "还没有在播的曲子"}</span>
          <span>
            {bgLoopMode === "track" ? "单曲循环" : bgLoopMode === "all" ? "列表循环" : "随机"}
          </span>
        </div>
        <div className="flex items-center justify-center gap-5 mt-4">
          <button onClick={bgPrev} disabled={!currentTrack} className="text-grape disabled:opacity-30">
            <PrevIcon size={26} />
          </button>
          <button
            onClick={() => {
              if (!currentTrack && bgAudioPlans.length > 0) bgSetTrack(bgAudioPlans[0].id, 0);
              else bgTogglePlay();
            }}
            className="w-14 h-14 rounded-full flex items-center justify-center text-white"
            style={{ background: "var(--grape)" }}
          >
            {bgIsPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
          </button>
          <button onClick={bgNext} disabled={!currentTrack} className="text-grape disabled:opacity-30">
            <NextIcon size={26} />
          </button>
        </div>
        <div className="flex items-center justify-center gap-3 mt-3">
          <button onClick={cycleLoop} className="chip audio">
            <LoopIcon mode={bgLoopMode} size={16} activeColor="currentColor" />
            <span className="ml-1">
              {bgLoopMode === "track" ? "单曲" : bgLoopMode === "all" ? "列表" : "随机"}
            </span>
          </button>
          <button
            onClick={() => bgSetScope(null)}
            className={`chip ${bgScopePlanId === null ? "audio" : "muted"}`}
          >
            全部计划
          </button>
        </div>
      </div>

      {bgAudioPlans.length === 0 && (
        <div className="card empty">
          <p className="text-3xl mb-3">🎶</p>
          <p className="font-semibold text-ink mb-1">还没有背景音乐</p>
          <p className="hint">到「我的 › 学习计划」里，把音频或已看视频设为背景音乐</p>
        </div>
      )}

      <div className="space-y-3">
        {bgAudioPlans.map((plan) => {
          const isScoped = bgScopePlanId === plan.id;
          const isExpanded = expandedPlans.has(plan.id);
          const visibleTracks = isExpanded ? plan.tracks : plan.tracks.slice(0, 5);
          return (
            <div key={plan.id} className="card overflow-hidden">
              <button className="acc" onClick={() => bgSetScope(plan.id)}>
                <span className="kind-ico audio">听</span>
                <span className="acc-main">
                  <b>{plan.name}</b>
                  <small>{plan.tracks.length} 首{isScoped ? " · 正在播这个计划" : ""}</small>
                </span>
                <span className="chip audio">{isScoped ? "锁定" : "播放"}</span>
              </button>
              {visibleTracks.map((track, idx) => {
                const isCurrentlyPlaying = bgCurrentPlanId === plan.id && bgCurrentTrackIdx === idx;
                return (
                  <button
                    key={track.id}
                    className="acc"
                    onClick={() => bgSetTrack(plan.id, idx)}
                  >
                    <span className={`acc-ico ${isCurrentlyPlaying ? "kind-ico audio" : ""}`}>
                      {isCurrentlyPlaying && bgIsPlaying ? "♪" : idx + 1}
                    </span>
                    <span className="acc-main">
                      <b className={isCurrentlyPlaying ? "text-grape" : ""}>{track.title}</b>
                      {track.play_count_30d > 0 && <small>{track.play_count_30d}次 / 30天</small>}
                    </span>
                    {isParentMode && (
                      <span
                        role="button"
                        className="text-xs text-berry px-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(track.id);
                        }}
                      >
                        {deleting === track.id ? "…" : "移除"}
                      </span>
                    )}
                  </button>
                );
              })}
              {plan.tracks.length > 5 && (
                <button className="ghost-btn w-full" onClick={() => toggleExpand(plan.id)}>
                  {isExpanded ? "收起" : `展开全部 ${plan.tracks.length} 首`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
