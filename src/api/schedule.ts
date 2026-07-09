import { invoke } from "@tauri-apps/api/core";
import type { TodayPlanItem } from "../types";

export const getTodaySchedule = (): Promise<TodayPlanItem[]> =>
  invoke("get_today_schedule");
