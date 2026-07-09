import { invoke } from "@tauri-apps/api/core";

export const getSetting = (key: string): Promise<string | null> =>
  invoke("get_setting", { key });

export const setSetting = (key: string, value: string): Promise<void> =>
  invoke("set_setting", { key, value });
