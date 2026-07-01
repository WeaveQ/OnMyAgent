import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";

export function registerRuntimeRoutes(input: {
  routes: Route[];
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const { routes, readJsonBody } = input;

  addRoute(routes, "GET", "/runtime/versions", "client", async () => {
    const snapshot = await fetchRuntimeControl("/runtime/versions");
    return systemJsonResponse(snapshot);
  });

  addRoute(routes, "POST", "/runtime/upgrade", "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const result = await fetchRuntimeControl("/runtime/upgrade", {
      method: "POST",
      body,
    });
    return systemJsonResponse(result, 202);
  });

  addRoute(routes, "GET", "/w/:id/runtime/versions", "client", async () => {
    const snapshot = await fetchRuntimeControl("/runtime/versions");
    return systemJsonResponse(snapshot);
  });

  addRoute(routes, "POST", "/w/:id/runtime/upgrade", "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const result = await fetchRuntimeControl("/runtime/upgrade", {
      method: "POST",
      body,
    });
    return systemJsonResponse(result, 202);
  });
}

function getRuntimeControlConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = (process.env.ONMYAGENT_RUNTIME_CONTROL_URL ?? "").trim();
  const token = (process.env.ONMYAGENT_RUNTIME_CONTROL_TOKEN ?? "").trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

async function fetchRuntimeControl(path: string, init?: { method?: string; body?: unknown }) {
  const control = getRuntimeControlConfig();
  if (!control) {
    throw new ApiError(
      501,
      "runtime_upgrade_unavailable",
      "Worker runtime control is not configured on this host",
    );
  }
  const response = await fetch(`${control.baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${control.token}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      "runtime_upgrade_failed",
      "Worker runtime control request failed",
      json,
    );
  }
  return json;
}
