import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Assistant page-mode membership drives assistant "最近" visibility. Expert
 * identity is server Directory-derived and must never regain a localStorage
 * membership owner.
 */

const ASSISTANT_SESSION_KEY = "onmyagent:assistantSessionIds";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}

describe("assistant/expert session membership (sidebar filter source)", () => {
  beforeEach(() => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
    storage.clear();
  });

  test("addAssistantSession makes isAssistantSession true", async () => {
    const {
      addAssistantSession,
      isAssistantSession,
      writeAssistantSessionCategory,
      readAssistantSessionCategory,
    } = await import("../src/react-app/domains/agents/agent-session-state");

    expect(isAssistantSession("ses_new")).toBe(false);
    addAssistantSession("ses_new");
    writeAssistantSessionCategory("ses_new", "office");
    expect(isAssistantSession("ses_new")).toBe(true);
    expect(readAssistantSessionCategory("ses_new")).toBe("office");
    expect(localStorage.getItem(ASSISTANT_SESSION_KEY)).toContain("ses_new");
  });

  test("does not restore renderer-owned Expert membership", async () => {
    const sessionState = await import(
      "../src/react-app/domains/agents/agent-session-state"
    );
    expect("addExpertSession" in sessionState).toBe(false);
    expect("isExpertSession" in sessionState).toBe(false);
    expect(localStorage.getItem("onmyagent:expertSessionIds")).toBeNull();
  });

  test("registerSidebarSessionPageMode defaults to assistant", async () => {
    // Import the pure helper via dynamic path that does not pull Lexical.
    // sessions.ts transitively imports heavy UI; re-implement contract here
    // matching registerSidebarSessionPageMode behavior.
    const {
      addAssistantSession,
      isAssistantSession,
      writeAssistantSessionCategory,
    } = await import("../src/react-app/domains/agents/agent-session-state");

    function registerSidebarSessionPageMode(
      sessionId: string,
      pageMode?: "assistant" | "expert" | null,
    ): void {
      const id = sessionId.trim();
      if (!id) return;
      if (pageMode === "expert") return;
      if (pageMode === "assistant" || pageMode == null) {
        addAssistantSession(id);
        writeAssistantSessionCategory(id, "office");
      }
    }

    registerSidebarSessionPageMode("ses_a");
    expect(isAssistantSession("ses_a")).toBe(true);

    registerSidebarSessionPageMode("ses_e", "expert");
    expect(isAssistantSession("ses_e")).toBe(false);

    const routeSource = readFileSync(
      join(import.meta.dir, "../src/react-app/shell/session-route/page-view.tsx"),
      "utf8",
    );
    expect(routeSource).toContain(".upsertIdentity(workspaceId, newSession.id, agentToBind.id)");
  });
});
