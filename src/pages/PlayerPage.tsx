import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { getVideoUrl } from "../api/videoSrc";
import { listVideosForPlan } from "../api/videos";
import { updateVideoStatus, updateVideoProgress, setVideoDuration } from "../api/videos";
import { useWatchSession } from "../hooks/useWatchSession";
import { useAppContext } from "../context/AppContext";
import { listPlans } from "../api/plans";
import type { Video, Plan } from "../types";

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function PlayerPage() {
  const { planId, videoId } = useParams<{ planId: string; videoId: string }>();
  const navigate = useNavigate();
  const pId = Number(planId);
  const vId = Number(videoId);

  const [video, setVideo] = useState<Video | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [_duration, setDuration] = useState(0);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);

  const { isLimitExceeded, refreshTodayTotal, notifyVideoPlay, notifyVideoPause, isParentMode,
    isBreakRequired, isBedtime } = useAppContext();

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationSetRef = useRef(false);
  const resumeShownRef = useRef(false);

  const { startSession, pauseSession, endSession } = useWatchSession(vId);

  const isAudio = video?.media_type === "audio";

  // When a forced break / bedtime / daily limit kicks in, a fullscreen <video>
  // would render above the overlay in the browser's fullscreen layer.
  // Exit fullscreen and pause so the reminder is actually visible.
  useEffect(() => {
    if (isAudio) return;
    if (isBreakRequired || isBedtime || isLimitExceeded) {
      const el = mediaRef.current;
      if (el && !el.paused) el.pause();
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [isBreakRequired, isBedtime, isLimitExceeded, isAudio]);

  // Lock to landscape while a video is on screen (mobile); restore on leave.
  useEffect(() => {
    if (isAudio) return;
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    orientation?.lock?.("landscape").catch(() => {});
    return () => {
      screen.orientation?.unlock?.();
    };
  }, [isAudio]);

  useEffect(() => {
    setLoading(true);
    setEnded(false);
    durationSetRef.current = false;
    resumeShownRef.current = false;
    setResumedFrom(null);
    setDuration(0);

    Promise.all([listVideosForPlan(pId), listPlans()]).then(([videos, plans]) => {
      const found = videos.find((v) => v.id === vId) ?? null;
      setVideo(found);
      setPlan(plans.find((p) => p.id === pId) ?? null);
      setLoading(false);
    });
  }, [pId, vId]);

  const handleLoadedMetadata = useCallback(async () => {
    const el = mediaRef.current;
    if (!el || !video) return;

    const dur = (el as HTMLVideoElement).duration;
    if (isFinite(dur)) setDuration(Math.floor(dur));

    if (video.progress_seconds > 0 && !resumeShownRef.current) {
      el.currentTime = video.progress_seconds;
      resumeShownRef.current = true;
      setResumedFrom(video.progress_seconds);
      setTimeout(() => setResumedFrom(null), 3000);
    }

    if (!durationSetRef.current && isFinite(dur)) {
      durationSetRef.current = true;
      await setVideoDuration(vId, Math.floor(dur));
    }
  }, [video, vId]);

  const handlePlay = useCallback(async () => {
    if (!isAudio) notifyVideoPlay();
    setEnded(false);
    if (!isParentMode) {
      startSession();
      if (video && video.status === "not_watched") {
        await updateVideoStatus(vId, "watching");
        setVideo((v) => (v ? { ...v, status: "watching" } : v));
      }
    }
  }, [video, vId, startSession, notifyVideoPlay, isParentMode, isAudio]);

  const handlePause = useCallback(async () => {
    if (!isAudio) notifyVideoPause();
    if (!isParentMode) {
      await pauseSession();
      const el = mediaRef.current;
      if (el) await updateVideoProgress(vId, Math.floor(el.currentTime));
    }
  }, [pauseSession, notifyVideoPause, vId, isParentMode, isAudio]);

  const handleEnded = useCallback(async () => {
    if (!isAudio) notifyVideoPause();
    if (!isParentMode) {
      await endSession();
      await updateVideoStatus(vId, "watched");
      setVideo((v) => (v ? { ...v, status: "watched" } : v));
      await refreshTodayTotal();
      setEnded(true);
      setTimeout(() => navigate("/"), 2000);
    } else {
      navigate("/");
    }
  }, [endSession, notifyVideoPause, vId, refreshTodayTotal, navigate, isParentMode, isAudio]);

  // Save progress every 5 seconds (child mode only)
  useEffect(() => {
    if (isParentMode) return;
    progressTimerRef.current = setInterval(async () => {
      const el = mediaRef.current;
      if (el && !el.paused && !el.ended) {
        await updateVideoProgress(vId, Math.floor(el.currentTime));
      }
    }, 5000);
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  }, [vId, isParentMode]);

  // Flush session on unmount
  useEffect(() => {
    return () => {
      const el = mediaRef.current;
      if (el && !el.paused && !el.ended) {
        pauseSession();
        updateVideoProgress(vId, Math.floor(el.currentTime));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="text-center text-gray-500 py-16">加载中…</div>;

  if (!video) {
    return (
      <div className="text-center text-gray-500 py-16">
        <p>媒体文件未找到</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-sky-400 text-sm">返回</button>
      </div>
    );
  }

  // Video limit only blocks video content — audio is always accessible
  if (isLimitExceeded && !isAudio) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-semibold text-red-400 mb-2">今日学习时长已达上限</h2>
        <p className="text-gray-400 text-sm mb-6">明天再来继续学习吧！</p>
        <button onClick={() => navigate("/")} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors">
          返回首页
        </button>
      </div>
    );
  }

  const src = getVideoUrl(video.file_path);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-3 text-sm text-gray-500">
        <button onClick={() => navigate("/")} className="hover:text-gray-300 transition-colors">首页</button>
        <span>/</span>
        <button onClick={() => navigate(`/plan/${pId}`)} className="hover:text-gray-300 transition-colors truncate max-w-[160px]">
          {plan?.name ?? "计划"}
        </button>
      </div>

      <h1 className="text-lg font-semibold text-gray-100 mb-3 leading-tight">
        {isAudio && <span className="text-purple-400 mr-2">🎵</span>}
        {video.title}
      </h1>

      {isAudio ? (
        /* ── Audio player ── */
        <div className="relative bg-gray-900 rounded-xl overflow-hidden w-full">
          {/* Album art placeholder */}
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-32 h-32 rounded-full bg-purple-900/40 border-2 border-purple-700/40 flex items-center justify-center mb-6">
              <span className="text-6xl">🎵</span>
            </div>
            <p className="text-gray-300 text-base font-medium text-center mb-1">{video.title}</p>
            <p className="text-gray-500 text-sm text-center">{plan?.name}</p>

            {resumedFrom !== null && (
              <div className="mt-4 bg-black/50 text-yellow-300 text-sm px-4 py-2 rounded-full">
                从 {formatTime(resumedFrom)} 继续播放
              </div>
            )}
          </div>

          {/* Audio element — native controls */}
          <div className="px-6 pb-6">
            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={src}
              controls
              autoPlay
              className="w-full"
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={handlePlay}
              onPause={handlePause}
              onEnded={handleEnded}
            />
          </div>

          {ended && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 rounded-xl">
              <div className="text-5xl mb-3">✅</div>
              <div className="text-xl font-semibold text-green-400 mb-1">本曲已完成</div>
              <div className="text-sm text-gray-400">正在返回首页…</div>
            </div>
          )}
        </div>
      ) : (
        /* ── Video player ── */
        <div className="relative bg-black rounded-xl overflow-hidden aspect-video w-full">
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={src}
            controls
            autoPlay
            className="w-full h-full"
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
          />

          {resumedFrom !== null && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-black/70 text-yellow-300 text-sm px-4 py-2 rounded-full pointer-events-none">
              从 {formatTime(resumedFrom)} 继续播放
            </div>
          )}

          {ended && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85">
              <div className="text-5xl mb-3">✅</div>
              <div className="text-xl font-semibold text-green-400 mb-1">本集已完成</div>
              <div className="text-sm text-gray-400">正在返回首页…</div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => navigate(`/plan/${pId}`)}
        className="mt-3 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        ← 返回计划目录
      </button>
    </div>
  );
}
