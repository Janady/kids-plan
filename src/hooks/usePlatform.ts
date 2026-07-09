import { platform as getPlatform } from "@tauri-apps/plugin-os";
import { useState, useEffect } from "react";

interface PlatformInfo {
  isAndroid: boolean;
  isTV: boolean;
}

let cached: PlatformInfo | null = null;

export function usePlatform(): PlatformInfo {
  const [info, setInfo] = useState<PlatformInfo>(cached ?? { isAndroid: false, isTV: false });

  useEffect(() => {
    if (cached) return;
    const p = getPlatform();
    const isAndroid = p === "android";
    let isTV = false;
    if (isAndroid) {
      const { innerWidth, innerHeight } = window;
      isTV = innerWidth >= 1280 && innerWidth / innerHeight > 1.5;
    }
    cached = { isAndroid, isTV };
    setInfo(cached);
  }, []);

  return info;
}
