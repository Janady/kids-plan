import { useEffect, useRef } from "react";
import { addPluginListener } from "@tauri-apps/api/core";
import { useAppContext } from "../context/AppContext";
import { getVideoUrl } from "../api/videoSrc";
import { recordBackgroundPlay } from "../api/sessions";
import { setBackgroundPlayback } from "../api/backgroundPlayback";
import { IS_ANDROID } from "../hooks/usePlatform";
export function BackgroundAudioPlayer() {
  const {
    bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx, bgIsPlaying, bgLoopMode,
    bgTogglePlay, bgNext, bgPrev, bgOnEnded,
  } = useAppContext();

  const audioRef = useRef<HTMLAudioElement>(null);
  const prevTrackKey = useRef<string>("");

  const currentPlan = bgAudioPlans.find((p) => p.id === bgCurrentPlanId) ?? null;
  const currentTrack = currentPlan?.tracks[bgCurrentTrackIdx] ?? null;
  const trackKey = currentTrack ? `${currentTrack.id}` : "";

  // Load new src and record play when track changes.
  // On Android the foreground MediaPlayer service is the actual audio source —
  // WebView <audio> is paused by Chromium on many tablets as soon as the
  // screen turns off, so we must not rely on it there.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!currentTrack) {
      el.src = "";
      return;
    }
    if (trackKey !== prevTrackKey.current) {
      prevTrackKey.current = trackKey;
      if (!IS_ANDROID) {
        el.src = getVideoUrl(currentTrack.file_path);
        if (bgIsPlaying) el.play().catch(() => {});
      }
      if (bgIsPlaying) recordBackgroundPlay(currentTrack.id).catch(() => {});
    }
  }, [trackKey, currentTrack, bgIsPlaying]);

  // Sync play/pause state (desktop / non-Android HTML audio)
  useEffect(() => {
    if (IS_ANDROID) return;
    const el = audioRef.current;
    if (!el || !currentTrack) return;
    if (bgIsPlaying && el.paused && el.src) {
      el.play().catch(() => {});
    } else if (!bgIsPlaying && !el.paused) {
      el.pause();
    }
  }, [bgIsPlaying, currentTrack]);

  // Native Android player: file path, not the WebView HTTP URL.
  useEffect(() => {
    if (bgIsPlaying && currentTrack) {
      setBackgroundPlayback(true, currentTrack.title, currentTrack.file_path, bgLoopMode === "track").catch(() => {});
    } else {
      setBackgroundPlayback(false).catch(() => {});
    }
  }, [bgIsPlaying, currentTrack, bgLoopMode]);

  useEffect(() => {
    return () => { setBackgroundPlayback(false).catch(() => {}); };
  }, []);

  // Native service events (track ended, lock-screen next/prev/pause).
  // evaluateJavascript fallback covers tablets that freeze plugin IPC
  // while the screen is off but still run a resumed WebView.
  const bgOnEndedRef = useRef(bgOnEnded);
  bgOnEndedRef.current = bgOnEnded;
  const bgTogglePlayRef = useRef(bgTogglePlay);
  bgTogglePlayRef.current = bgTogglePlay;
  const bgNextRef = useRef(bgNext);
  bgNextRef.current = bgNext;
  const bgPrevRef = useRef(bgPrev);
  bgPrevRef.current = bgPrev;
  const lastNativeEndedRef = useRef(0);
  const lastNativeNavRef = useRef(0);
  const bgIsPlayingRef = useRef(bgIsPlaying);
  bgIsPlayingRef.current = bgIsPlaying;

  useEffect(() => {
    if (!IS_ANDROID) return;
    const handle = (event: string) => {
      if (event === "ended") {
        const now = Date.now();
        if (now - lastNativeEndedRef.current < 800) return;
        lastNativeEndedRef.current = now;
        bgOnEndedRef.current();
        return;
      }
      if (event === "next" || event === "prev") {
        const now = Date.now();
        if (now - lastNativeNavRef.current < 800) return;
        lastNativeNavRef.current = now;
        if (event === "next") bgNextRef.current();
        else bgPrevRef.current();
        return;
      }
      if (event === "pause") {
        if (bgIsPlayingRef.current) bgTogglePlayRef.current();
      } else if (event === "play") {
        if (!bgIsPlayingRef.current) bgTogglePlayRef.current();
      }
    };
    (window as unknown as { __bgNativeEvent?: (event: string) => void }).__bgNativeEvent = handle;
    let cancelled = false;
    const listeners: { unregister: () => Promise<void> }[] = [];
    for (const event of ["ended", "next", "prev", "pause", "play"]) {
      addPluginListener("background-playback", event, () => handle(event))
        .then((l) => { if (cancelled) void l.unregister(); else listeners.push(l); })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      listeners.forEach((l) => { void l.unregister(); });
      delete (window as unknown as { __bgNativeEvent?: unknown }).__bgNativeEvent;
    };
  }, []);

  // Lock-screen / headset media controls, and a hint to Chromium that this
  // audio should continue while the document is hidden.
  useEffect(() => {
    if (IS_ANDROID) return;
    if (!("mediaSession" in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentPlan?.name ?? "背景音乐",
      album: "背景音乐",
    });
    navigator.mediaSession.playbackState = bgIsPlaying ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => { if (!bgIsPlaying) bgTogglePlay(); });
    navigator.mediaSession.setActionHandler("pause", () => { if (bgIsPlaying) bgTogglePlay(); });
    navigator.mediaSession.setActionHandler("previoustrack", () => bgPrev());
    navigator.mediaSession.setActionHandler("nexttrack", () => bgNext());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    };
  }, [currentTrack, currentPlan, bgIsPlaying, bgTogglePlay, bgPrev, bgNext]);

  // If Chromium auto-pauses the element when the screen turns off, kick it
  // back to playing as long as the user hasn't paused.
  useEffect(() => {
    if (IS_ANDROID) return;
    const el = audioRef.current;
    if (!el) return;
    const resumeIfNeeded = () => {
      if (bgIsPlayingRef.current && el.paused && el.src) {
        el.play().catch(() => {});
      }
    };
    const onPause = () => {
      if (bgIsPlayingRef.current && document.visibilityState === "hidden") {
        el.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", resumeIfNeeded);
    el.addEventListener("pause", onPause);
    return () => {
      document.removeEventListener("visibilitychange", resumeIfNeeded);
      el.removeEventListener("pause", onPause);
    };
  }, [currentTrack]);

  const handleEnded = () => {
    if (bgLoopMode === "track") {
      const el = audioRef.current;
      if (el) { el.currentTime = 0; el.play().catch(() => {}); }
    } else {
      bgOnEnded();
      // Play count is recorded when track actually starts (in the track-change effect)
    }
  };

  return <audio ref={audioRef} onEnded={handleEnded} />;
}
