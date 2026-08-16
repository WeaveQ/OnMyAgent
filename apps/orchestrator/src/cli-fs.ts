/**
 * Tiny FS helpers shared by CLI leaf modules.
 * Extracted from cli-shared.ts to avoid barrel cycles.
 */
import { stat } from "node:fs/promises";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
