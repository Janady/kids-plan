import { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { LoopIcon } from "./LoopIcon";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon } from "./MediaIcons";
import type { LoopMode } from "../types";

const BREAK_MESSAGES = [
  { icon: "👁️", text: "让眼睛休息一下，看看远处的风景" },
  { icon: "💧", text: "喝点水吧，保持充足水分" },
  { icon: "🚶", text: "起来走动几分钟，活动一下身体" },
  { icon: "🧘", text: "做几个深呼吸，放松心情" },
  { icon: "🤸", text: "伸展一下颈肩，做个简单拉伸" },
  { icon: "😌", text: "闭眼休息片刻，让大脑放空" },
  { icon: "🌿", text: "离开屏幕，感受周围的环境" },
  { icon: "💪", text: "适当休息是高效学习的关键" },
];

const BEDTIME_MESSAGES = [
  { icon: "🌙", text: "夜深了，好好休息，明天继续" },
  { icon: "😴", text: "早点睡觉，保证充足睡眠" },
  { icon: "⭐", text: "今天辛苦了，该休息了" },
  { icon: "🌛", text: "让大脑充分休息，明天效率更高" },
];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function BgMusicControls() {
  const {
    bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx,
    bgIsPlaying, bgLoopMode,
    bgTogglePlay, bgNext, bgPrev, bgSetLoop, bgSetPlan,
  } = useAppContext();

  if (bgAudioPlans.length === 0) return null;

  const currentPlan = bgAudioPlans.find((p) => p.id === bgCurrentPlanId) ?? null;
  const currentTrack = currentPlan?.tracks[bgCurrentTrackIdx] ?? null;

  // Background-music controls always use the audio purple theme for consistency
  // with the mini/fullscreen players, regardless of the overlay's warm/cool tone.
  const accent = "#a78bfa";

  const cycleLoop = () => {
    const modes: LoopMode[] = ["all", "track", "shuffle"];
    bgSetLoop(modes[(modes.indexOf(bgLoopMode) + 1) % modes.length]);
  };

  const handlePlayClick = () => {
    if (!currentTrack && bgAudioPlans.length > 0) {
      bgSetPlan(bgAudioPlans[0].id);
    } else {
      bgTogglePlay();
    }
  };

  return (
    <div className="mt-8 px-6 py-4 rounded-2xl w-full max-w-xs mx-auto" style={{ background: "rgba(0,0,0,0.3)" }}>
      <p className="text-xs text-center mb-1" style={{ color: accent, opacity: 0.7 }}>🎶 背景音乐</p>
      {currentTrack && (
        <p className="text-sm text-center truncate mb-3" style={{ color: accent }}>{currentTrack.title}</p>
      )}
      <div className="flex items-center justify-center gap-5">
        <button
          onClick={bgPrev}
          disabled={!currentTrack}
          className="disabled:opacity-30 transition-opacity"
          style={{ color: accent }}
        ><PrevIcon size={22} /></button>

        <button
          onClick={handlePlayClick}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all"
          style={{ background: accent, color: "#fff" }}
        >
          {bgIsPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>

        <button
          onClick={bgNext}
          disabled={!currentTrack}
          className="disabled:opacity-30 transition-opacity"
          style={{ color: accent }}
        ><NextIcon size={22} /></button>

        <button onClick={cycleLoop} className="flex items-center justify-center" style={{ color: accent }}>
          <LoopIcon mode={bgLoopMode} size={24} activeColor={accent} />
        </button>
      </div>
    </div>
  );
}

export function BreakOverlay() {
  const { isBreakRequired, breakRemainingSeconds, isBedtime, dismissBreak, blockedRanges } =
    useAppContext();
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (!isBreakRequired && !isBedtime) return;
    const id = setInterval(() => setMsgIndex((i) => i + 1), 8000);
    return () => clearInterval(id);
  }, [isBreakRequired, isBedtime]);

  if (!isBreakRequired && !isBedtime) return null;

  const canDismiss = isBreakRequired && breakRemainingSeconds <= 0;

  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const activeRange = blockedRanges.find((r) => {
    const [sh, sm] = r.start.split(":").map(Number);
    const [eh, em] = r.end.split(":").map(Number);
    const s = sh * 60 + sm;
    const e = eh * 60 + em;
    return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
  });

  if (isBedtime) {
    const msg = pick(BEDTIME_MESSAGES, msgIndex);
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center"
        style={{ background: "#05051a" }}
      >
        <div className="text-center max-w-md px-6 w-full">
          <div className="text-7xl mb-6">{msg.icon}</div>
          <h2 className="text-2xl font-bold mb-3" style={{ color: "#a0a8ff" }}>
            现在是休息时间
          </h2>
          <p className="text-lg mb-4" style={{ color: "#8890d4" }}>
            {msg.text}
          </p>
          {activeRange && (
            <p className="text-sm mb-4" style={{ color: "#555a8a" }}>
              {activeRange.start} — {activeRange.end} 不可观看
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-3 text-sm mb-2" style={{ color: "#555a8a" }}>
            {["喝水", "伸展", "冥想", "准备睡觉"].map((s) => (
              <span key={s} className="px-3 py-1 rounded-full border" style={{ borderColor: "#2a2a5a" }}>
                {s}
              </span>
            ))}
          </div>
          <BgMusicControls />
        </div>
      </div>
    );
  }

  // Break screen
  const msg = pick(BREAK_MESSAGES, msgIndex);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "#1a0e00" }}
    >
      <div className="text-center max-w-md px-6 w-full">
        <div className="text-7xl mb-6">{msg.icon}</div>
        <h2 className="text-2xl font-bold mb-3" style={{ color: "#ffd580" }}>
          休息一下
        </h2>
        <p className="text-lg mb-6" style={{ color: "#c8a84b" }}>
          {msg.text}
        </p>

        {breakRemainingSeconds > 0 ? (
          <div className="mb-4">
            <div className="text-4xl font-mono font-bold mb-2" style={{ color: "#ff9500" }}>
              {Math.floor(breakRemainingSeconds / 60)}:
              {String(breakRemainingSeconds % 60).padStart(2, "0")}
            </div>
            <p className="text-sm" style={{ color: "#7a5a1a" }}>
              休息结束后可继续学习
            </p>
          </div>
        ) : (
          <div className="mb-4">
            <p className="text-sm" style={{ color: "#8a7a3a" }}>
              休息结束，可以继续了
            </p>
          </div>
        )}

        <button
          onClick={dismissBreak}
          disabled={!canDismiss}
          className="px-8 py-3 rounded-xl font-semibold transition-all text-sm"
          style={
            canDismiss
              ? { background: "#ff9500", color: "#000" }
              : { background: "#3a2a00", color: "#7a5a1a", cursor: "not-allowed" }
          }
        >
          {canDismiss ? "继续学习" : `休息中… ${breakRemainingSeconds}s`}
        </button>

        <div className="flex flex-wrap justify-center gap-3 text-sm mt-4 mb-2" style={{ color: "#5a3a00" }}>
          {["喝水", "走动", "伸展", "闭眼"].map((s) => (
            <span key={s} className="px-3 py-1 rounded-full border" style={{ borderColor: "#3a2a00" }}>
              {s}
            </span>
          ))}
        </div>

        <BgMusicControls />
      </div>
    </div>
  );
}
