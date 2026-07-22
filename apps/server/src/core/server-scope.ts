import type { TokenScope } from "@onmyagent/types/server";
import { ApiError } from "./errors.js";
import type { RequestContext } from "../routes/route-core.js";

export function ensureWritable(config: { readOnly?: boolean }): void {
  if (config.readOnly) {
    throw new ApiError(403, "read_only", "Server is read-only");
  }
}

export function scopeRank(scope: TokenScope): number {
  if (scope === "viewer") return 1;
  if (scope === "collaborator") return 2;
  return 3;
}

export function requireClientScope(ctx: RequestContext, required: TokenScope): void {
  const scope = ctx.actor?.scope;
  if (!scope) {
    throw new ApiError(401, "unauthorized", "Missing token scope");
  }
  if (scopeRank(scope) < scopeRank(required)) {
    throw new ApiError(403, "forbidden", "Insufficient token scope", {
      required,
      scope,
    });
  }
}
