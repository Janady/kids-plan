import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

export const getCastState = (): Promise<CastStateSnapshot | null> =>
  invoke("get_cast_state");

export const onCastStateChanged = (
  handler: (snapshot: CastStateSnapshot) => void
): Promise<UnlistenFn> =>
  listen<CastStateSnapshot>("cast://state-changed", (event) => handler(event.payload));
