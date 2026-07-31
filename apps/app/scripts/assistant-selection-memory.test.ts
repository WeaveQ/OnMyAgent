import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspaceSessionGroup } from "../src/app/types";
import {
  readAssistantSelectionMemory,
  resolveAssistantSelectionMemory,
  writeAssistantSelectionMemory,
} from "../src/react-app/domains/session/sidebar/assistant-selection-memory";
import { writeAssistantSessionCategory } from "../src/react-app/domains/agents/agent-session-state";

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

const storageKeys = [
  "onmyagent.assistantSelection.v1",
  "onmyagent:assistantSessionCategoryById",
];

beforeEach(() => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
});

afterEach(() => {
  for (const key of storageKeys) localStorage.removeItem(key);
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

function sessions(...ids: string[]): WorkspaceSessionGroup["sessions"] {
  return ids.map((id) => ({
    id,
    title: id,
    time: { created: 1, updated: 2 },
  }));
}

describe("assistant selection memory", () => {
  test("defaults office home to new task before the user chooses", () => {
    expect(readAssistantSelectionMemory("ws-1", "office")).toEqual({ kind: "newTask" });
  });

  test("stores office selection per workspace", () => {
    writeAssistantSelectionMemory("ws-1", "office", {
      kind: "session",
      sessionId: "office-session",
    });
    writeAssistantSelectionMemory("ws-2", "office", { kind: "automation" });

    expect(readAssistantSelectionMemory("ws-1", "office")).toEqual({
      kind: "session",
      sessionId: "office-session",
    });
    expect(readAssistantSelectionMemory("ws-2", "office")).toEqual({ kind: "automation" });
  });

  test("restores a remembered session only when it still exists", () => {
    writeAssistantSessionCategory("office-session", "office");
    writeAssistantSessionCategory("other-session", "office");

    expect(
      resolveAssistantSelectionMemory({
        workspaceId: "ws-1",
        categoryId: "office",
        selection: { kind: "session", sessionId: "office-session" },
        sessions: sessions("office-session", "other-session"),
      }),
    ).toEqual({ kind: "session", sessionId: "office-session" });

    expect(
      resolveAssistantSelectionMemory({
        workspaceId: "ws-1",
        categoryId: "office",
        selection: { kind: "session", sessionId: "missing-session" },
        sessions: sessions("office-session", "other-session"),
      }),
    ).toEqual({ kind: "newTask" });
  });
});

describe("assistant return navigation contract", () => {
  test("rail return to assistant does not force a new task", () => {
    const assistantPage = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/pages/assistant.tsx",
      ),
      "utf8",
    );
    // Selection memory helpers remain wired for office home restore.
    expect(assistantPage).toContain("readAssistantSelectionMemory");
    expect(assistantPage).toContain("writeAssistantSelectionMemory");
    expect(assistantPage).toContain("resolveAssistantSelectionMemory");
    // The rail handler must not call create-task when view === assistant.
    const railHandler = assistantPage.slice(
      assistantPage.indexOf("onOpenView={(view) => {"),
      assistantPage.indexOf("onOpenAccountSettings="),
    );
    expect(railHandler).not.toContain("onCreateTaskInWorkspace");
    expect(railHandler).toContain("openAssistantSessionView()");
  });

  test("mode switch into assistant does not suppress session restore", () => {
    const pageView = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/shell/session-route/page-view.tsx",
      ),
      "utf8",
    );
    expect(pageView).toContain("onNavigateToMode={(targetMode) => {");
    expect(pageView).not.toContain(
      'if (targetMode === "assistant") {\n              suppressRestoreSessionRef.current = true;',
    );
  });
});
