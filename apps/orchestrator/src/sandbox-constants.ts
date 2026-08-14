/**
 * Sandbox port/path constants and the approval-mode type.
 *
 * Extracted from `cli-shared.ts` so that `cli-sandbox-runtime.ts` can import
 * them without pulling in the `cli-shared` barrel (which re-exports the sandbox
 * runtime), which would otherwise form a circular import.
 */

export type ApprovalMode = "manual" | "auto";

export const DEFAULT_ONMYAGENT_PORT = 8787;

/** Path passed to onmyagent-server `--workspace` inside the container. */
export const SANDBOX_WORKSPACE_DIR = "/workspace";

export const SANDBOX_INTERNAL_OPENCODE_PORT = 4096;
export const SANDBOX_INTERNAL_ONMYAGENT_PORT = DEFAULT_ONMYAGENT_PORT;
// OpenCodeRouter defaults its health server to 3005 when not overridden. In
// sandbox mode we keep the *internal* port stable and only vary the published
// host port to avoid collisions.
export const SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT = 3005;

export const SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH =
  "/persist/.config/opencode";
export const SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH =
  "/persist/.onmyagent-host-opencode-data";
