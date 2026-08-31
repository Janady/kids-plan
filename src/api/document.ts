import { invoke } from "@tauri-apps/api/core";

export async function openDocumentWithSystem(filePath: string): Promise<void> {
  return invoke("open_document_with_system", { filePath });
}
