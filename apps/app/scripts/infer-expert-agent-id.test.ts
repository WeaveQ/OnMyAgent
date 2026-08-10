import { describe, expect, test } from "bun:test";

import { inferExpertAgentIdFromDirectory } from "../src/react-app/domains/agents/infer-expert-agent-id";
import {
  reconcileSessionOrigins,
  resolveExpertOriginAgentId,
} from "../src/react-app/domains/agents/session-origin-reconciliation";
import {
  isExpertSession,
  readExpertSessionIds,
} from "../src/react-app/domains/agents/agent-session-state";
import {
  readCustomAgentIdForSession,
  writeCustomAgentIdForSession,
} from "../src/react-app/domains/agents/agent-registry-store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("inferExpertAgentIdFromDirectory", () => {
  test("reads package slug from doubled historical segment", () => {
    const dir =
      "/Users/x/Library/Application Support/com.differentai.onmyagent.dev/expert-sessions/abc/项目复盘专家-kol-project-review-specialistkol-project-review-specialist/1786347548004";
    expect(inferExpertAgentIdFromDirectory(dir)).toBe(
      "kol-project-review-specialist:kol-project-review-specialist",
    );
  });

  test("reads package slug from stable segment", () => {
    const dir =
      "/tmp/expert-sessions/ws/kol-media-specialist/1786345979715";
    expect(inferExpertAgentIdFromDirectory(dir)).toBe(
      "kol-media-specialist:kol-media-specialist",
    );
  });

  test("returns null for empty / unrelated paths", () => {
    expect(inferExpertAgentIdFromDirectory(null)).toBeNull();
    expect(inferExpertAgentIdFromDirectory("/Users/work/Documents/ws")).toBeNull();
  });
});

describe("resolveExpertOriginAgentId + reconcile", () => {
  test("infers agentId when origin omits it", () => {
    const storage = new MemoryStorage();
    (globalThis as { localStorage?: Storage }).localStorage = storage;

    const dir =
      "/tmp/expert-sessions/ws/媒介专家-kol-media-specialistkol-media-specialist/1786345979715";
    expect(
      resolveExpertOriginAgentId({ agentId: undefined, directory: dir }),
    ).toBe("kol-media-specialist:kol-media-specialist");

    const sessionId = "ses_infer_media_1";
    writeCustomAgentIdForSession(sessionId, null);
    reconcileSessionOrigins({
      localWorkspaceId: "ws_1",
      originWorkspaceId: "ws_1",
      realSessionIds: new Set([sessionId]),
      origins: [
        {
          workspaceId: "ws_1",
          sessionId,
          kind: "expert",
          directory: dir,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(isExpertSession(sessionId)).toBe(true);
    expect(readCustomAgentIdForSession(sessionId)).toBe(
      "kol-media-specialist:kol-media-specialist",
    );
    expect(readExpertSessionIds()).toContain(sessionId);
  });
});
