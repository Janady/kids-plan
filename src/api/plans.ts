import { invoke } from "@tauri-apps/api/core";
import type { Plan } from "../types";

export const addPlan = (folderPath: string, name?: string): Promise<Plan> =>
  invoke("add_plan", { folderPath, name: name ?? null });

export const listPlans = (): Promise<Plan[]> => invoke("list_plans");

export const deletePlan = (planId: number): Promise<void> =>
  invoke("delete_plan", { planId });

export const rescanPlan = (planId: number): Promise<Plan> =>
  invoke("rescan_plan", { planId });

export const activatePlan = (planId: number, episodesPerDay: number): Promise<void> =>
  invoke("activate_plan", { planId, episodesPerDay });

export const deactivatePlan = (planId: number): Promise<void> =>
  invoke("deactivate_plan", { planId });

export const setPlanPriority = (planId: number, priority: number): Promise<void> =>
  invoke("set_plan_priority", { planId, priority });
