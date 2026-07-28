import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { getVideoUrl } from "../api/videoSrc";
import { listVideosForPlan } from "../api/videos";
import { updateVideoStatus, updateVideoProgress, setVideoDuration } from "../api/videos";
import { useWatchSession } from "../hooks/useWatchSession";
import { useAppContext } from "../context/AppContext";
import { usePlatform } from "../hooks/usePlatform";
import { FullscreenIcon, ExitFullscreenIcon } from "../components/MediaIcons";
import { listPlans } from "../api/plans";
import type { Video, Plan } from "../types";

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// The local video server has a small shared per-origin connection budget, so
// the player can transiently fail to grab a socket while home-page thumbnails
// or other cards are using it. Without a retry the element just stays in an
// error state forever, requiring an app restart to recover.
const PLAYER_RETRY_DELAYS = [800, 1600, 3200, 6000];

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
  const [canFinishEarly, setCanFinishEarly] = useState(false);

  const { isLimitExceeded, refreshTodayTotal, notifyVideoPlay, notifyVideoPause, isParentMode,
    isBreakRequired, isBedtime, bgStop } = useAppContext();
  const { isAndroid } = usePlatform();

  // Stop any background music when opening the video player (the video has its
  // own audio). It will resume automatically if a break/bedtime overlay appears.
  useEffect(() => { bgStop(); }, [bgStop]);

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationSetRef = useRef(false);
  const resumeShownRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { startSession, pauseSession, endSession } = useWatchSession(vId);

  const isAudio = video?.media_type === "audio";

  // Custom (CSS-based) fullscreen: native WebView fullscreen is unreliable on
  // Android, so we roll our own — a fixed overlay + CSS rotation to force
  // landscape without depending on physical device rotation.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== "undefined" ? window.innerWidth < window.innerHeight : false
  );

  useEffect(() => {
    const onResize = () => setIsPortrait(window.innerWidth < window.innerHeight);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // Esc / Android back exits custom fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setIsFullscreen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // Break / bedtime / daily-limit must be visible over the video: leave fullscreen.
  // Also cancel any pending connection-retry reload — resuming the media resource
  // there would trigger the element's autoplay attribute and silently resume
  // playback (and tick recording) underneath the overlay.
  useEffect(() => {
    if (isBreakRequired || isBedtime || isLimitExceeded) {
      const el = mediaRef.current;
      if (el && !el.paused) el.pause();
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      setIsFullscreen(false);
    }
  }, [isBreakRequired, isBedtime, isLimitExceeded]);

  useEffect(() => {
    setLoading(true);
    setEnded(false);
    setCanFinishEarly(false);
    durationSetRef.current = false;
    resumeShownRef.current = false;
    setResumedFrom(null);
    setDuration(0);
    retryCountRef.current = 0;
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }

    Promise.all([listVideosForPlan(pId), listPlans()]).then(([videos, plans]) => {
      const found = videos.find((v) => v.id === vId) ?? null;
      setVideo(found);
      setPlan(plans.find((p) => p.id === pId) ?? null);
      setLoading(false);
    });
  }, [pId, vId]);

  const handleMediaError = useCallback(() => {
    if (retryCountRef.current >= PLAYER_RETRY_DELAYS.length) return;
    const delay = PLAYER_RETRY_DELAYS[retryCountRef.current];
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(() => { mediaRef.current?.load(); }, delay);
  }, []);

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
    // Prevent tick recording while a lock overlay is showing. The element can still
    // resume playback via autoplay + retry-triggered .load(), but no session starts.
    if (isBreakRequired || isBedtime || isLimitExceeded) {
      const el = mediaRef.current;
      if (el && !el.paused) el.pause();
      return;
    }

    if (!isAudio) notifyVideoPlay();
    setEnded(false);
    if (!isParentMode) {
      startSession();
      if (video && video.status === "not_watched") {
        await updateVideoStatus(vId, "watching");
        setVideo((v) => (v ? { ...v, status: "watching" } : v));
      }
    }
  }, [video, vId, startSession, notifyVideoPlay, isParentMode, isAudio, isBreakRequired, isBedtime, isLimitExceeded]);

  const handlePause = useCallback(async () => {
    if (!isAudio) notifyVideoPause();
    if (!isParentMode) {
      await pauseSession();
      const el = mediaRef.current;
      if (el) await updateVideoProgress(vId, Math.floor(el.currentTime));
    }
  }, [pauseSession, notifyVideoPause, vId, isParentMode, isAudio]);

  // Mark the current item complete, record the session, and head home.
  // Shared by natural end-of-playback and the manual "finish early" button.
  const finishVideo = useCallback(async () => {
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

  const handleEnded = useCallback(() => { finishVideo(); }, [finishVideo]);

  // Show a "finish early" button once playback passes 80% (skip end credits)
  const handleTimeUpdate = useCallback(() => {
    const el = mediaRef.current;
    if (!el || !el.duration || !isFinite(el.duration)) return;
    if (el.currentTime / el.duration >= 0.8) setCanFinishEarly(true);
  }, []);

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

  // Flush session on unmount, then release the media element's connection.
  // Leaving this src attached after navigating away can hold one of the
  // local video server's scarce per-origin connection slots for up to the
  // server's abandoned-stream timeout, starving thumbnails on the home page.
  useEffect(() => {
    return () => {
      const el = mediaRef.current;
      if (el && !el.paused && !el.ended) {
        pauseSession();
        updateVideoProgress(vId, Math.floor(el.currentTime));
      }
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (el) { el.pause(); el.removeAttribute("src"); el.load(); }
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
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              onError={handleMediaError}
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
      ) : null}

      {/* Audio: finish-early control row below the player */}
      {isAudio && canFinishEarly && !ended && !isParentMode && (
        <div className="mt-3">
          <button
            onClick={finishVideo}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
            title="已听完主要内容，直接标记完成"
          >
            ✓ 完成本集
          </button>
        </div>
      )}

      {!isAudio && (
        /* ── Video player ── */
        <div
          className={
            isFullscreen
              ? "fixed inset-0 z-[80] bg-black flex items-center justify-center"
              : "relative bg-black rounded-xl overflow-hidden aspect-video w-full"
          }
        >
          <div
            className={
              isFullscreen && isAndroid && isPortrait
                ? "absolute bg-black"
                : "relative w-full h-full flex items-center justify-center"
            }
            // In portrait fullscreen on mobile, rotate the video 90° and swap
            // width/height so it fills the screen in landscape — no device rotation needed.
            style={
              isFullscreen && isAndroid && isPortrait
                ? {
                    width: "100vh",
                    height: "100vw",
                    transform: "rotate(90deg)",
                    transformOrigin: "center",
                    left: "calc(50vw - 50vh)",
                    top: "calc(50vh - 50vw)",
                  }
                : undefined
            }
          >
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={src}
              controls
              controlsList="nodownload"
              autoPlay
              className="w-full h-full"
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={handlePlay}
              onPause={handlePause}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              onError={handleMediaError}
            />
          </div>

          {/* Custom fullscreen toggle. Kept inside the player only while in
              fullscreen (so it's reachable over the video); in normal view the
              toggle lives in the button row below, where taps are reliable on
              Android WebView (the native video surface can eat overlay taps). */}
          {isFullscreen && (
            <button
              onClick={() => setIsFullscreen(false)}
              className="absolute top-2 right-2 z-10 w-9 h-9 rounded-lg bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
              title="退出全屏"
            >
              <ExitFullscreenIcon size={18} />
            </button>
          )}

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

      {/* Control row below the video — reliable taps on all platforms */}
      {!isAudio && !isFullscreen && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm transition-colors"
          >
            <FullscreenIcon size={16} /> 全屏
          </button>

          {canFinishEarly && !ended && !isParentMode && (
            <button
              onClick={finishVideo}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
              title="已看完主要内容，直接标记完成"
            >
              ✓ 完成本集
            </button>
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
