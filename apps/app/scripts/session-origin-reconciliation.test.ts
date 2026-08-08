import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { SessionOriginRecord } from "@onmyagent/types/server";
import {
  addExpertSession,
  isExpertSession,
  readCustomAgentIdForSession,
  writeCustomAgentIdForSession,
} from "../src/react-app/domains/agents";
import {
  migrateLegacySessionOrigins,
  reconcileSessionOrigins,
} from "../src/react-app/domains/agents/session-origin-reconciliation";
import { writeSessionOriginBestEffort } from "../src/react-app/domains/agents/session-origin-write";
import {
  writeAssistantSessionWorkspace,
} from "../src/react-app/capabilities/session-identity/assistant-session-workspaces";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent: () => true },
  });
});

afterEach(() => storage.clear());

function origin(input: Partial<SessionOriginRecord> & Pick<SessionOriginRecord, "sessionId" | "kind">): SessionOriginRecord {
  return {
    workspaceId: "workspace-a",
    createdAt: 1,
    updatedAt: 1,
    ...input,
  };
}

describe("session origin reconciliation", () => {
  test("origin write is best effort and keeps creation synchronous", async () => {
    const writes: Array<{ kind: string; agentId?: string; directory?: string }> = [];
    writeSessionOriginBestEffort({
      client: {
        upsertSessionOrigin: async (_workspaceId, _sessionId, payload) => {
          writes.push(payload);
          throw new Error("metadata unavailable");
        },
      },
      workspaceId: "workspace-a",
      sessionId: "new-session",
      kind: "expert",
      agentId: "agent-a",
      directory: "/tmp/expert",
    });
    await Promise.resolve();
    expect(writes).toEqual([{ kind: "expert", agentId: "agent-a", directory: "/tmp/expert" }]);
  });

  test("uses server origins for listed sessions without pruning bounded-list omissions", () => {
    addExpertSession("automation");
    addExpertSession("stale");
    writeCustomAgentIdForSession("stale", "agent-stale");

    reconcileSessionOrigins({
      localWorkspaceId: "workspace-a",
      originWorkspaceId: "workspace-a",
      realSessionIds: new Set(["expert", "automation"]),
      origins: [
        origin({ sessionId: "expert", kind: "expert", agentId: "agent-expert" }),
        origin({ sessionId: "automation", kind: "automation", agentId: "agent-automation" }),
        origin({ sessionId: "stale", kind: "expert", agentId: "agent-stale" }),
      ],
    });

    expect(isExpertSession("expert")).toBe(true);
    expect(readCustomAgentIdForSession("expert")).toBe("agent-expert");
    expect(isExpertSession("automation")).toBe(false);
    expect(isExpertSession("stale")).toBe(true);
    expect(readCustomAgentIdForSession("stale")).toBe("agent-stale");
  });

  test("removes local expert identity only for an exact authoritative missing origin", () => {
    addExpertSession("deleted-expert");
    writeCustomAgentIdForSession("deleted-expert", "agent-deleted");

    reconcileSessionOrigins({
      localWorkspaceId: "workspace-a",
      originWorkspaceId: "workspace-a",
      realSessionIds: new Set(),
      missingSessionIds: new Set(["deleted-expert"]),
      origins: [origin({ sessionId: "deleted-expert", kind: "expert" })],
    });

    expect(isExpertSession("deleted-expert")).toBe(false);
    expect(readCustomAgentIdForSession("deleted-expert")).toBeNull();
  });

  test("migrates only explicit legacy expert records and real assistant workspace records", async () => {
    addExpertSession("legacy-expert");
    writeCustomAgentIdForSession("legacy-expert", "agent-expert");
    writeCustomAgentIdForSession("agent-map-only", "must-not-migrate");
    writeAssistantSessionWorkspace({
      sessionId: "legacy-assistant",
      ownerWorkspaceId: "workspace-a",
      directory: "/tmp/assistant",
    });
    const writes: Array<{ sessionId: string; kind: string; agentId?: string; directory?: string }> = [];

    await migrateLegacySessionOrigins({
      client: {
        upsertSessionOrigin: async (_workspaceId, sessionId, payload) => {
          writes.push({ sessionId, ...payload });
        },
      },
      localWorkspaceId: "workspace-a",
      originWorkspaceId: "workspace-a",
      realSessionIds: new Set(["legacy-expert", "legacy-assistant"]),
      origins: [],
    });

    expect(writes).toEqual([
      { sessionId: "legacy-expert", kind: "expert", agentId: "agent-expert" },
      { sessionId: "legacy-assistant", kind: "assistant", directory: "/tmp/assistant" },
    ]);
  });

  test("keeps local cache identity separate from a remote server workspace id", async () => {
    addExpertSession("remote-expert");
    writeCustomAgentIdForSession("remote-expert", "agent-remote");
    writeAssistantSessionWorkspace({
      sessionId: "remote-assistant",
      ownerWorkspaceId: "rem_server-workspace",
      directory: "/tmp/remote-assistant",
    });
    const writes: Array<{ workspaceId: string; sessionId: string; kind: string }> = [];
    const remoteOrigin = origin({
      workspaceId: "server-workspace",
      sessionId: "remote-expert",
      kind: "expert",
      agentId: "agent-remote",
    });

    reconcileSessionOrigins({
      localWorkspaceId: "rem_server-workspace",
      originWorkspaceId: "server-workspace",
      realSessionIds: new Set(["remote-expert", "remote-assistant"]),
      origins: [remoteOrigin],
    });
    await migrateLegacySessionOrigins({
      client: {
        upsertSessionOrigin: async (workspaceId, sessionId, payload) => {
          writes.push({ workspaceId, sessionId, kind: payload.kind });
        },
      },
      localWorkspaceId: "rem_server-workspace",
      originWorkspaceId: "server-workspace",
      realSessionIds: new Set(["remote-expert", "remote-assistant"]),
      origins: [remoteOrigin],
    });

    expect(isExpertSession("remote-expert")).toBe(true);
    expect(writes).toEqual([
      {
        workspaceId: "server-workspace",
        sessionId: "remote-assistant",
        kind: "assistant",
      },
    ]);
  });
});
