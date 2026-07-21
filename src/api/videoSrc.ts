import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { IS_ANDROID } from "../hooks/usePlatform";

let port = 0;
let portPromise: Promise<void> | null = null;

async function fetchPort(): Promise<void> {
  port = await invoke<number>("get_video_server_port");
}

export async function initVideoServer(): Promise<void> {
  if (!IS_ANDROID) return;
  portPromise = fetchPort();
  await portPromise;
}

export function getVideoUrl(filePath: string): string {
  if (!IS_ANDROID) return convertFileSrc(filePath);
  if (port === 0) {
    // Defensive: port is normally set once by initVideoServer() at startup,
    // but if the WebView JS context ever gets recreated while backgrounded,
    // this module-level state resets to 0. Kick off a re-fetch so the next
    // call (e.g. a retry) succeeds instead of returning "" forever.
    if (!portPromise) portPromise = fetchPort().finally(() => { portPromise = null; });
    return "";
  }
  return `http://127.0.0.1:${port}/?path=${encodeURIComponent(filePath)}`;
}
