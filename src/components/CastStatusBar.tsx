import { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { castPause, castResume, castStop } from "../api/cast";

const formatSeconds = (s: number | null) => {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

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
      <div className="banner cast">
        <span className="flex-1">📺 投屏{snapshot.phase === "finished" ? "已完成" : "已停止"}（{snapshot.renderer_name}）</span>
        <button onClick={() => setDismissed(true)} className="shrink-0">
          ✕
        </button>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="banner cast-err">
        <span>📺 投屏出错：{snapshot.error ?? "未知错误"}</span>
        <button onClick={() => setDismissed(true)} className="shrink-0">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="banner cast">
      <span className="shrink-0">📺</span>
      <div className="flex-1 min-w-0">
        <div className="truncate">
          {snapshot.current?.title ?? "…"}
          {snapshot.current?.duration_seconds != null && (
            <span className="text-xs ml-1">{formatSeconds(snapshot.current.duration_seconds)}</span>
          )}
        </div>
        <div className="text-xs truncate opacity-80">
          {snapshot.renderer_name} · 第 {snapshot.index + 1}/{snapshot.total} 个
          {snapshot.phase === "paused" && "（已暂停，休息中）"}
          {snapshot.phase === "loading" && "（正在连接…）"}
          {snapshot.total > 1 && "，点击视频列表可切换"}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {snapshot.phase === "paused" ? (
          <button onClick={() => castResume().catch(() => {})} className="text-btn">
            继续
          </button>
        ) : (
          <button onClick={() => castPause().catch(() => {})} className="text-btn">
            暂停
          </button>
        )}
        <button onClick={() => castStop().catch(() => {})} className="ghost-btn text-berry">
          停止
        </button>
      </div>
    </div>
  );
}
