import {
  agentRuntimeKindSchema,
  agentRuntimeModelRefSchema,
  agentRuntimeSessionProfileSchema,
  grokBuildRuntimeSelectionSchema,
} from "@onmyagent/types/agent-runtime";
import { ApiError } from "../core/errors.js";
import type { AgentRuntimeSelectionStore } from "../services/agent-runtime-selection.js";
import type { PrimaryRuntimeRegistry } from "../services/primary-runtime-registry.js";
import { selectedGrokProfileId } from "../services/primary-runtime-registry.js";
import type { PrimaryRuntimeEventBus } from "../services/primary-runtime-events.js";
import {
  buildRuntimeConnectorToolsResponse,
  type ConnectorMcpProjectionSnapshot,
} from "../services/runtime-mcp-projection.js";
import {
  addRoute,
  systemJsonResponse,
  type RequestContext,
  type Route,
} from "./route-core.js";
import {
  AGENT_RUNTIME_PROMPT_HTTP_BODY_MAX_BYTES,
  assertPromptAggregateWithinBudget,
  parsePromptParts,
} from "../services/agent-runtime-prompt-parts.js";

export function registerAgentRuntimeRoutes(input: {
  routes: Route[];
  registry: PrimaryRuntimeRegistry;
  selection: AgentRuntimeSelectionStore;
  events: PrimaryRuntimeEventBus;
  ensureWritable: (config: RequestContext["config"]) => void;
  requireClientScope: (ctx: RequestContext, required: "collaborator") => void;
  readJsonBody: (
    request: Request,
    options?: { maxBytes?: number },
  ) => Promise<Record<string, unknown>>;
  readConnectorMcpProjection?: () => Promise<ConnectorMcpProjectionSnapshot>;
}): void {
  const {
    routes,
    registry,
    selection,
    events,
    ensureWritable,
    requireClientScope,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/agent-runtime/selection", "client", async (ctx) => {
    const state = await selection.read();
    const availableRuntimeKinds = registry.availableRuntimeKinds();
    const workspaceId = new URL(ctx.request.url).searchParams
      .get("workspaceId")?.trim() || undefined;
    const health = await Promise.all(
      availableRuntimeKinds.map((kind) => registry.probeRuntime(kind)),
    );
    return systemJsonResponse({
      ...state,
      availableRuntimeKinds,
      selectableDefaultRuntimeKinds: registry.selectableRuntimeKinds(),
      ...(workspaceId
        ? {
            selectableWorkspaceRuntimeKinds:
              registry.selectableRuntimeKinds(workspaceId),
          }
        : {}),
      health,
      rollout: await registry.rolloutSnapshot(),
    });
  });

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-connectors",
    "client",
    async (ctx) => {
      const rawKind = new URL(ctx.request.url).searchParams.get("runtimeKind");
      const runtimeKind = rawKind
        ? parseRuntimeKind(rawKind)
        : (await selection.resolve(ctx.params.id)).runtimeKind;
      const snapshot = await input.readConnectorMcpProjection?.() ?? {
        descriptors: [],
        accounts: [],
        complete: true,
      };
      return systemJsonResponse(buildRuntimeConnectorToolsResponse({
        runtimeKind,
        workspaceId: ctx.params.id,
        descriptors: snapshot.descriptors,
        accounts: snapshot.accounts,
        complete: snapshot.complete,
      }));
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/rename",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      const body = await readJsonBody(ctx.request);
      return systemJsonResponse({
        session: await registry.renameSession(
          ctx.params.id,
          ctx.params.sessionId,
          requiredBoundedString(body.title, "title", 500),
        ),
      });
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/fork",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      const body = await readJsonBody(ctx.request);
      const newProductSessionId = body.productSessionId === undefined
        ? undefined
        : requiredId(body.productSessionId, "productSessionId");
      const targetRuntimeKind = body.targetRuntimeKind === undefined
        ? undefined
        : parseRuntimeKind(body.targetRuntimeKind);
      return systemJsonResponse({
        session: await registry.forkSession(
          ctx.params.id,
          ctx.params.sessionId,
          newProductSessionId,
          targetRuntimeKind,
        ),
      }, 201);
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/model",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      const body = await readJsonBody(ctx.request);
      const modelRef = parseModelRef(body.modelRef);
      return systemJsonResponse({
        session: await registry.setSessionModel(
          ctx.params.id,
          ctx.params.sessionId,
          modelRef,
        ),
      });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-commands",
    "client",
    async (ctx) => {
      const rawKind = new URL(ctx.request.url).searchParams.get("runtimeKind");
      return systemJsonResponse(
        await registry.listRuntimeCommands(
          ctx.params.id,
          rawKind ? parseRuntimeKind(rawKind) : undefined,
        ),
      );
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-sessions/:sessionId/commands",
    "client",
    async (ctx) => systemJsonResponse(
      await registry.listSessionCommands(ctx.params.id, ctx.params.sessionId),
    ),
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/commands/:commandName",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      const body = await readJsonBody(ctx.request);
      const argumentsText = body.arguments === undefined
        ? undefined
        : optionalText(body.arguments, "arguments", 16_000);
      return systemJsonResponse({
        ok: true,
        ...await registry.executeSessionCommand(
          ctx.params.id,
          ctx.params.sessionId,
          requiredId(ctx.params.commandName, "commandName"),
          { ...(argumentsText ? { arguments: argumentsText } : {}) },
        ),
      }, 202);
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/mode",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      const body = await readJsonBody(ctx.request);
      const mode = requiredId(body.mode, "mode");
      return systemJsonResponse({
        session: await registry.setSessionMode(
          ctx.params.id,
          ctx.params.sessionId,
          mode,
        ),
      });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-sessions/:sessionId/messages",
    "client",
    async (ctx) => systemJsonResponse(
      await registry.readSessionMessages(ctx.params.id, ctx.params.sessionId),
    ),
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/questions/:questionId",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      const body = await readJsonBody(ctx.request);
      const answers = parseQuestionAnswers(body.answers);
      await registry.respondSessionQuestion(
        ctx.params.id,
        ctx.params.sessionId,
        requiredId(ctx.params.questionId, "questionId"),
        answers,
      );
      return systemJsonResponse({ ok: true });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-models",
    "client",
    async (ctx) => {
      const rawKind = new URL(ctx.request.url).searchParams.get("runtimeKind");
      const runtimeKind = rawKind ? parseRuntimeKind(rawKind) : undefined;
      return systemJsonResponse(await registry.getModelCatalog(ctx.params.id, runtimeKind));
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-authenticate",
    "host",
    async (ctx) => {
      ensureWritable(ctx.config);
      const body = await readJsonBody(ctx.request);
      const runtimeKind = parseRuntimeKind(body.runtimeKind);
      const methodId = requiredId(body.methodId, "methodId");
      return systemJsonResponse(await registry.authenticateRuntime(
        ctx.params.id,
        runtimeKind,
        methodId,
      ));
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-sessions/:sessionId/event-snapshot",
    "client",
    async (ctx) => {
      await registry.ensureEventSession(ctx.params.id, ctx.params.sessionId);
      const query = new URL(ctx.request.url).searchParams;
      return systemJsonResponse(events.snapshot(ctx.params.sessionId, {
        afterSequence: optionalNonNegativeInteger(
          query.get("afterSequence"),
          "afterSequence",
        ),
        limit: optionalPositiveInteger(query.get("limit"), "limit"),
      }));
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-sessions",
    "client",
    async (ctx) => systemJsonResponse(await registry.listSessions(ctx.params.id)),
  );

  addRoute(
    routes,
    "POST",
    "/agent-runtime/selection/default",
    "host",
    async (ctx) => {
      ensureWritable(ctx.config);
      const body = await readJsonBody(ctx.request);
      const runtimeKind = parseRuntimeKind(body.runtimeKind);
      registry.assertDefaultRuntimeSelectable(runtimeKind);
      const config = await selection.setDefaultRuntimeKind(runtimeKind, {
        expectedRevision: optionalRevision(body.expectedRevision),
      });
      return systemJsonResponse({ config });
    },
  );

  addRoute(
    routes,
    "POST",
    "/agent-runtime/selection/workspaces/:id",
    "host",
    async (ctx) => {
      ensureWritable(ctx.config);
      const body = await readJsonBody(ctx.request);
      const runtimeKind = body.runtimeKind === null
        ? null
        : parseRuntimeKind(body.runtimeKind);
      if (runtimeKind) registry.assertRuntimeSelectable(runtimeKind, ctx.params.id);
      const config = await selection.setWorkspaceOverride(
        ctx.params.id,
        runtimeKind,
        { expectedRevision: optionalRevision(body.expectedRevision) },
      );
      return systemJsonResponse({ config });
    },
  );

  addRoute(
    routes,
    "POST",
    "/agent-runtime/selection/grok-build",
    "host",
    async (ctx) => {
      ensureWritable(ctx.config);
      const body = await readJsonBody(ctx.request);
      const selectionValue = body.selection === null
        ? null
        : parseGrokSelection(body.selection);
      if (selectionValue) {
        if (
          selectionValue.profileId
          && selectionValue.homeMode
          && selectionValue.profileId !== selectionValue.homeMode
        ) {
          throw new ApiError(
            400,
            "agent_runtime_profile_invalid",
            "Grok profile and home mode must match",
          );
        }
        registry.assertRuntimeSelectable("grok-build");
        registry.assertGrokProfileSelectable(selectedGrokProfileId(selectionValue));
      }
      const config = await selection.setGrokBuildSelection(selectionValue, {
        expectedRevision: optionalRevision(body.expectedRevision),
      });
      return systemJsonResponse({ config });
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      const body = await readJsonBody(ctx.request);
      const productSessionId = optionalId(body.productSessionId)
        ?? crypto.randomUUID();
      if (body.runtimeKind !== undefined) {
        throw new ApiError(
          400,
          "agent_runtime_explicit_selection_forbidden",
          "Runtime selection is managed by the host profile and workspace settings",
        );
      }
      if (body.profile !== undefined) requireClientScope(ctx, "collaborator");
      const modelRef = body.modelRef === undefined
        ? undefined
        : parseModelRef(body.modelRef);
      const mode = body.mode === undefined
        ? undefined
        : requiredId(body.mode, "mode");
      const profile = body.profile === undefined
        ? undefined
        : parseSessionProfile(body.profile);
      const session = await registry.createSession({
        productSessionId,
        workspaceId: ctx.params.id,
        ...(modelRef ? { modelRef } : {}),
        ...(mode ? { mode } : {}),
        ...(profile ? { profile } : {}),
      });
      return systemJsonResponse({ session }, 201);
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-sessions/:sessionId",
    "client",
    async (ctx) => systemJsonResponse({
      session: await registry.getSession(ctx.params.id, ctx.params.sessionId),
    }),
  );

  addRoute(
    routes,
    "DELETE",
    "/workspace/:id/runtime-sessions/:sessionId",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      await registry.deleteSession(ctx.params.id, ctx.params.sessionId);
      return systemJsonResponse({ ok: true });
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/prompt",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      const body = await readJsonBody(ctx.request, {
        maxBytes: AGENT_RUNTIME_PROMPT_HTTP_BODY_MAX_BYTES,
      });
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw invalidPayload("text is required");
      const systemPrompt = body.systemPrompt === undefined
        ? undefined
        : optionalText(body.systemPrompt, "systemPrompt", 128 * 1024);
      const parts = body.parts === undefined ? undefined : parsePromptParts(body.parts);
      assertPromptAggregateWithinBudget({
        text,
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(parts?.length ? { parts } : {}),
      });
      const messageId = body.messageId === undefined
        ? undefined
        : requiredId(body.messageId, "messageId");
      const agentId = body.agentId === undefined
        ? undefined
        : requiredId(body.agentId, "agentId");
      const toolAccess = body.toolAccess === undefined
        ? undefined
        : parseToolAccess(body.toolAccess);
      const result = await registry.promptSession(
        ctx.params.id,
        ctx.params.sessionId,
        {
          text,
          ...(systemPrompt ? { systemPrompt } : {}),
          ...(parts?.length ? { parts } : {}),
          ...(messageId ? { messageId } : {}),
          ...(agentId ? { agentId } : {}),
          ...(toolAccess ? { toolAccess } : {}),
        },
      );
      return systemJsonResponse({ ok: true, ...result }, 202);
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/cancel",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      await registry.cancelSession(ctx.params.id, ctx.params.sessionId);
      return systemJsonResponse({ ok: true });
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/close",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      await registry.closeSession(ctx.params.id, ctx.params.sessionId);
      return systemJsonResponse({ ok: true });
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/runtime-sessions/:sessionId/resume",
    "client",
    async (ctx) => {
      assertWrite(ctx, input);
      return systemJsonResponse({
        session: await registry.resumeSession(
          ctx.params.id,
          ctx.params.sessionId,
        ),
      });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/runtime-sessions/:sessionId/events",
    "client",
    async (ctx) => {
      await registry.ensureEventSession(ctx.params.id, ctx.params.sessionId);
      return runtimeEventStream(events, ctx.params.sessionId, ctx.request.signal);
    },
  );
}

function runtimeEventStream(
  events: PrimaryRuntimeEventBus,
  productSessionId: string,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        controller.close();
      };
      const send = (event: string, value: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(
          `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
        ));
      };
      send("generation", {
        generation: events.generation,
        productSessionId,
      });
      unsubscribe = events.subscribe(productSessionId, (event) =>
        send("runtime-event", event));
      if (signal.aborted) close();
      else signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function assertWrite(
  ctx: RequestContext,
  input: {
    ensureWritable: (config: RequestContext["config"]) => void;
    requireClientScope: (ctx: RequestContext, required: "collaborator") => void;
  },
): void {
  input.ensureWritable(ctx.config);
  input.requireClientScope(ctx, "collaborator");
}

function parseRuntimeKind(value: unknown): "opencode" | "grok-build" {
  const parsed = agentRuntimeKindSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw invalidPayload("runtimeKind is invalid");
}

function parseGrokSelection(value: unknown) {
  const parsed = grokBuildRuntimeSelectionSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw invalidPayload("Grok Build selection is invalid");
}

function parseModelRef(value: unknown) {
  const parsed = agentRuntimeModelRefSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw invalidPayload("modelRef is invalid");
}

function parseSessionProfile(value: unknown) {
  const parsed = agentRuntimeSessionProfileSchema.safeParse(value);
  if (!parsed.success) throw invalidPayload("profile is invalid");
  return parsed.data;
}

function parseQuestionAnswers(value: unknown): string[][] {
  if (!Array.isArray(value) || value.length > 20) {
    throw invalidPayload("answers is invalid");
  }
  return value.map((answer) => {
    if (!Array.isArray(answer) || answer.length > 50) {
      throw invalidPayload("answers is invalid");
    }
    return answer.map((item) => {
      if (typeof item !== "string" || !item.trim() || item.length > 4_000) {
        throw invalidPayload("answers is invalid");
      }
      return item.trim();
    });
  });
}

function optionalRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw invalidPayload("expectedRevision is invalid");
}

function optionalNonNegativeInteger(
  value: string | null,
  label: string,
): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  throw invalidPayload(`${label} is invalid`);
}

function optionalPositiveInteger(
  value: string | null,
  label: string,
): number | undefined {
  const parsed = optionalNonNegativeInteger(value, label);
  if (parsed === undefined) return undefined;
  if (parsed > 0) return parsed;
  throw invalidPayload(`${label} is invalid`);
}

function optionalId(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  throw invalidPayload("productSessionId is invalid");
}

function requiredId(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw invalidPayload(`${label} is invalid`);
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length > maxLength) {
    throw invalidPayload(`${label} is invalid`);
  }
  return value.trim() || undefined;
}



function parseToolAccess(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPayload("toolAccess is invalid");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 128) throw invalidPayload("toolAccess is invalid");
  return Object.fromEntries(entries.map(([key, enabled]) => {
    const normalized = key.trim();
    if (!normalized || normalized.length > 200 || typeof enabled !== "boolean") {
      throw invalidPayload("toolAccess is invalid");
    }
    return [normalized, enabled];
  }));
}

function requiredBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw invalidPayload(`${label} is invalid`);
  }
  return value;
}

function invalidPayload(message: string): ApiError {
  return new ApiError(400, "invalid_payload", message);
}
