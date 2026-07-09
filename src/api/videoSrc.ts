import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { IS_ANDROID } from "../hooks/usePlatform";

let port = 0;

export async function initVideoServer(): Promise<void> {
  if (!IS_ANDROID) return;
  port = await invoke<number>("get_video_server_port");
}

export function getVideoUrl(filePath: string): string {
  if (!IS_ANDROID) return convertFileSrc(filePath);
  if (port === 0) return "";
  return `http://127.0.0.1:${port}/?path=${encodeURIComponent(filePath)}`;
}
