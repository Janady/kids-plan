import { invoke } from "@tauri-apps/api/core";
import { IS_ANDROID } from "../hooks/usePlatform";

// Starts/stops the Android foreground service that keeps background music
// playing after the screen is locked. No-op on other platforms.
export async function setBackgroundPlayback(playing: boolean, title?: string): Promise<void> {
  if (!IS_ANDROID) return;
  try {
    await invoke("set_background_playback", { playing, title: title ?? null });
  } catch {
    // Older APKs without the plugin still play while the screen is on.
  }
}
