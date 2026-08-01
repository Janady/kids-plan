import { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { castPause, castResume, castStop } from "../api/cast";

const formatSeconds = (s: number | null) => {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// Persistent status bar for an in-progress DLNA cast session. Mounted
// app-wide (like BackgroundAudioPlayer) so a cast survives page navigation.
// The session lifecycle itself (subscription, wake lock, break-pause) lives
// in AppProvider so other pages (HomePage, PlanPage) can react to it too —
// this component is just a presentational readout + pause/resume/stop.
export function CastStatusBar() {
  const { castSnapshot: snapshot, isCastActive } = useAppContext();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isCastActive) setDismissed(false);
  }, [isCastActive]);

  if (!snapshot || dismissed) return null;

  const isEnded = snapshot.phase === "finished" || snapshot.phase === "stopped";
  const isError = snapshot.phase === "error";

  if (isEnded) {
    return (
      <div className="bg-gray-800/90 border-b border-gray-700 px-4 py-2 text-sm text-gray-300 flex items-center justify-between gap-3">
        <span>📺 投屏{snapshot.phase === "finished" ? "已完成" : "已停止"}（{snapshot.renderer_name}）</span>
        <button onClick={() => setDismissed(true)} className="text-gray-500 hover:text-gray-300 shrink-0">✕</button>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-red-900/70 border-b border-red-700 px-4 py-2 text-sm text-red-200 flex items-center justify-between gap-3">
        <span>📺 投屏出错：{snapshot.error ?? "未知错误"}</span>
        <button onClick={() => setDismissed(true)} className="text-red-400 hover:text-red-200 shrink-0">✕</button>
      </div>
    );
  }

  return (
    <div className="bg-sky-900/40 border-b border-sky-800/60 px-4 py-2 text-sm text-sky-100 flex items-center gap-3">
      <span className="shrink-0">📺</span>
      <div className="flex-1 min-w-0">
        <div className="truncate">
          {snapshot.current?.title ?? "…"}
          {snapshot.current?.duration_seconds != null && (
            <span className="text-sky-400 text-xs ml-1">{formatSeconds(snapshot.current.duration_seconds)}</span>
          )}
        </div>
        <div className="text-xs text-sky-400/80 truncate">
          {snapshot.renderer_name} · 第 {snapshot.index + 1}/{snapshot.total} 个
          {snapshot.phase === "paused" && "（已暂停，休息中）"}
          {snapshot.phase === "loading" && "（正在连接…）"}
          {snapshot.total > 1 && "，点击视频列表可切换"}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {snapshot.phase === "paused" ? (
          <button
            onClick={() => castResume().catch(() => {})}
            className="px-3 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-xs transition-colors"
          >
            继续投屏
          </button>
        ) : (
          <button
            onClick={() => castPause().catch(() => {})}
            className="px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs transition-colors"
          >
            暂停
          </button>
        )}
        <button
          onClick={() => castStop().catch(() => {})}
          className="px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-red-300 transition-colors"
        >
          停止投屏
        </button>
      </div>
    </div>
  );
}
