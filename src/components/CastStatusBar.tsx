import { useEffect, useRef, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { castPause, castResume, castStop, castJumpTo, getCastState, onCastStateChanged } from "../api/cast";
import type { CastStateSnapshot } from "../types";

const formatSeconds = (s: number | null) => {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// Persistent status bar for an in-progress DLNA cast session. Mounted
// app-wide (like BackgroundAudioPlayer) so a cast survives page navigation —
// it drives a background Rust task, not something tied to this component's
// lifecycle.
export function CastStatusBar() {
  const { isBreakRequired, refreshTodayTotal } = useAppContext();
  const [snapshot, setSnapshot] = useState<CastStateSnapshot | null>(null);
  const [showQueue, setShowQueue] = useState(false);

  useEffect(() => {
    getCastState().then(setSnapshot).catch(() => {});
    const unlisten = onCastStateChanged((s) => {
      setSnapshot(s);
      // Ticks land on the Rust side during casting (independent of the local
      // <video> element), so the nav bar's today-total needs an explicit
      // nudge to stay in sync instead of only refreshing on its own mount.
      refreshTodayTotal().catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [refreshTodayTotal]);

  const isActive = !!snapshot && snapshot.phase !== "finished" && snapshot.phase !== "stopped" && snapshot.phase !== "error";

  // Keep the screen awake while a cast session is active — on Android, once
  // the screen sleeps the WebView/app process gets throttled by the OS,
  // stalling the Tokio runtime that drives the cast session and the LAN
  // server the renderer streams from, silently breaking the cast. The Wake
  // Lock spec auto-releases the sentinel when the document goes hidden and
  // does NOT auto-reacquire on return — only guards against *automatic*
  // screen timeout, not a manual power-button lock.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!isActive || !("wakeLock" in navigator)) return;

    let cancelled = false;
    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) { sentinel.release().catch(() => {}); return; }
        wakeLockRef.current = sentinel;
      } catch {
        // Request can be rejected (e.g. low battery) — nothing to do.
      }
    };
    acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [isActive]);

  // Pause casting when a break is triggered; deliberately does NOT auto-resume
  // when the break ends, matching the existing background-music behavior —
  // the user must tap "继续投屏" themselves.
  useEffect(() => {
    if (isBreakRequired && snapshot && snapshot.phase !== "paused" && snapshot.phase !== "error") {
      castPause().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBreakRequired]);

  if (!snapshot) return null;

  const isEnded = snapshot.phase === "finished" || snapshot.phase === "stopped";
  const isError = snapshot.phase === "error";

  if (isEnded) {
    return (
      <div className="bg-gray-800/90 border-b border-gray-700 px-4 py-2 text-sm text-gray-300 flex items-center justify-between gap-3">
        <span>📺 投屏{snapshot.phase === "finished" ? "已完成" : "已停止"}（{snapshot.renderer_name}）</span>
        <button onClick={() => setSnapshot(null)} className="text-gray-500 hover:text-gray-300 shrink-0">✕</button>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-red-900/70 border-b border-red-700 px-4 py-2 text-sm text-red-200 flex items-center justify-between gap-3">
        <span>📺 投屏出错：{snapshot.error ?? "未知错误"}</span>
        <button onClick={() => setSnapshot(null)} className="text-red-400 hover:text-red-200 shrink-0">✕</button>
      </div>
    );
  }

  const handleJumpTo = (index: number) => {
    setShowQueue(false);
    castJumpTo(index).catch(() => {});
  };

  return (
    <div className="bg-sky-900/40 border-b border-sky-800/60">
      <div className="px-4 py-2 text-sm text-sky-100 flex items-center gap-3">
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
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {snapshot.total > 1 && (
            <button
              onClick={() => setShowQueue((v) => !v)}
              className={`px-3 py-1 rounded-lg text-xs transition-colors ${showQueue ? "bg-sky-700" : "bg-gray-800 hover:bg-gray-700"}`}
            >
              切换
            </button>
          )}
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

      {showQueue && (
        <div className="border-t border-sky-800/60 bg-sky-950/40 max-h-56 overflow-y-auto">
          {snapshot.queue.map((item, i) => (
            <button
              key={item.video_id}
              disabled={i === snapshot.index}
              onClick={() => handleJumpTo(i)}
              className={`w-full flex items-center gap-2 px-4 py-2 text-left text-xs transition-colors ${
                i === snapshot.index ? "text-sky-300 bg-sky-900/40 cursor-default" : "text-sky-100 hover:bg-sky-900/30"
              }`}
            >
              <span className="text-sky-500 shrink-0">{i + 1}.</span>
              <span className="truncate flex-1">{item.title}</span>
              {i === snapshot.index && <span className="shrink-0 text-sky-400">▶ 正在播放</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
