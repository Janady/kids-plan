import { invoke } from "@tauri-apps/api/core";
import type { DayStat, OverallStats } from "../types";

export const getDailyStats = (): Promise<DayStat[]> => invoke("get_daily_stats");
export const getOverallStats = (): Promise<OverallStats> => invoke("get_overall_stats");
