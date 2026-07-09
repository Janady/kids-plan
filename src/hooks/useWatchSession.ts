import { useRef, useCallback } from "react";
import { recordWatchSession } from "../api/sessions";
import { useAppContext } from "../context/AppContext";

export function useWatchSession(videoId: number) {
  const sessionStartRef = useRef<number | null>(null);
  const { refreshTodayTotal } = useAppContext();

  const startSession = useCallback(() => {
    if (sessionStartRef.current === null) {
      sessionStartRef.current = Date.now();
    }
  }, []);

  const flushSession = useCallback(async () => {
    const start = sessionStartRef.current;
    if (start === null) return;

    const endMs = Date.now();
    const secondsWatched = Math.floor((endMs - start) / 1000);
    sessionStartRef.current = null;

    if (secondsWatched <= 0) return;

    const startedAt = new Date(start).toISOString();
    const endedAt = new Date(endMs).toISOString();

    await recordWatchSession({
      video_id: videoId,
      seconds_watched: secondsWatched,
      started_at: startedAt,
      ended_at: endedAt,
    });

    await refreshTodayTotal();
  }, [videoId, refreshTodayTotal]);

  const pauseSession = useCallback(async () => {
    await flushSession();
  }, [flushSession]);

  const endSession = useCallback(async () => {
    await flushSession();
  }, [flushSession]);

  return { startSession, pauseSession, endSession };
}
