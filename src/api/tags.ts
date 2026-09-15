import { invoke } from "@tauri-apps/api/core";
import type { Tag } from "../types";

export const listTags = (): Promise<Tag[]> => invoke("list_tags");

export const createTag = (name: string, color?: string): Promise<Tag> =>
  invoke("create_tag", { name, color: color ?? null });

export const updateTag = (tagId: number, name: string, color: string): Promise<Tag> =>
  invoke("update_tag", { tagId, name, color });

export const deleteTag = (tagId: number): Promise<void> =>
  invoke("delete_tag", { tagId });

export const bindPlanTag = (planId: number, tagId: number): Promise<void> =>
  invoke("bind_plan_tag", { planId, tagId });

export const unbindPlanTag = (planId: number, tagId: number): Promise<void> =>
  invoke("unbind_plan_tag", { planId, tagId });
