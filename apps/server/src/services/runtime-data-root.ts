import { homedir } from "node:os";
import { join } from "node:path";

const DARWIN_PRODUCTION_APP_ID = "com.differentai.onmyagent";
const DARWIN_DEVELOPMENT_APP_ID = "com.differentai.onmyagent.dev";

/**
 * Resolve the server-owned data root for primary-runtime selection/bindings.
 * Existing session-archive storage has a separate compatibility contract and
 * must not be relocated as a side effect of runtime switching.
 */
export function resolveRuntimeDataRoot(dataRoot?: string): string {
  const override = dataRoot?.trim()
    || process.env.ONMYAGENT_PRIMARY_RUNTIME_DATA_ROOT?.trim();
  if (override) return override;
  if (process.platform !== "darwin") return join(homedir(), ".onmyagent");
  const appId = process.env.ONMYAGENT_DEV_MODE === "1"
    ? DARWIN_DEVELOPMENT_APP_ID
    : DARWIN_PRODUCTION_APP_ID;
  return join(homedir(), "Library", "Application Support", appId);
}
