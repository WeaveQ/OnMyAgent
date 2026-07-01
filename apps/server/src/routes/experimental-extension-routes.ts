import type { ServerConfig } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import {
  callExperimentalExtensionAction,
  listExperimentalExtensionActions,
} from "../extensions/index.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";

export function registerExperimentalExtensionRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const { routes, config, readJsonBody } = input;

  addRoute(
    routes,
    "GET",
    "/experimental/extensions/actions",
    "client",
    async (ctx) => {
      const extensionId = ctx.url.searchParams.get("extensionId") ?? "";
      return systemJsonResponse({
        ok: true,
        schemaVersion: 1,
        actions: listExperimentalExtensionActions(extensionId),
      });
    },
  );

  addRoute(
    routes,
    "POST",
    "/experimental/extensions/call",
    "client",
    async (ctx) => {
      if (ctx.actor?.scope === "viewer") {
        throw new ApiError(
          403,
          "forbidden",
          "Viewer tokens cannot call extension actions",
        );
      }
      const body = await readJsonBody(ctx.request);
      return systemJsonResponse(await callExperimentalExtensionAction(config, body));
    },
  );
}
