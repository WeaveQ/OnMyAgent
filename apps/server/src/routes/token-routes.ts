import type { ServerConfig, TokenScope } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";
import type { TokenService } from "../services/tokens.js";

export function registerTokenRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  tokens: TokenService;
  ensureWritable: (config: ServerConfig) => void;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const { routes, config, tokens, ensureWritable, readJsonBody } = input;

  addRoute(routes, "GET", "/tokens", "host", async () => {
    const items = await tokens.list();
    return systemJsonResponse({ items });
  });

  addRoute(routes, "POST", "/tokens", "host", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const scope = parseTokenScope(body.scope);
    if (!scope) {
      throw new ApiError(
        400,
        "invalid_scope",
        "Token scope must be owner, collaborator, or viewer",
      );
    }
    const label =
      typeof body.label === "string" ? body.label.trim() : undefined;
    const issued = await tokens.create(scope, { label });
    return systemJsonResponse(issued, 201);
  });

  addRoute(routes, "DELETE", "/tokens/:id", "host", async (ctx) => {
    ensureWritable(config);
    const ok = await tokens.revoke(ctx.params.id);
    if (!ok) {
      throw new ApiError(404, "token_not_found", "Token not found");
    }
    return systemJsonResponse({ ok: true });
  });
}

function parseTokenScope(value: unknown): TokenScope | null {
  const scope = typeof value === "string" ? value.trim() : "";
  if (scope === "owner" || scope === "collaborator" || scope === "viewer") {
    return scope;
  }
  return null;
}
