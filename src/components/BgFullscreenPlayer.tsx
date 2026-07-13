import { useState } from "react";
import { useAppContext } from "../context/AppContext";
import { LoopIcon } from "./LoopIcon";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon } from "./MediaIcons";
import type { LoopMode } from "../types";

// Full-screen, eye-friendly background music player.
// Shares the calm dark aesthetic of the break/bedtime overlay.
export function BgFullscreenPlayer() {
  const {
    bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx, bgScopePlanId,
    bgIsPlaying, bgLoopMode, bgFullscreen,
    bgTogglePlay, bgNext, bgPrev, bgSetLoop, bgSetTrack, bgSetScope, bgSetFullscreen,
  } = useAppContext();

  const [showList, setShowList] = useState(false);
  // Which plans are expanded to show all tracks (default: collapsed to 5)
  const [expandedPlans, setExpandedPlans] = useState<Set<number>>(new Set());

  const toggleExpand = (planId: number) =>
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      next.has(planId) ? next.delete(planId) : next.add(planId);
      return next;
    });

  if (!bgFullscreen) return null;

  const currentPlan = bgAudioPlans.find((p) => p.id === bgCurrentPlanId) ?? null;
  const currentTrack = currentPlan?.tracks[bgCurrentTrackIdx] ?? null;

  const cycleLoop = () => {
    const modes: LoopMode[] = ["all", "track", "shuffle"];
    bgSetLoop(modes[(modes.indexOf(bgLoopMode) + 1) % modes.length]);
  };

  const accent = "#a78bfa"; // soft purple, gentle on the eyes

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col"
      style={{ background: "#0a0812" }}
    >
      {/* Top bar: collapse */}
      <div className="flex items-center justify-between px-5 py-4">
        <button
          onClick={() => bgSetFullscreen(false)}
          className="text-sm transition-opacity hover:opacity-70"
          style={{ color: accent }}
        >
          ▽ 收起
        </button>
        <span className="text-xs" style={{ color: "#6b6480" }}>背景音乐</span>
        <button
          onClick={() => setShowList((v) => !v)}
          className="text-sm transition-opacity hover:opacity-70"
          style={{ color: showList ? accent : "#6b6480" }}
        >
          {showList ? "♪ 播放" : "☰ 计划 / 列表"}
        </button>
      </div>

      {/* Main content */}
      {showList ? (
        /* Track/directory selection */
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {/* "All plans" scope entry */}
          <button
            onClick={() => { bgSetScope(null); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 mb-3 rounded-xl border transition-colors"
            style={
              bgScopePlanId === null
                ? { borderColor: accent, color: accent, background: "rgba(167,139,250,0.12)" }
                : { borderColor: "#2a2540", color: "#9890b0" }
            }
          >
            <span className="text-base">🔀</span>
            <span className="text-sm font-medium flex-1 text-left">全部计划</span>
            {bgScopePlanId === null && <span className="text-xs">播放中</span>}
          </button>

          {bgAudioPlans.map((plan) => {
            const isScoped = bgScopePlanId === plan.id;
            const isExpanded = expandedPlans.has(plan.id);
            const visibleTracks = isExpanded ? plan.tracks : plan.tracks.slice(0, 5);
            return (
            <div key={plan.id} className="mb-4">
              {/* Plan header = single "play this directory + lock" action */}
              <button
                onClick={() => { bgSetScope(plan.id); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors"
                style={{ background: isScoped ? "rgba(167,139,250,0.1)" : "transparent" }}
              >
                <span className="text-xs font-semibold uppercase tracking-wider flex-1 truncate text-left" style={{ color: accent }}>
                  🎶 {plan.name}
                </span>
                <span className="text-[10px] shrink-0" style={{ color: "#6b6480" }}>
                  {plan.tracks.length} 首
                </span>
                <span className="text-[11px] shrink-0" style={{ color: isScoped ? accent : "#6b6480" }}>
                  {isScoped ? "🔒 播放中" : "▶ 播放此计划"}
                </span>
              </button>

              {visibleTracks.map((track, idx) => {
                const isActive = plan.id === bgCurrentPlanId && idx === bgCurrentTrackIdx;
                return (
                  <button
                    key={track.id}
                    onClick={() => { bgSetTrack(plan.id, idx); setShowList(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl transition-colors"
                    style={{ background: isActive ? "rgba(167,139,250,0.15)" : "transparent" }}
                  >
                    <span className="text-sm shrink-0" style={{ color: isActive ? accent : "#4a4560" }}>
                      {isActive && bgIsPlaying ? "♪" : idx + 1}
                    </span>
                    <span className="flex-1 truncate text-sm" style={{ color: isActive ? accent : "#9890b0" }}>
                      {track.title}
                    </span>
                    {track.play_count_30d > 0 && (
                      <span className="text-[10px] shrink-0" style={{ color: "#4a4560" }}>
                        {track.play_count_30d}次
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Expand / collapse when more than 5 tracks */}
              {plan.tracks.length > 5 && (
                <button
                  onClick={() => toggleExpand(plan.id)}
                  className="w-full text-center py-2 text-xs transition-opacity hover:opacity-70"
                  style={{ color: accent }}
                >
                  {isExpanded ? "收起 ▲" : `展开全部 ${plan.tracks.length} 首 ▼`}
                </button>
              )}
            </div>
            );
          })}
        </div>
      ) : (
        /* Now playing view */
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          {/* Vinyl-style disc */}
          <div
            className="w-48 h-48 rounded-full flex items-center justify-center mb-10"
            style={{
              background: "radial-gradient(circle, #1a1428 0%, #0f0b1a 70%)",
              border: "2px solid rgba(167,139,250,0.2)",
              animation: bgIsPlaying ? "bgspin 8s linear infinite" : "none",
            }}
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)" }}>
              <span className="text-4xl">🎵</span>
            </div>
          </div>

          {currentTrack ? (
            <>
              <p className="text-xl font-medium text-center mb-2 max-w-md truncate" style={{ color: "#d8d0ec" }}>
                {currentTrack.title}
              </p>
              <p className="text-sm text-center mb-3" style={{ color: "#6b6480" }}>
                {currentPlan?.name}
              </p>
              {/* Tappable scope chip → opens the list where plans can be switched/locked */}
              <button
                onClick={() => setShowList(true)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] mb-8 transition-colors"
                style={
                  bgScopePlanId === null
                    ? { borderColor: "#2a2540", color: "#6b6480" }
                    : { borderColor: accent, color: accent, background: "rgba(167,139,250,0.1)" }
                }
              >
                <span>
                  {bgScopePlanId === null
                    ? "🔀 全部计划"
                    : `🔒 ${bgAudioPlans.find((p) => p.id === bgScopePlanId)?.name ?? "单个计划"}`}
                </span>
                <span style={{ opacity: 0.6 }}>切换 ▾</span>
              </button>
            </>
          ) : (
            <p className="text-base text-center mb-10" style={{ color: "#6b6480" }}>
              选择一首背景音乐开始播放
            </p>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-8">
            <button
              onClick={bgPrev}
              disabled={!currentTrack}
              className="transition-opacity disabled:opacity-30 hover:opacity-70"
              style={{ color: accent }}
            ><PrevIcon size={30} /></button>

            <button
              onClick={() => {
                if (!currentTrack && bgAudioPlans.length > 0) bgSetTrack(bgAudioPlans[0].id, 0);
                else bgTogglePlay();
              }}
              className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-105"
              style={{ background: accent, color: "#0a0812" }}
            >
              {bgIsPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
            </button>

            <button
              onClick={bgNext}
              disabled={!currentTrack}
              className="transition-opacity disabled:opacity-30 hover:opacity-70"
              style={{ color: accent }}
            ><NextIcon size={30} /></button>
          </div>

          {/* Loop toggle */}
          <button
            onClick={cycleLoop}
            className="mt-8 flex items-center gap-2 transition-opacity hover:opacity-70"
          >
            <LoopIcon mode={bgLoopMode} size={22} activeColor={accent} />
            <span className="text-xs" style={{ color: "#6b6480" }}>
              {bgLoopMode === "track" ? "单曲循环" : bgLoopMode === "all" ? "列表循环" : "随机播放"}
            </span>
          </button>
        </div>
      )}

      <style>{`@keyframes bgspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
