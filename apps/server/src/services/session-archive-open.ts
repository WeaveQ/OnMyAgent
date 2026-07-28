import { dirname } from "node:path";

import { Database } from "../core/sqlite.js";
import { ensureDir } from "../core/utils.js";
import { initializeArchiveDb, repairEpochArchiveTimestamps } from "./session-archive-schema.js";
import { createSessionArchiveStore } from "./session-archive.js";
import type { SessionArchiveStore } from "./session-archive-types.js";

export async function openSessionArchiveStore(input: {
  dbPath: string;
  readOnly?: boolean;
}): Promise<SessionArchiveStore> {
  if (!input.readOnly) {
    await ensureDir(dirname(input.dbPath));
  }
  const db = input.readOnly
    ? new Database(input.dbPath, { readonly: true })
    : new Database(input.dbPath);
  if (!input.readOnly) {
    initializeArchiveDb(db);
    repairEpochArchiveTimestamps(db);
  }
  return createSessionArchiveStore(input.dbPath, db);
}
