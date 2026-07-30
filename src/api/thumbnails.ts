import { invoke } from "@tauri-apps/api/core";

export const getCachedThumbnail = (path: string): Promise<string | null> =>
  invoke("get_cached_thumbnail", { path });

export const cacheThumbnail = (path: string, dataUrl: string): Promise<void> =>
  invoke("cache_thumbnail", { path, dataUrl });
