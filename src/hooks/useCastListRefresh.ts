import { useEffect, useRef } from "react";
import { useAppContext } from "../context/AppContext";
import type { CastPhase } from "../types";

function isTerminalPhase(phase: CastPhase | undefined): boolean {
  return phase === "finished" || phase === "stopped" || phase === "error";
}

// Reloads a page's video/plan list when the in-progress cast moves to a
// new item or the session ends — the tablet stays on the list while the
// TV plays, so mount-only fetches would otherwise stay stale.
export function useCastListRefresh(refresh: () => void | Promise<void>) {
  const { castSnapshot } = useAppContext();
  const videoId = castSnapshot?.current?.video_id ?? null;
  const phase = castSnapshot?.phase;
  const prevRef = useRef<{ videoId: number | null; phase: CastPhase | undefined } | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { videoId, phase };
    if (prev === null) return;
    const itemChanged = prev.videoId !== videoId;
    const justEnded = !isTerminalPhase(prev.phase) && isTerminalPhase(phase);
    if (itemChanged || justEnded) {
      void refresh();
    }
  }, [refresh, videoId, phase]);
}
