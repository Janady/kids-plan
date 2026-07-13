import { useEffect, useRef, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { getVideoUrl } from "../api/videoSrc";
import { recordBackgroundPlay } from "../api/sessions";
import { LoopIcon } from "./LoopIcon";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon } from "./MediaIcons";
import type { LoopMode } from "../types";

export function BackgroundAudioPlayer() {
  const {
    bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx, bgScopePlanId, bgIsPlaying, bgLoopMode,
    bgSetTrack, bgSetScope, bgTogglePlay, bgNext, bgPrev, bgSetLoop, bgOnEnded, bgSetFullscreen,
  } = useAppContext();

  const audioRef = useRef<HTMLAudioElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedPlans, setExpandedPlans] = useState<Set<number>>(new Set());
  const prevTrackKey = useRef<string>("");

  const toggleExpand = (planId: number) =>
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      next.has(planId) ? next.delete(planId) : next.add(planId);
      return next;
    });

  const currentPlan = bgAudioPlans.find((p) => p.id === bgCurrentPlanId) ?? null;
  const currentTrack = currentPlan?.tracks[bgCurrentTrackIdx] ?? null;
  const trackKey = currentTrack ? `${currentTrack.id}` : "";

  // Load new src and record play when track changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!currentTrack) {
      el.src = "";
      return;
    }
    if (trackKey !== prevTrackKey.current) {
      prevTrackKey.current = trackKey;
      el.src = getVideoUrl(currentTrack.file_path);
      if (bgIsPlaying) {
        el.play().catch(() => {});
        recordBackgroundPlay(currentTrack.id).catch(() => {});
      }
    }
  }, [trackKey, currentTrack, bgIsPlaying]);

  // Sync play/pause state
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !currentTrack) return;
    if (bgIsPlaying && el.paused && el.src) {
      el.play().catch(() => {});
    } else if (!bgIsPlaying && !el.paused) {
      el.pause();
    }
  }, [bgIsPlaying, currentTrack]);

  const handleEnded = () => {
    if (bgLoopMode === "track") {
      const el = audioRef.current;
      if (el) { el.currentTime = 0; el.play().catch(() => {}); }
    } else {
      bgOnEnded();
      // Play count is recorded when track actually starts (in the track-change effect)
    }
  };

  if (bgAudioPlans.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] bg-gray-900 border-t border-purple-900/60 shadow-xl">
      <audio ref={audioRef} onEnded={handleEnded} />

      {/* Expanded panel */}
      {expanded && (
        <div className="max-h-72 overflow-y-auto border-b border-gray-800">
          {/* "All plans" scope entry */}
          <button
            onClick={() => bgSetScope(null)}
            className={`sticky top-0 z-10 w-full flex items-center gap-2 px-4 py-2 border-b border-gray-800 transition-colors ${
              bgScopePlanId === null ? "bg-purple-900/30 text-purple-300" : "bg-gray-950/95 text-gray-400 hover:text-gray-200"
            }`}
          >
            <span className="text-sm shrink-0">🔀</span>
            <span className="text-xs font-medium flex-1 text-left">全部计划</span>
            {bgScopePlanId === null && <span className="text-[10px] shrink-0">播放中</span>}
          </button>

          {bgAudioPlans.map((plan) => {
            const isScoped = bgScopePlanId === plan.id;
            const isExpanded = expandedPlans.has(plan.id);
            const visibleTracks = isExpanded ? plan.tracks : plan.tracks.slice(0, 5);
            return (
            <div key={plan.id}>
              {/* Plan header = single "play + lock this plan" action */}
              <button
                onClick={() => bgSetScope(plan.id)}
                className={`w-full flex items-center gap-2 px-4 py-2 transition-colors ${
                  isScoped ? "bg-purple-900/20" : "bg-gray-800/60 hover:bg-gray-800"
                }`}
              >
                <span className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider flex-1 truncate text-left">
                  🎶 {plan.name}
                </span>
                <span className="text-[10px] text-gray-600 shrink-0">{plan.tracks.length} 首</span>
                <span className={`text-[10px] shrink-0 ${isScoped ? "text-purple-300" : "text-gray-500"}`}>
                  {isScoped ? "🔒 播放中" : "▶ 播放此计划"}
                </span>
              </button>

              {visibleTracks.map((track, idx) => {
                const isActive = plan.id === bgCurrentPlanId && idx === bgCurrentTrackIdx;
                return (
                  <button
                    key={track.id}
                    onClick={() => bgSetTrack(plan.id, idx)}
                    className={`w-full flex items-center gap-3 px-5 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-purple-900/40 text-purple-300"
                        : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                    }`}
                  >
                    {isActive && bgIsPlaying ? (
                      <span className="text-purple-400 text-xs shrink-0">♪</span>
                    ) : (
                      <span className="text-gray-600 text-xs shrink-0 w-4 text-center">{idx + 1}</span>
                    )}
                    <span className="flex-1 truncate">{track.title}</span>
                    {track.play_count_30d > 0 && (
                      <span className="text-[10px] text-gray-600 shrink-0">{track.play_count_30d}次</span>
                    )}
                  </button>
                );
              })}

              {/* Expand / collapse when more than 5 tracks */}
              {plan.tracks.length > 5 && (
                <button
                  onClick={() => toggleExpand(plan.id)}
                  className="w-full text-center py-1.5 text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
                >
                  {isExpanded ? "收起 ▲" : `展开全部 ${plan.tracks.length} 首 ▼`}
                </button>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Mini player bar */}
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          onClick={() => bgSetFullscreen(true)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
          title="展开全屏播放"
        >
          <span className="text-purple-400 text-base shrink-0">🎶</span>
          {currentTrack ? (
            <div className="min-w-0">
              <div className="text-xs text-gray-200 truncate leading-tight">{currentTrack.title}</div>
              <div className="text-[10px] text-gray-500 truncate">{currentPlan?.name}</div>
            </div>
          ) : (
            <span className="text-xs text-gray-500 italic">背景音乐</span>
          )}
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={bgPrev}
            disabled={!currentTrack}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors"
          ><PrevIcon size={18} /></button>

          <button
            onClick={() => {
              if (!currentTrack && bgAudioPlans.length > 0) {
                bgSetTrack(bgAudioPlans[0].id, 0);
              } else {
                bgTogglePlay();
              }
            }}
            className="w-8 h-8 rounded-full bg-purple-700 hover:bg-purple-600 flex items-center justify-center text-white transition-colors"
          >
            {bgIsPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>

          <button
            onClick={bgNext}
            disabled={!currentTrack}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors"
          ><NextIcon size={18} /></button>

          <button
            onClick={() => {
              const modes: LoopMode[] = ["all", "track", "shuffle"];
              bgSetLoop(modes[(modes.indexOf(bgLoopMode) + 1) % modes.length]);
            }}
            className="w-7 h-7 flex items-center justify-center text-purple-400 hover:text-purple-300 transition-colors text-sm"
            title="循环模式"
          >
            <LoopIcon mode={bgLoopMode} size={18} activeColor="currentColor" />
          </button>

          <button
            onClick={() => setExpanded((v) => !v)}
            className={`w-7 h-7 flex items-center justify-center text-sm transition-colors ${
              expanded ? "text-purple-400" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {expanded ? "▼" : "▲"}
          </button>
        </div>
      </div>
    </div>
  );
}
