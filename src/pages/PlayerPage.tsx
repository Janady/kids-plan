import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { getVideoUrl } from "../api/videoSrc";
import { listVideosForPlan } from "../api/videos";
import { updateVideoStatus, updateVideoProgress, setVideoDuration, completeVideoRep } from "../api/videos";
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

// A request can also hang instead of failing outright — e.g. queued behind a
// saturated connection pool with no response yet, or a wedged connection —
// in which case the media element never fires 'error' and PLAYER_RETRY_DELAYS
// above never kicks in; playback just spins forever until the user navigates
// away and back (which force-aborts the pending request via removeAttribute
// + load() in the unmount cleanup below, then a fresh mount tries again).
// This watchdog is a time-based backstop for that case: if metadata hasn't
// arrived within the window below, treat it as failed and retry exactly like
// a real error would. Human patience for "did my tap register" is on the
// order of a second or two, not the 10-15s the server-side timeouts allow —
// so the first check is fast (most stalls are freed almost immediately once
// detected); later attempts widen the window a bit so a load that's merely
// slow (not stuck — e.g. a genuinely cold SD card) gets more benefit of the
// doubt once the earlier attempt has already "warmed up" the disk/connection.
const STALL_TIMEOUTS = [2000, 3000, 5000, 8000];

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
    isBreakRequired, isBedtime, bgStop, allowSkipPlayback } = useAppContext();
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
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Furthest position naturally reached via normal playback — when skipping is
  // disabled, forward seeks past this point are snapped back (rewinding is fine).
  const furthestReachedRef = useRef(0);
  // Mirrors `video?.status` for callbacks (interval/unmount cleanup) whose
  // dependency arrays are intentionally empty — a completed video is replayed
  // from 0 and its progress is never persisted, so this must never fall back
  // to a stale closure value of `video`.
  const videoStatusRef = useRef<Video["status"] | null>(null);
  useEffect(() => { videoStatusRef.current = video?.status ?? null; }, [video]);

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
  // Stop the tick session directly rather than waiting for the element's 'pause'
  // event to bubble to handlePause — if that event is delayed (or never fires
  // because the component unmounts first), the tick interval keeps running and
  // silently records watch time through the entire break.
  useEffect(() => {
    if (isBreakRequired || isBedtime || isLimitExceeded) {
      const el = mediaRef.current;
      if (el && !el.paused) el.pause();
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
      setIsFullscreen(false);
      if (!isAudio) notifyVideoPause();
      if (!isParentMode) pauseSession();
    }
  }, [isBreakRequired, isBedtime, isLimitExceeded, isAudio, isParentMode, notifyVideoPause, pauseSession]);

  // Screen off / app backgrounded (Android lock button, home button, screen
  // timeout) doesn't reliably pause the underlying <video> element on every
  // WebView/device combo — some keep decoding in the background, which would
  // leave the tick interval running and silently count locked-screen time as
  // watch time. Stop the session directly on visibilitychange rather than
  // relying on a 'pause' event that may never fire.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      const el = mediaRef.current;
      if (el && !el.paused) el.pause();
      if (!isAudio) notifyVideoPause();
      if (!isParentMode) {
        pauseSession();
        if (el && videoStatusRef.current !== "watched") updateVideoProgress(vId, Math.floor(el.currentTime));
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isAudio, isParentMode, notifyVideoPause, pauseSession, vId]);

  useEffect(() => {
    setLoading(true);
    setEnded(false);
    setCanFinishEarly(false);
    durationSetRef.current = false;
    resumeShownRef.current = false;
    setResumedFrom(null);
    setDuration(0);
    retryCountRef.current = 0;
    furthestReachedRef.current = 0;
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }

    Promise.all([listVideosForPlan(pId), listPlans()]).then(([videos, plans]) => {
      const found = videos.find((v) => v.id === vId) ?? null;
      setVideo(found);
      setPlan(plans.find((p) => p.id === pId) ?? null);
      setLoading(false);
    });
  }, [pId, vId]);

  // Schedules the next retry attempt (real error or stall-watchdog timeout).
  // Re-arms the watchdog around the retried load so a repeatedly-hanging
  // connection keeps getting recovered rather than only being caught once.
  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    if (retryCountRef.current >= PLAYER_RETRY_DELAYS.length) return;
    const delay = PLAYER_RETRY_DELAYS[retryCountRef.current];
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      mediaRef.current?.load();
      armStallWatchdog();
    }, delay);
  }, []);

  const armStallWatchdog = useCallback(() => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    const timeout = STALL_TIMEOUTS[Math.min(retryCountRef.current, STALL_TIMEOUTS.length - 1)];
    stallTimerRef.current = setTimeout(() => { scheduleRetry(); }, timeout);
  }, []);

  const handleMediaError = scheduleRetry;

  // Arm the watchdog for the initial load attempt as soon as this video is
  // ready to render (autoPlay kicks off the actual network request).
  useEffect(() => {
    if (!video) return;
    armStallWatchdog();
    return () => { if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; } };
  }, [video?.id, armStallWatchdog]);

  const handleLoadedMetadata = useCallback(async () => {
    const el = mediaRef.current;
    if (!el || !video) return;

    // Metadata arrived, so this load attempt succeeded — the stall watchdog
    // no longer applies until the next load (retry or new video).
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }

    const dur = (el as HTMLVideoElement).duration;
    if (isFinite(dur)) setDuration(Math.floor(dur));

    // A completed item is replayed from the start — the recorded progress is
    // stale end-of-video position, which would otherwise open a "finished"
    // video paused at its own end.
    if (video.status !== "watched" && video.progress_seconds > 0 && !resumeShownRef.current) {
      el.currentTime = video.progress_seconds;
      resumeShownRef.current = true;
      setResumedFrom(video.progress_seconds);
      setTimeout(() => setResumedFrom(null), 3000);
    }
    furthestReachedRef.current = Math.max(furthestReachedRef.current, el.currentTime);

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
      // Reaching the end of playback fires a native 'pause' event right before
      // 'ended' (per the HTML5 media spec), so this can run concurrently with
      // handleEnded's completeVideoRep call. Skip the progress write in that
      // case — completeVideoRep is about to reset progress_seconds to 0 anyway,
      // and racing an unguarded write against it here could either collide with
      // completeVideoRep's transaction or silently stomp its reset afterward.
      if (el && !el.ended && videoStatusRef.current !== "watched") {
        await updateVideoProgress(vId, Math.floor(el.currentTime));
      }
    }
  }, [pauseSession, notifyVideoPause, vId, isParentMode, isAudio]);

  // Mark the current item complete, record the session, and head home.
  // Shared by natural end-of-playback and the manual "finish early" button.
  // Any failure here (e.g. a backend error) must not be swallowed silently —
  // without the try/catch, a thrown/rejected completeVideoRep left the player
  // stuck forever with no visible feedback: the "已完成" overlay never showed
  // and the home task never disappeared, with no clue as to why.
  const finishVideo = useCallback(async () => {
    if (!isAudio) notifyVideoPause();
    if (!isParentMode) {
      try {
        await endSession();
        const updated = await completeVideoRep(vId);
        setVideo(updated);
        await refreshTodayTotal();
        setEnded(true);
        setTimeout(() => navigate("/"), 2000);
      } catch (e) {
        alert(`标记完成失败：${e}`);
      }
    } else {
      navigate("/");
    }
  }, [endSession, notifyVideoPause, vId, refreshTodayTotal, navigate, isParentMode, isAudio]);

  const handleEnded = useCallback(() => { finishVideo(); }, [finishVideo]);

  // Show a "finish early" button once playback passes 80% (skip end credits).
  // Also tracks the furthest position reached, used by handleSeeking below to
  // block forward-skipping when allowSkipPlayback is off.
  const handleTimeUpdate = useCallback(() => {
    const el = mediaRef.current;
    if (!el || !el.duration || !isFinite(el.duration)) return;
    furthestReachedRef.current = Math.max(furthestReachedRef.current, el.currentTime);
    if (allowSkipPlayback && el.currentTime / el.duration >= 0.8) setCanFinishEarly(true);
  }, [allowSkipPlayback]);

  // When skipping is disabled, snap any forward seek back to the furthest
  // position actually reached via normal playback — rewinding to re-watch is
  // still allowed, only jumping ahead (drag the seek bar, or double-tap seek
  // controls) is blocked.
  const handleSeeking = useCallback(() => {
    if (allowSkipPlayback) return;
    const el = mediaRef.current;
    if (el && el.currentTime > furthestReachedRef.current + 0.5) {
      el.currentTime = furthestReachedRef.current;
    }
  }, [allowSkipPlayback]);

  // Save progress every 5 seconds (child mode only)
  useEffect(() => {
    if (isParentMode) return;
    progressTimerRef.current = setInterval(async () => {
      const el = mediaRef.current;
      if (el && !el.paused && !el.ended && videoStatusRef.current !== "watched") {
        await updateVideoProgress(vId, Math.floor(el.currentTime));
      }
    }, 5000);
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  }, [vId, isParentMode]);

  // Flush session on unmount, then release the media element's connection.
  // Leaving this src attached after navigating away can hold one of the
  // local video server's scarce per-origin connection slots for up to the
  // server's abandoned-stream timeout, starving thumbnails on the home page.
  // pauseSession() runs unconditionally (not just when el.paused is false):
  // the tick interval can outlive an imperative el.pause() call (e.g. from the
  // break/bedtime effect above) if the 'pause' DOM event hasn't fired yet, so
  // checking el.paused here would leave that interval running after unmount.
  useEffect(() => {
    return () => {
      const el = mediaRef.current;
      pauseSession();
      if (el && !el.paused && !el.ended && videoStatusRef.current !== "watched") {
        updateVideoProgress(vId, Math.floor(el.currentTime));
      }
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      if (el) { el.pause(); el.removeAttribute("src"); el.load(); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="study"><div className="empty">加载中…</div></div>;

  if (!video) {
    return (
      <div className="study">
        <div className="empty">
          <p>媒体文件未找到</p>
          <button onClick={() => navigate(-1)} className="primary mt-4">返回</button>
        </div>
      </div>
    );
  }

  // Video limit only blocks video content — audio is always accessible
  if (isLimitExceeded && !isAudio) {
    return (
      <div className="study flex flex-col items-center justify-center text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-semibold mb-2" style={{ color: "#f0a0a8" }}>今日学习时长已达上限</h2>
        <p className="text-sm mb-6 opacity-70">明天再来继续学习吧！</p>
        <button onClick={() => navigate("/")} className="primary">
          返回首页
        </button>
      </div>
    );
  }

  const src = getVideoUrl(video.file_path);

  return (
    <div className="study">
      <div className="flex items-center gap-2 mb-3 text-sm opacity-70">
        <button onClick={() => navigate("/")}>首页</button>
        <span>/</span>
        <button onClick={() => navigate(`/plan/${pId}`)} className="truncate max-w-[160px]">
          {plan?.name ?? "计划"}
        </button>
      </div>

      <h1 className="text-lg font-semibold mb-3 leading-tight">
        {isAudio && <span className="mr-2" style={{ color: "#c4a6f0" }}>🎵</span>}
        {video.title}
      </h1>

      {isAudio ? (
        <div className="relative rounded-xl overflow-hidden w-full" style={{ background: "#2a221c" }}>
          {/* Album art placeholder */}
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-32 h-32 rounded-full flex items-center justify-center mb-6" style={{ background: "rgba(155,126,217,0.25)", border: "2px solid rgba(155,126,217,0.4)" }}>
              <span className="text-6xl">🎵</span>
            </div>
            <p className="text-base font-medium text-center mb-1">{video.title}</p>
            <p className="text-sm text-center opacity-60">{plan?.name}</p>

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
              className={`w-full ${allowSkipPlayback ? "" : "no-seek"}`}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={handlePlay}
              onPause={handlePause}
              onTimeUpdate={handleTimeUpdate}
              onSeeking={handleSeeking}
              onEnded={handleEnded}
              onError={handleMediaError}
            />
          </div>

          {ended && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 rounded-xl">
              <div className="text-5xl mb-3">✅</div>
              <div className="text-xl font-semibold mb-1" style={{ color: "#7ed9a8" }}>本曲已完成</div>
              <div className="text-sm opacity-70">正在返回首页…</div>
            </div>
          )}
        </div>
      ) : null}

      {/* Audio: finish-early control row below the player */}
      {isAudio && canFinishEarly && !ended && !isParentMode && (
        <div className="mt-3">
          <button
            onClick={finishVideo}
            className="primary"
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
              className={`w-full h-full ${allowSkipPlayback ? "" : "no-seek"}`}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={handlePlay}
              onPause={handlePause}
              onTimeUpdate={handleTimeUpdate}
              onSeeking={handleSeeking}
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
              <div className="text-xl font-semibold mb-1" style={{ color: "#7ed9a8" }}>本集已完成</div>
              <div className="text-sm opacity-70">正在返回首页…</div>
            </div>
          )}
        </div>
      )}

      {/* Control row below the video — reliable taps on all platforms */}
      {!isAudio && !isFullscreen && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(true)}
            className="text-btn"
          >
            <FullscreenIcon size={16} /> 全屏
          </button>

          {canFinishEarly && !ended && !isParentMode && (
            <button
              onClick={finishVideo}
              className="primary"
              title="已看完主要内容，直接标记完成"
            >
              ✓ 完成本集
            </button>
          )}
        </div>
      )}

      <button
        onClick={() => navigate(`/plan/${pId}`)}
        className="mt-3 text-sm opacity-70"
      >
        ← 返回计划目录
      </button>
    </div>
  );
}
