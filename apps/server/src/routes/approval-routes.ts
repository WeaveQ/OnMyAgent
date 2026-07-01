import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";

export function registerApprovalRoutes(input: {
  routes: Route[];
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const { routes, readJsonBody } = input;

  addRoute(routes, "GET", "/approvals", "host", async (ctx) => {
    return systemJsonResponse({ items: ctx.approvals.list() });
  });

  addRoute(routes, "POST", "/approvals/:id", "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const reply = body.reply === "allow" ? "allow" : "deny";
    const result = ctx.approvals.respond(ctx.params.id, reply);
    if (!result) {
      throw new ApiError(
        404,
        "approval_not_found",
        "Approval request not found",
      );
    }
    return systemJsonResponse({ ok: true, allowed: result.allowed });
  });
}
