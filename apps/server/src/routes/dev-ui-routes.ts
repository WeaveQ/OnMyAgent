import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveToyUiEnabled } from "../core/capabilities.js";
import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";

/**
 * Dev/toy UI routes. The large `toy-ui.ts` module loads only when a toy UI
 * asset is requested and the feature flag is on — not at route registration.
 */
export function registerDevUiRoutes(routes: Route[]) {
  addRoute(routes, "POST", "/dev/log", "none", async (ctx) => {
    const target = resolveDevLogPath();
    if (!target) {
      return systemJsonResponse({ ok: false, reason: "dev_log_disabled" }, 404);
    }
    let payload: unknown = null;
    try {
      payload = await ctx.request.json();
    } catch {
      return systemJsonResponse({ ok: false, reason: "invalid_json" }, 400);
    }
    const entries = Array.isArray(payload) ? payload : [payload];
    try {
      await mkdir(dirname(target), { recursive: true });
      const lines = entries
        .map((entry) => {
          try {
            const stamped = {
              at: new Date().toISOString(),
              ...(entry as Record<string, unknown>),
            };
            return JSON.stringify(stamped);
          } catch {
            return JSON.stringify({
              at: new Date().toISOString(),
              raw: String(entry),
            });
          }
        })
        .join("\n");
      await appendFile(target, `${lines}\n`, "utf8");
    } catch (error) {
      return systemJsonResponse(
        {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
    return systemJsonResponse({ ok: true, count: entries.length });
  });

  addRoute(routes, "GET", "/dev/log", "none", async () => {
    const target = resolveDevLogPath();
    if (!target) {
      return systemJsonResponse({ ok: false, reason: "dev_log_disabled" });
    }
    return systemJsonResponse({ ok: true, path: target });
  });

  addRoute(routes, "GET", "/ui", "none", async () => {
    assertToyUiEnabled();
    const toy = await loadToyUi();
    return toy.htmlResponse(toy.TOY_UI_HTML);
  });

  addRoute(routes, "GET", "/w/:id/ui", "none", async () => {
    assertToyUiEnabled();
    const toy = await loadToyUi();
    return toy.htmlResponse(toy.TOY_UI_HTML);
  });

  addRoute(routes, "GET", "/ui/assets/toy.css", "none", async () => {
    assertToyUiEnabled();
    const toy = await loadToyUi();
    return toy.cssResponse(toy.TOY_UI_CSS);
  });

  addRoute(routes, "GET", "/ui/assets/toy.js", "none", async () => {
    assertToyUiEnabled();
    const toy = await loadToyUi();
    return toy.jsResponse(toy.TOY_UI_JS);
  });

  addRoute(routes, "GET", "/ui/assets/onmyagent-mark.svg", "none", async () => {
    assertToyUiEnabled();
    const toy = await loadToyUi();
    return toy.svgResponse(toy.TOY_UI_FAVICON_SVG);
  });
}

function resolveDevLogPath(): string | null {
  const raw = (process.env.ONMYAGENT_DEV_LOG_FILE ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function assertToyUiEnabled() {
  if (!resolveToyUiEnabled()) {
    throw new ApiError(404, "ui_disabled", "Toy UI is disabled");
  }
}

async function loadToyUi() {
  return import("../toy-ui.js");
}
