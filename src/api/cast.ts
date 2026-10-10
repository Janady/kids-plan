import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { IS_ANDROID } from "../hooks/usePlatform";
import type { CastQueueItem, CastStateSnapshot, RendererInfo } from "../types";

export const discoverRenderers = (timeoutMs?: number): Promise<RendererInfo[]> =>
  invoke("discover_renderers", { timeoutMs: timeoutMs ?? null });

export const startCast = (
  rendererName: string,
  rendererLocation: string,
  queue: CastQueueItem[]
): Promise<void> => invoke("start_cast", { rendererName, rendererLocation, queue });

export const castPause = (): Promise<void> => invoke("cast_pause");

export const castResume = (): Promise<void> => invoke("cast_resume");

export const castStop = (): Promise<void> => invoke("cast_stop");

export const castSwitchVideo = (item: CastQueueItem): Promise<void> =>
  invoke("cast_switch_video", { item });

export const getCastState = (): Promise<CastStateSnapshot | null> =>
  invoke("get_cast_state");

export const onCastStateChanged = (
  handler: (snapshot: CastStateSnapshot) => void
): Promise<UnlistenFn> =>
  listen<CastStateSnapshot>("cast://state-changed", (event) => handler(event.payload));

// Serialized so a cleanup "off" cannot land after the next session's "on".
let keepAwakeChain: Promise<void> = Promise.resolve();

export function setCastKeepAwake(enabled: boolean): Promise<void> {
  if (!IS_ANDROID) return Promise.resolve();
  const run = keepAwakeChain.then(() =>
    invoke("set_cast_keep_awake", { enabled }).then(
      () => {},
      () => {},
    ),
  );
  keepAwakeChain = run;
  return run;
}
