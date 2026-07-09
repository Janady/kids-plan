import { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";

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

export function BreakOverlay() {
  const { isBreakRequired, breakRemainingSeconds, isBedtime, dismissBreak, blockedRanges } =
    useAppContext();
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (!isBreakRequired && !isBedtime) return;
    // Rotate message every 8 seconds
    const id = setInterval(() => setMsgIndex((i) => i + 1), 8000);
    return () => clearInterval(id);
  }, [isBreakRequired, isBedtime]);

  if (!isBreakRequired && !isBedtime) return null;

  const canDismiss = isBreakRequired && breakRemainingSeconds <= 0;

  // Find which blocked range is active (for bedtime end time)
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
        <div className="text-center max-w-md px-6">
          <div className="text-7xl mb-6">{msg.icon}</div>
          <h2 className="text-2xl font-bold mb-3" style={{ color: "#a0a8ff" }}>
            现在是休息时间
          </h2>
          <p className="text-lg mb-4" style={{ color: "#8890d4" }}>
            {msg.text}
          </p>
          {activeRange && (
            <p className="text-sm" style={{ color: "#555a8a" }}>
              {activeRange.start} — {activeRange.end} 不可观看
            </p>
          )}
          <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm" style={{ color: "#555a8a" }}>
            {["喝水", "伸展", "冥想", "准备睡觉"].map((s) => (
              <span key={s} className="px-3 py-1 rounded-full border" style={{ borderColor: "#2a2a5a" }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Break screen
  const msg = pick(BREAK_MESSAGES, msgIndex);
  const pct = Math.max(0, (breakRemainingSeconds / (breakRemainingSeconds + 1)) * 100);
  void pct; // used for future progress ring

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "#1a0e00" }}
    >
      <div className="text-center max-w-md px-6">
        <div className="text-7xl mb-6">{msg.icon}</div>
        <h2 className="text-2xl font-bold mb-3" style={{ color: "#ffd580" }}>
          休息一下
        </h2>
        <p className="text-lg mb-6" style={{ color: "#c8a84b" }}>
          {msg.text}
        </p>

        {breakRemainingSeconds > 0 ? (
          <div className="mb-6">
            <div
              className="text-4xl font-mono font-bold mb-2"
              style={{ color: "#ff9500" }}
            >
              {Math.floor(breakRemainingSeconds / 60)}:
              {String(breakRemainingSeconds % 60).padStart(2, "0")}
            </div>
            <p className="text-sm" style={{ color: "#7a5a1a" }}>
              休息结束后可继续学习
            </p>
          </div>
        ) : (
          <div className="mb-6">
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

        <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm" style={{ color: "#5a3a00" }}>
          {["喝水", "走动", "伸展", "闭眼"].map((s) => (
            <span key={s} className="px-3 py-1 rounded-full border" style={{ borderColor: "#3a2a00" }}>
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
