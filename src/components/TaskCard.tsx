import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVideoUrl } from "../api/videoSrc";
import { getCachedThumbnail, cacheThumbnail } from "../api/thumbnails";
import { useAppContext } from "../context/AppContext";
import { FocusableCard } from "./FocusableCard";
import type { TodayPendingItem } from "../types";

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const THUMB_RETRY_DELAYS = [1000, 2000, 4000, 8000];
const THUMB_MAX_WIDTH = 320;
const THUMB_STALL_TIMEOUTS = [2000, 3000, 5000, 8000];

export function LazyVideoThumb({ filePath }: { filePath: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const [cacheChecked, setCacheChecked] = useState(false);
  const [cachedUrl, setCachedUrl] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturedRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: "80px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    getCachedThumbnail(filePath)
      .then((url) => {
        if (!cancelled) setCachedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setCachedUrl(null);
      })
      .finally(() => {
        if (!cancelled) setCacheChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [inView, filePath]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
    };
  }, []);

  const armStallWatchdog = () => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    const timeout = THUMB_STALL_TIMEOUTS[Math.min(retryCountRef.current, THUMB_STALL_TIMEOUTS.length - 1)];
    stallTimerRef.current = setTimeout(() => {
      handleError();
    }, timeout);
  };

  useEffect(() => {
    if (!inView || !cacheChecked || cachedUrl) return;
    armStallWatchdog();
    return () => {
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, cacheChecked, cachedUrl, filePath]);

  const handleError = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (retryCountRef.current >= THUMB_RETRY_DELAYS.length) return;
    const delay = THUMB_RETRY_DELAYS[retryCountRef.current];
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      videoRef.current?.load();
      armStallWatchdog();
    }, delay);
  };

  const handleSeeked = () => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (capturedRef.current) return;
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    capturedRef.current = true;
    try {
      const scale = Math.min(1, THUMB_MAX_WIDTH / v.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      cacheThumbnail(filePath, dataUrl).catch(() => {});
    } catch {
      // skip cache
    }
  };

  if (inView && cacheChecked && cachedUrl) {
    return (
      <div ref={wrapRef} className="absolute inset-0">
        <img src={cachedUrl} className="w-full h-full object-cover" style={{ pointerEvents: "none" }} />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="absolute inset-0">
      {inView && cacheChecked && (
        <video
          ref={videoRef}
          src={getVideoUrl(filePath)}
          crossOrigin="anonymous"
          preload="metadata"
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ pointerEvents: "none" }}
          onLoadedMetadata={(e) => {
            armStallWatchdog();
            const el = e.currentTarget;
            el.currentTime = Math.min(3, (el.duration || 3) * 0.15);
          }}
          onSeeked={handleSeeked}
          onError={handleError}
        />
      )}
    </div>
  );
}

interface TaskCardProps {
  task: TodayPendingItem;
  planId: number;
  planName: string;
  isLocked: boolean;
  onMarkWatched: (videoId: number) => void;
}

export function TaskCard({ task, planId, planName, isLocked, onMarkWatched }: TaskCardProps) {
  const navigate = useNavigate();
  const { isCastActive, castSnapshot, switchCastVideo, allowSkipPlayback } = useAppContext();
  const isWatching = task.video_status === "watching";
  const isAudio = task.media_type === "audio";
  const isCastingThis = castSnapshot?.current?.video_id === task.video_id;
  const pct =
    isWatching && task.video_duration && task.video_duration > 0
      ? Math.min(100, (task.video_progress / task.video_duration) * 100)
      : 0;

  const handleClick = () => {
    if (isLocked) return;
    if (!isAudio && isCastActive) {
      switchCastVideo({
        video_id: task.video_id,
        file_path: task.file_path,
        title: task.video_title,
        duration_seconds: task.video_duration,
      }).catch(() => {});
      return;
    }
    navigate(`/plan/${planId}/video/${task.video_id}`);
  };

  return (
    <FocusableCard
      onClick={handleClick}
      tabIndex={isLocked ? -1 : 0}
      className={`card task-card ${isLocked ? "locked" : ""}`}
    >
      <div className="task-cover">
        {isAudio ? (
          <div
            className="absolute inset-0 flex items-center justify-center overflow-hidden"
            style={{ background: "radial-gradient(circle at 50% 38%, #5a3d8a 0%, #2a1f45 78%)" }}
          >
            <div
              className="relative w-20 h-20 rounded-full flex items-center justify-center"
              style={{
                background:
                  "repeating-radial-gradient(circle at 50% 50%, #1a1428 0px, #1a1428 2px, #241a38 3px, #1a1428 4px)",
                border: "1px solid rgba(167,139,250,0.25)",
                animation: isWatching ? "vinylspin 4s linear infinite" : "none",
              }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(167,139,250,0.25)" }}>
                <div className="w-1.5 h-1.5 rounded-full bg-white/70" />
              </div>
            </div>
            <div className="absolute bottom-3 left-0 right-0 flex items-end justify-center gap-[3px] h-6">
              {[0.5, 0.8, 0.4, 1, 0.6, 0.9, 0.45, 0.75, 0.55].map((base, bi) => (
                <span
                  key={bi}
                  className="w-[3px] rounded-full"
                  style={{
                    height: `${base * 100}%`,
                    background: "var(--grape)",
                    transformOrigin: "bottom",
                    animation: isWatching ? `eq 900ms ease-in-out ${bi * 90}ms infinite alternate` : "none",
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <LazyVideoThumb filePath={task.file_path} />
        )}

        <div className={`absolute inset-0 flex items-center justify-center ${isLocked ? "bg-black/50" : "bg-black/25"}`}>
          {isLocked ? (
            <span className="text-2xl">🔒</span>
          ) : isCastingThis ? (
            <div className="chip video">📺 投屏中</div>
          ) : (
            <div className="w-11 h-11 rounded-full bg-white/80 flex items-center justify-center">
              <span className="text-ink text-base pl-0.5">▶</span>
            </div>
          )}
        </div>

        <div className={`absolute top-2 right-2 chip ${isAudio ? "audio" : "video"}`}>
          {isAudio ? "音频" : "视频"}
        </div>

        {isWatching && pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[4px] bg-black/30">
            <div className="h-full" style={{ width: `${pct}%`, background: isAudio ? "var(--grape)" : "var(--sun)" }} />
          </div>
        )}

        {isWatching && (
          <div className="absolute top-2 left-2 chip sun">{isAudio ? "继续收听" : "继续观看"}</div>
        )}
      </div>

      <div className="px-3 pt-2.5 pb-3">
        <div className={`text-[11px] font-medium truncate mb-1 ${isAudio ? "text-grape" : "text-video"}`}>
          {planName}
        </div>
        <div className="text-sm font-semibold text-ink line-clamp-2 leading-snug mb-1.5">{task.video_title}</div>
        {isWatching && task.video_progress > 0 ? (
          <div className={`text-[11px] ${isAudio ? "text-grape" : "text-sun"}`}>
            {isAudio ? "已听至" : "已看至"} {formatTime(task.video_progress)}
            {task.video_duration ? ` / ${formatTime(task.video_duration)}` : ""}
          </div>
        ) : task.video_duration ? (
          <div className="text-[11px] text-mute">{formatTime(task.video_duration)}</div>
        ) : null}

        {task.required_reps > 1 && (
          <div className="text-[11px] text-video mt-1">
            还需练习 {task.required_reps - task.completed_reps} 次
            {task.completed_reps > 0 && " · 今日已计入，明天继续"}
          </div>
        )}

        {!isLocked && allowSkipPlayback && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("标记为「之前已看过」？将跳过此条且不占用今日名额。")) {
                onMarkWatched(task.video_id);
              }
            }}
            className="mt-2 text-[11px] text-mute"
          >
            ✓ 之前已看过
          </button>
        )}
      </div>
    </FocusableCard>
  );
}

export function BlankPracticeCard({ planId, planName, minutes }: { planId: number; planName: string; minutes: number }) {
  const navigate = useNavigate();
  const go = () => navigate(`/plan/${planId}/blank-practice?minutes=${minutes}`);
  return (
    <FocusableCard onClick={go} className="card task-card">
      <div className="task-cover flex items-center justify-center" style={{ background: "var(--good-bg)" }}>
        <span className="text-4xl">📝</span>
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <div className="text-[11px] font-medium truncate mb-1 text-leaf">{planName}</div>
        <div className="text-sm font-semibold text-ink mb-1.5">空白练习</div>
        <div className="text-[11px] text-leaf">{minutes} 分钟</div>
      </div>
    </FocusableCard>
  );
}
