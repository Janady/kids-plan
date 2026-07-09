import { useState, useEffect, useCallback } from "react";
import { listVideosForPlan } from "../api/videos";
import type { Video } from "../types";

export function useVideos(planId: number) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listVideosForPlan(planId);
      setVideos(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { videos, loading, error, refresh };
}
