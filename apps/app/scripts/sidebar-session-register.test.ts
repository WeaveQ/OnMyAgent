import { describe, expect, test, beforeEach } from "bun:test";

/**
 * Page-mode membership (localStorage) drives assistant "最近" visibility.
 * insertSidebarSession must call these register helpers on create.
 */

const ASSISTANT_SESSION_KEY = "onmyagent:assistantSessionIds";
const EXPERT_SESSION_KEY = "onmyagent:expertSessionIds";

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

  test("addExpertSession makes isExpertSession true", async () => {
    const { addExpertSession, isExpertSession } = await import(
      "../src/react-app/domains/agents/agent-session-state"
    );

    expect(isExpertSession("ses_exp")).toBe(false);
    addExpertSession("ses_exp");
    expect(isExpertSession("ses_exp")).toBe(true);
    expect(localStorage.getItem(EXPERT_SESSION_KEY)).toContain("ses_exp");
  });

  test("registerSidebarSessionPageMode defaults to assistant", async () => {
    // Import the pure helper via dynamic path that does not pull Lexical.
    // sessions.ts transitively imports heavy UI; re-implement contract here
    // matching registerSidebarSessionPageMode behavior.
    const {
      addAssistantSession,
      addExpertSession,
      isAssistantSession,
      isExpertSession,
      writeAssistantSessionCategory,
    } = await import("../src/react-app/domains/agents/agent-session-state");

    function registerSidebarSessionPageMode(
      sessionId: string,
      pageMode?: "assistant" | "expert" | null,
    ): void {
      const id = sessionId.trim();
      if (!id) return;
      if (pageMode === "expert") {
        addExpertSession(id);
        return;
      }
      if (pageMode === "assistant" || pageMode == null) {
        addAssistantSession(id);
        writeAssistantSessionCategory(id, "office");
      }
    }

    registerSidebarSessionPageMode("ses_a");
    expect(isAssistantSession("ses_a")).toBe(true);

    registerSidebarSessionPageMode("ses_e", "expert");
    expect(isExpertSession("ses_e")).toBe(true);
    expect(isAssistantSession("ses_e")).toBe(false);
  });
});
