import { platform as getPlatform } from "@tauri-apps/plugin-os";

const PLATFORM = getPlatform();
export const IS_ANDROID = PLATFORM === "android";

export function usePlatform() {
  const isTV =
    IS_ANDROID &&
    window.innerWidth >= 1280 &&
    window.innerWidth / window.innerHeight > 1.5;

  return { isAndroid: IS_ANDROID, isTV };
}
