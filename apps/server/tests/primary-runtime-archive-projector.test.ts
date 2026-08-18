import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntimeKind } from "@onmyagent/types/agent-runtime";
import type { SessionArchiveMessage } from "@onmyagent/types/session-archive";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import { openSessionArchiveStore } from "../src/services/session-archive-open.js";
import {
  canonicalArchiveSessionId,
  startPrimaryRuntimeArchiveProjector,
} from "../src/services/primary-runtime-archive-projector.js";
import { PrimaryRuntimeEventBus } from "../src/services/primary-runtime-events.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("PrimaryRuntimeArchiveProjector", () => {
  test("projects canonical OpenCode and Grok events without touching native stores", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-primary-archive-"));
    roots.push(root);
    const workspace: WorkspaceInfo = {
      id: "workspace",
      name: "Workspace",
      path: join(root, "workspace"),
      preset: "starter",
      workspaceType: "local",
    };
    await mkdir(workspace.path, { recursive: true });
    const dbPath = join(root, "archive.sqlite");
    const events = new PrimaryRuntimeEventBus();
    const projector = startPrimaryRuntimeArchiveProjector({
      events,
      workspaces: [workspace],
      resolveDbPath: () => dbPath,
    });

    emitConversation(events, workspace, "opencode", "shared-product", "native-open");
    emitConversation(events, workspace, "grok-build", "shared-product", "native-grok");
    events.emitForNative("grok-build", "native-grok", {
      kind: "usage.updated",
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        reasoningTokens: 5,
        cacheReadTokens: 30,
        costUsd: 0.01,
        modelRef: { modelId: "grok-4.5" },
      },
    });
    await projector.flush();

    const store = await openSessionArchiveStore({ dbPath });
    try {
      const openId = canonicalArchiveSessionId("opencode", "shared-product");
      const grokId = canonicalArchiveSessionId("grok-build", "shared-product");
      expect(openId).not.toBe(grokId);
      expect(store.getSession(openId)).toMatchObject({
        runtime_kind: "opencode",
        runtime_session_id: "native-open",
        runtime_profile_id: "primary-opencode",
        source_session_id: "shared-product",
        message_count: 2,
        user_message_count: 1,
        first_message: "hello opencode",
      });
      expect(store.getSession(grokId)).toMatchObject({
        runtime_kind: "grok-build",
        runtime_session_id: "native-grok",
        runtime_profile_id: "system",
        source_session_id: "shared-product",
        message_count: 2,
        user_message_count: 1,
        first_message: "hello grok-build",
        total_output_tokens: 25,
        peak_context_tokens: 150,
      });
      expect(store.listMessages(grokId).messages).toEqual([
        expect.objectContaining({
          role: "user",
          content: "hello grok-build",
          source_subtype: "grok-build",
        }),
        expect.objectContaining({
          role: "assistant",
          content: "done",
          has_tool_use: true,
          tool_calls: [expect.objectContaining({ tool_name: "ReadFile" })],
        }),
      ]);
      expect(store.listUsageEvents(grokId)).toEqual([
        expect.objectContaining({
          source: "primary-runtime-canonical",
          model: "grok-4.5",
          input_tokens: 120,
          output_tokens: 20,
          reasoning_tokens: 5,
          cache_read_input_tokens: 30,
          cost_usd: 0.01,
          cost_source: "grok-build",
        }),
      ]);
    } finally {
      store.close();
    }

    events.emitForNative("grok-build", "native-grok", {
      kind: "session.deleted",
      reason: "user_delete",
    });
    await projector.stop();
    const reopened = await openSessionArchiveStore({ dbPath });
    try {
      expect(reopened.getSessionIncludingDeleted(
        canonicalArchiveSessionId("grok-build", "shared-product"),
      )?.deleted_at).toBeString();
      expect(reopened.getSession(
        canonicalArchiveSessionId("opencode", "shared-product"),
      )).not.toBeNull();
    } finally {
      reopened.close();
    }
  });

  test("preserves messages beyond the public archive page limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-primary-archive-long-"));
    roots.push(root);
    const workspace: WorkspaceInfo = {
      id: "workspace-long",
      name: "Workspace long",
      path: join(root, "workspace"),
      preset: "starter",
      workspaceType: "local",
    };
    await mkdir(workspace.path, { recursive: true });
    const dbPath = join(root, "archive.sqlite");
    const events = new PrimaryRuntimeEventBus();
    const projector = startPrimaryRuntimeArchiveProjector({
      events,
      workspaces: [workspace],
      resolveDbPath: () => dbPath,
    });
    const productSessionId = "long-product";
    const runtimeSessionId = "long-native";
    emitConversation(events, workspace, "grok-build", productSessionId, runtimeSessionId);
    await projector.flush();

    const archiveId = canonicalArchiveSessionId("grok-build", productSessionId);
    const store = await openSessionArchiveStore({ dbPath });
    try {
      store.replaceSessionMessages(
        archiveId,
        Array.from({ length: 1_001 }, (_, ordinal) => archiveTestMessage(archiveId, ordinal)),
      );
      expect(store.listMessages(archiveId, { limit: 10_000 }).messages).toHaveLength(1_000);
      expect(store.listAllMessages(archiveId)).toHaveLength(1_001);
    } finally {
      store.close();
    }

    events.emitForNative("grok-build", runtimeSessionId, {
      kind: "message.completed",
      message: {
        id: "message-1001",
        productSessionId,
        role: "assistant",
        createdAt: Date.now(),
        parts: [{ type: "text", id: "text-1001", text: "last" }],
      },
    });
    await projector.stop();

    const reopened = await openSessionArchiveStore({ dbPath });
    try {
      const messages = reopened.listAllMessages(archiveId);
      expect(messages).toHaveLength(1_002);
      expect(messages.at(-1)).toMatchObject({ source_uuid: "message-1001", content: "last" });
    } finally {
      reopened.close();
    }
  });
});

function archiveTestMessage(sessionId: string, ordinal: number): SessionArchiveMessage {
  return {
    id: ordinal,
    session_id: sessionId,
    ordinal,
    role: ordinal % 2 === 0 ? "user" : "assistant",
    content: `message ${ordinal}`,
    timestamp: new Date(ordinal).toISOString(),
    has_thinking: false,
    thinking_text: "",
    has_tool_use: false,
    content_length: `message ${ordinal}`.length,
    model: "",
    context_tokens: 0,
    output_tokens: 0,
    tool_calls: [],
    is_system: false,
    source_type: "primary-runtime-canonical",
    source_subtype: "grok-build",
    source_uuid: `message-${ordinal}`,
  };
}

function emitConversation(
  events: PrimaryRuntimeEventBus,
  workspace: WorkspaceInfo,
  runtimeKind: AgentRuntimeKind,
  productSessionId: string,
  runtimeSessionId: string,
): void {
  const now = Date.now();
  const profileId = runtimeKind === "grok-build" ? "system" : "primary-opencode";
  events.bindNativeSession(runtimeKind, runtimeSessionId, productSessionId, {
    workspaceId: workspace.id,
    cwd: workspace.path,
    profileId,
  });
  events.emitForNative(runtimeKind, runtimeSessionId, {
    kind: "session.created",
    session: {
      productSessionId,
      runtimeKind,
      runtimeSessionId,
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId,
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
    },
  });
  events.emitForNative(runtimeKind, runtimeSessionId, {
    kind: "message.completed",
    message: {
      id: `${runtimeKind}-user`,
      productSessionId,
      role: "user",
      createdAt: now + 1,
      parts: [{ type: "text", id: "text-user", text: `hello ${runtimeKind}` }],
    },
  });
  events.emitForNative(runtimeKind, runtimeSessionId, {
    kind: "message.completed",
    message: {
      id: `${runtimeKind}-assistant`,
      productSessionId,
      role: "assistant",
      createdAt: now + 2,
      parts: [
        { type: "text", id: "text-assistant", text: "done" },
        {
          type: "tool",
          id: "tool-part",
          toolCallId: "tool-call",
          name: "ReadFile",
          status: "completed",
          input: { path: "README.md" },
          output: { ok: true },
        },
      ],
    },
  });
}
