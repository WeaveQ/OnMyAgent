import { ApiError } from "../core/errors.js";
import type { ServerConfig } from "@onmyagent/types/server";

const ONMYAGENT_EXPERIMENTAL_EXTENSION_ACTIONS: Array<{
  extensionId: string;
  action: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

export function listExperimentalExtensionActions(extensionId: string) {
  const filter = extensionId.trim();
  return filter
    ? ONMYAGENT_EXPERIMENTAL_EXTENSION_ACTIONS.filter((action) => action.extensionId === filter)
    : ONMYAGENT_EXPERIMENTAL_EXTENSION_ACTIONS;
}

export async function callExperimentalExtensionAction(_config: ServerConfig, input: unknown) {
  if (!isRecord(input)) {
    throw new ApiError(400, "invalid_payload", "Expected extension action call payload");
  }
  const extensionId = readStringField(input, "extensionId");
  const action = readStringField(input, "action");
  const args = isRecord(input.args) ? input.args : {};
  if (!extensionId || !action) {
    throw new ApiError(400, "invalid_payload", "extensionId and action are required");
  }
  throw new ApiError(404, "extension_action_not_found", "OnMyAgent extension action not found", {
    extensionId,
    action,
    args,
  });
}
