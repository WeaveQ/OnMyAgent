import type { ServerConfig, TokenScope } from "@onmyagent/types/server";

import { ApiError } from "../core/errors.js";
import {
  importWorkBuddyExpertPackage,
  inspectWorkBuddyExpertPackage,
  listWorkBuddyExpertPackages,
  previewWorkBuddyExpertImport,
  WorkBuddyImportError,
  type WorkBuddyExpertType,
} from "../services/workbuddy-expert-import.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";

export function registerWorkBuddyExpertRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  onGlobalSkillsChanged?: () => Promise<unknown>;
  emitReloadEvent?: (
    reloadEvents: RequestContext["reloadEvents"],
    workspace: ServerConfig["workspaces"][number],
  ) => void;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    readJsonBody,
    onGlobalSkillsChanged,
    emitReloadEvent,
  } = input;

  addRoute(routes, "GET", "/third-party/workbuddy/packages", "client", async (ctx) => {
    const kind = parseKind(ctx.url.searchParams.get("kind"));
    const query = ctx.url.searchParams.get("query")?.trim() ?? "";
    try {
      if (query) {
        const item = await inspectWorkBuddyExpertPackage({ query, kind });
        return systemJsonResponse({ item });
      }
      const items = await listWorkBuddyExpertPackages({ kind });
      return systemJsonResponse({ items, count: items.length });
    } catch (error) {
      throw toApiError(error);
    }
  });

  addRoute(routes, "POST", "/third-party/workbuddy/import", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const body = await readJsonBody(ctx.request);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const kind = parseKind(body.kind);
    try {
      const mode = body.mode === "preview" || body.dryRun === true
        ? "preview"
        : body.mode === "commit"
          ? "commit"
          : null;
      if (mode === "preview") {
        const preview = await previewWorkBuddyExpertImport({ query, kind });
        return systemJsonResponse(preview);
      }
      if (mode === null) {
        throw new WorkBuddyImportError(
          400,
          "workbuddy_import_confirmation_required",
          "Import requires preview mode followed by commit mode with a confirmation token",
        );
      }
      const result = await importWorkBuddyExpertPackage({
        query,
        kind,
        confirmationToken: typeof body.confirmationToken === "string"
          ? body.confirmationToken
          : undefined,
        requireConfirmation: true,
      });
      let skillLinksRefreshed = false;
      let skillLinksRefreshError: string | null = null;
      if (onGlobalSkillsChanged) {
        try {
          await onGlobalSkillsChanged();
          skillLinksRefreshed = true;
        } catch (error) {
          skillLinksRefreshError = error instanceof Error
            ? error.message
            : "Runtime skill link refresh failed";
        }
      }
      let reloadEvents = 0;
      if (emitReloadEvent) {
        for (const workspace of config.workspaces) {
          emitReloadEvent(ctx.reloadEvents, workspace);
          reloadEvents += 1;
        }
      }
      return systemJsonResponse({
        ...result,
        warnings: skillLinksRefreshError
          ? [
              ...result.warnings,
              "Import committed, but runtime skill links could not be refreshed. Restart OnMyAgent before using newly imported skills.",
            ]
          : result.warnings,
        refresh: {
          skillLinksRefreshed,
          error: skillLinksRefreshError,
          reloadEvents,
          catalogVerified: true,
        },
      }, 201);
    } catch (error) {
      throw toApiError(error);
    }
  });
}

function parseKind(value: unknown): WorkBuddyExpertType | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "agent" || value === "team") return value;
  throw new ApiError(400, "workbuddy_kind_invalid", "WorkBuddy kind must be agent or team");
}

function toApiError(error: unknown): ApiError {
  if (error instanceof WorkBuddyImportError) {
    return new ApiError(error.status, error.code, error.message, error.details);
  }
  if (error instanceof ApiError) return error;
  return new ApiError(
    500,
    "workbuddy_import_failed",
    error instanceof Error ? error.message : "WorkBuddy import failed",
  );
}
