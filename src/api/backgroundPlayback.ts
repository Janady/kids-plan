import { invoke } from "@tauri-apps/api/core";
import { IS_ANDROID } from "../hooks/usePlatform";

// Starts/stops the Android foreground MediaPlayer service that keeps
// background music playing after the screen is locked. No-op on other platforms.
export async function setBackgroundPlayback(
  playing: boolean,
  title?: string,
  path?: string,
  loopTrack?: boolean,
): Promise<void> {
  if (!IS_ANDROID) return;
  try {
    await invoke("set_background_playback", {
      playing,
      title: title ?? null,
      path: path ?? null,
      loopTrack: loopTrack ?? false,
    });
  } catch {
    // Older APKs without the plugin still play while the screen is on.
  }
}
