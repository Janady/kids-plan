import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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

  const { isLimitExceeded, refreshTodayTotal, notifyVideoPlay, notifyVideoPause, isParentMode } = useAppContext();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationSetRef = useRef(false);
  const resumeShownRef = useRef(false);

  const { startSession, pauseSession, endSession } = useWatchSession(vId);

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
    const el = videoRef.current;
    if (!el || !video) return;

    const dur = el.duration;
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
    notifyVideoPlay();
    setEnded(false);
    if (!isParentMode) {
      startSession();
      if (video && video.status === "not_watched") {
        await updateVideoStatus(vId, "watching");
        setVideo((v) => (v ? { ...v, status: "watching" } : v));
      }
    }
  }, [video, vId, startSession, notifyVideoPlay, isParentMode]);

  const handlePause = useCallback(async () => {
    notifyVideoPause();
    if (!isParentMode) {
      await pauseSession();
      const el = videoRef.current;
      if (el) await updateVideoProgress(vId, Math.floor(el.currentTime));
    }
  }, [pauseSession, notifyVideoPause, vId, isParentMode]);

  const handleTimeUpdate = useCallback(() => {}, []);

  const handleEnded = useCallback(async () => {
    notifyVideoPause();
    if (!isParentMode) {
      await endSession();
      await updateVideoStatus(vId, "watched");
      setVideo((v) => (v ? { ...v, status: "watched" } : v));
      await refreshTodayTotal();
      setEnded(true);
      setTimeout(() => navigate("/"), 2000);
    } else {
      // Parent mode: just go back home without recording
      navigate("/");
    }
  }, [endSession, notifyVideoPause, vId, refreshTodayTotal, navigate, isParentMode]);

  // Save progress every 5 seconds (child mode only)
  useEffect(() => {
    if (isParentMode) return;
    progressTimerRef.current = setInterval(async () => {
      const el = videoRef.current;
      if (el && !el.paused && !el.ended) {
        await updateVideoProgress(vId, Math.floor(el.currentTime));
      }
    }, 5000);
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  }, [vId]);

  // Flush session on unmount
  useEffect(() => {
    return () => {
      const el = videoRef.current;
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
        <p>视频未找到</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-sky-400 text-sm">返回</button>
      </div>
    );
  }

  if (isLimitExceeded) {
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

  const src = convertFileSrc(video.file_path);

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

      <h1 className="text-lg font-semibold text-gray-100 mb-3 leading-tight">{video.title}</h1>

      {/* Player */}
      <div className="relative bg-black rounded-xl overflow-hidden aspect-video w-full">
        <video
          ref={videoRef}
          src={src}
          controls
          autoPlay
          className="w-full h-full"
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        />

        {/* Resume indicator */}
        {resumedFrom !== null && (
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-black/70 text-yellow-300 text-sm px-4 py-2 rounded-full pointer-events-none">
            从 {formatTime(resumedFrom)} 继续播放
          </div>
        )}

        {/* Completion overlay */}
        {ended && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85">
            <div className="text-5xl mb-3">✅</div>
            <div className="text-xl font-semibold text-green-400 mb-1">本集已完成</div>
            <div className="text-sm text-gray-400">正在返回首页…</div>
          </div>
        )}
      </div>

      {/* Back link */}
      <button
        onClick={() => navigate(`/plan/${pId}`)}
        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        ← 返回计划目录
      </button>
    </div>
  );
}
