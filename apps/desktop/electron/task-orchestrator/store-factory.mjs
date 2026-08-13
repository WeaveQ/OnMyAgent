// Runtime wiring lives in this tiny module so tests and legacy callers can
// continue importing the JSON-shaped store directly while the desktop
// Task Center uses SQLite as its sole authoritative store.
export {
  createTaskCenterSqliteStore,
  createSqliteTaskOrchestratorStore,
  createTaskOrchestratorSqliteStore,
} from "./sqlite-store.mjs";

import { createTaskOrchestratorSqliteStore } from "./sqlite-store.mjs";

export function createTaskOrchestratorStore(options = {}) {
  return createTaskOrchestratorSqliteStore(options);
}
