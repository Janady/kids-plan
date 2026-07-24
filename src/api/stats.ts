import { invoke } from "@tauri-apps/api/core";
import type { DayStat, OverallStats, PlanTimeStat, StatsRange } from "../types";

export const getDailyStats = (): Promise<DayStat[]> => invoke("get_daily_stats");
export const getOverallStats = (): Promise<OverallStats> => invoke("get_overall_stats");
export const getTodayHourlyStats = (): Promise<number[]> => invoke("get_today_hourly_stats");
export const getPlanTimeStats = (range: StatsRange): Promise<PlanTimeStat[]> =>
  invoke("get_plan_time_stats", { range });
