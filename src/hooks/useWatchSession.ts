import { useRef, useCallback } from "react";
import { recordWatchTick } from "../api/sessions";
import { useAppContext } from "../context/AppContext";

const TICK_INTERVAL_MS = 3000;

export function useWatchSession(videoId: number) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickAtRef = useRef(0);
  const { refreshTodayTotal } = useAppContext();

  const tick = useCallback(async () => {
    lastTickAtRef.current = Date.now();
    await recordWatchTick(videoId);
    await refreshTodayTotal();
  }, [videoId, refreshTodayTotal]);

  const startSession = useCallback(() => {
    if (intervalRef.current !== null) return;
    // Only fire an immediate tick if enough time has passed since the last one.
    // This prevents the retry-triggered pause→play cycle from inflating the count.
    if (Date.now() - lastTickAtRef.current >= TICK_INTERVAL_MS) {
      tick();
    }
    intervalRef.current = setInterval(tick, TICK_INTERVAL_MS);
  }, [tick]);

  const stopSession = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const pauseSession = useCallback(async () => {
    stopSession();
  }, [stopSession]);

  const endSession = useCallback(async () => {
    stopSession();
  }, [stopSession]);

  return { startSession, pauseSession, endSession };
}
