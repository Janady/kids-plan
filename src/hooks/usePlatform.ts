import { useEffect, useState } from "react";
import { platform as getPlatform } from "@tauri-apps/plugin-os";

const PLATFORM = getPlatform();
export const IS_ANDROID = PLATFORM === "android";

const RAIL_MQ = "(min-width: 768px) and (orientation: landscape)";

export function usePlatform() {
  const [size, setSize] = useState(() => ({
    w: typeof window === "undefined" ? 0 : window.innerWidth,
    h: typeof window === "undefined" ? 0 : window.innerHeight,
  }));
  const [isRail, setIsRail] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(RAIL_MQ).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(RAIL_MQ);
    const onMq = () => setIsRail(mq.matches);
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    mq.addEventListener("change", onMq);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      mq.removeEventListener("change", onMq);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  const isTV = IS_ANDROID && size.w >= 1280 && size.w / size.h > 1.5;

  return { isAndroid: IS_ANDROID, isTV, isRail };
}
