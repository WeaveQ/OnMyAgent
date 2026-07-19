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
  test("defaults each assistant category to new task before the user chooses", () => {
    expect(readAssistantSelectionMemory("ws-1", "office")).toEqual({ kind: "newTask" });
    expect(readAssistantSelectionMemory("ws-1", "code")).toEqual({ kind: "newTask" });
  });

  test("keeps office and code selections independent per workspace", () => {
    writeAssistantSelectionMemory("ws-1", "office", {
      kind: "session",
      sessionId: "office-session",
    });
    writeAssistantSelectionMemory("ws-1", "code", { kind: "automation" });

    expect(readAssistantSelectionMemory("ws-1", "office")).toEqual({
      kind: "session",
      sessionId: "office-session",
    });
    expect(readAssistantSelectionMemory("ws-1", "code")).toEqual({ kind: "automation" });
    expect(readAssistantSelectionMemory("ws-2", "office")).toEqual({ kind: "newTask" });
  });

  test("restores a remembered session only when it exists in the same category", () => {
    writeAssistantSessionCategory("office-session", "office");
    writeAssistantSessionCategory("code-session", "code");

    expect(
      resolveAssistantSelectionMemory({
        workspaceId: "ws-1",
        categoryId: "office",
        selection: { kind: "session", sessionId: "office-session" },
        sessions: sessions("office-session", "code-session"),
      }),
    ).toEqual({ kind: "session", sessionId: "office-session" });

    expect(
      resolveAssistantSelectionMemory({
        workspaceId: "ws-1",
        categoryId: "office",
        selection: { kind: "session", sessionId: "code-session" },
        sessions: sessions("office-session", "code-session"),
      }),
    ).toEqual({ kind: "newTask" });

    expect(
      resolveAssistantSelectionMemory({
        workspaceId: "ws-1",
        categoryId: "code",
        selection: { kind: "session", sessionId: "missing-session" },
        sessions: sessions("office-session", "code-session"),
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
    // Must restore selection memory instead of always creating a draft.
    expect(assistantPage).toContain("readAssistantSelectionMemory(");
    expect(assistantPage).toContain("Returning to 助理 must NOT force a new task");
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
