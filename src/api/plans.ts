import { invoke } from "@tauri-apps/api/core";
import type { Plan, BackgroundAudioPlan, BackgroundTrack, ScanReport } from "../types";

export const addPlan = (
  folderPath: string,
  name?: string,
): Promise<ScanReport> =>
  invoke("add_plan", { folderPath, name: name ?? null, scanVideo: null, scanAudio: null, audioRole: null });

export const listPlans = (): Promise<Plan[]> => invoke("list_plans");

export const deletePlan = (planId: number): Promise<void> =>
  invoke("delete_plan", { planId });

export const rescanPlan = (planId: number): Promise<ScanReport> =>
  invoke("rescan_plan", { planId });

export const activatePlan = (planId: number, episodesPerDay: number): Promise<void> =>
  invoke("activate_plan", { planId, episodesPerDay });

export const deactivatePlan = (planId: number): Promise<void> =>
  invoke("deactivate_plan", { planId });

export const setPlanPriority = (planId: number, priority: number): Promise<void> =>
  invoke("set_plan_priority", { planId, priority });

export const updatePlanMediaSettings = (
  planId: number,
  scanVideo: number,
  scanAudio: number,
  audioRole: string,
): Promise<Plan> =>
  invoke("update_plan_media_settings", { planId, scanVideo, scanAudio, audioRole });

export const listBackgroundAudio = (): Promise<BackgroundAudioPlan[]> =>
  invoke("list_background_audio");

export const getRecentBackgroundTracks = (
  days: number,
  limit: number,
): Promise<BackgroundTrack[]> =>
  invoke("get_recent_background_tracks", { days, limit });

export const deleteBackgroundTrack = (videoId: number): Promise<void> =>
  invoke("delete_background_track", { videoId });

export const setPlanBackground = (planId: number, isBackground: number): Promise<void> =>
  invoke("set_plan_background", { planId, isBackground });
