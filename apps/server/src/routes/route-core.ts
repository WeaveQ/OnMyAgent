import type { Actor, ServerConfig } from "@onmyagent/types/server";
import type { ApprovalService } from "../services/approvals.js";
import type { ReloadEventStore } from "../services/events.js";
import type { TokenService } from "../services/tokens.js";

export type AuthMode = "none" | "client" | "host" | "host-token";

export type RequestContext = {
  request: Request;
  url: URL;
  params: Record<string, string>;
  config: ServerConfig;
  approvals: ApprovalService;
  reloadEvents: ReloadEventStore;
  tokens: TokenService;
  actor?: Actor;
};

export type Route = {
  method: string;
  regex: RegExp;
  keys: string[];
  auth: AuthMode;
  handler: (ctx: RequestContext) => Promise<Response>;
};

export function addRoute(
  routes: Route[],
  method: string,
  path: string,
  auth: AuthMode,
  handler: Route["handler"],
) {
  const keys: string[] = [];
  const regex = pathToRegex(path, keys);
  routes.push({ method, regex, keys, auth, handler });
}

export function systemJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pathToRegex(path: string, keys: string[]): RegExp {
  const pattern = path.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  });
  return new RegExp(`^${pattern}$`);
}
