import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isPrimarySessionRailView,
  isRailKeepAliveView,
  readAssistantCategoryMemory,
  readRailView,
  writeAssistantCategoryMemory,
  writeRailView,
} from "../src/react-app/domains/session/sidebar/rail-navigation-memory";

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
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

function readPage(name: string) {
  return readFileSync(
    join(import.meta.dir, `../src/react-app/domains/session/pages/${name}`),
    "utf8",
  );
}

describe("rail navigation memory", () => {
  test("persists rail view per mode and workspace", () => {
    expect(readRailView("assistant", "ws-1", "assistant")).toBe("assistant");
    writeRailView("assistant", "ws-1", "localAgent");
    writeRailView("expert", "ws-1", "files");
    writeRailView("assistant", "ws-2", "store");
    expect(readRailView("assistant", "ws-1", "assistant")).toBe("localAgent");
    expect(readRailView("expert", "ws-1", "chat")).toBe("files");
    expect(readRailView("assistant", "ws-2", "assistant")).toBe("store");
  });

  test("persists assistant office/code category per workspace", () => {
    expect(readAssistantCategoryMemory("ws-1")).toBe("office");
    writeAssistantCategoryMemory("ws-1", "code");
    writeAssistantCategoryMemory("ws-2", "office");
    expect(readAssistantCategoryMemory("ws-1")).toBe("code");
    expect(readAssistantCategoryMemory("ws-2")).toBe("office");
  });

  test("ignores unknown rail view values", () => {
    localStorage.setItem(
      "onmyagent.railView.v1",
      JSON.stringify({ "assistant:ws-1": "not-a-real-view" }),
    );
    expect(readRailView("assistant", "ws-1", "assistant")).toBe("assistant");
  });
});

describe("rail keep-alive contract", () => {
  test("assistant and expert keep secondary rail pages mounted via shared shell", () => {
    const shell = readPage("session-page-shell.tsx");
    const assistant = readPage("assistant.tsx") + "\n" + shell;
    const expert = readPage("expert.tsx") + "\n" + shell;
    for (const source of [assistant, expert]) {
      expect(source).toContain("KeepAlivePane");
      expect(source).toContain("useVisitedRailViews");
      expect(source).toContain("writeRailView");
      expect(source).toContain("SessionRailKeepAliveStack");
      expect(source).toContain("SessionPageMainColumn");
      expect(source).toContain('mounted={props.visitedRailViews.has("localAgent")}');
      expect(source).toContain('mounted={props.visitedRailViews.has("files")}');
      expect(source).toContain(
        'mounted={props.visitedRailViews.has("agentManagement")}',
      );
      expect(source).toContain('mounted={props.visitedRailViews.has("store")}');
    }
    expect(assistant).toContain("writeAssistantCategoryMemory");
    expect(assistant).toContain("readAssistantCategoryMemory");
    // Expert rail return must not create a task
    const expertHost = readPage("expert.tsx");
    const expertRail = expertHost.slice(
      expertHost.indexOf("onOpenView={(view) => {"),
      expertHost.indexOf("onOpenAccountSettings="),
    );
    expect(expertRail).not.toContain("onCreateTaskInWorkspace");
  });

  test("keep-alive panes use display:none hide, not visibility:hidden", () => {
    const pane = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/sidebar/keep-alive-pane.tsx",
      ),
      "utf8",
    );
    // visibility:hidden lets descendants paint — that stacked composer over 管理.
    expect(pane).not.toMatch(/className=\{[^}]*\binvisible\b/);
    expect(pane).toContain('props.active ? "z-[1]" : "z-0 hidden"');
  });

  test("primary session rail is only assistant/chat", () => {
    expect(isPrimarySessionRailView("assistant")).toBe(true);
    expect(isPrimarySessionRailView("chat")).toBe(true);
    expect(isPrimarySessionRailView("localAgent")).toBe(false);
    expect(isPrimarySessionRailView("agentManagement")).toBe(false);
    expect(isPrimarySessionRailView("files")).toBe(false);
    expect(isPrimarySessionRailView("store")).toBe(false);
    expect(isRailKeepAliveView("agentManagement")).toBe(true);
    expect(isRailKeepAliveView("assistant")).toBe(false);
  });

  test("assistant and expert hide SessionSurface under secondary rails", () => {
    const shell = readPage("session-page-shell.tsx");
    const assistantHost = readPage("assistant.tsx");
    const expertHost = readPage("expert.tsx");
    for (const host of [assistantHost, expertHost]) {
      expect(host).toContain("isPrimarySessionRailView");
      expect(host).toContain("isPrimarySessionView");
      // Hosts gate primary keep-alive with primary rail + delayed loading.
      expect(host).toMatch(
        /primarySessionActive=\{\s*isPrimarySessionView\s*&&/,
      );
      expect(host).toContain("SessionSurface");
      expect(host).toContain("SessionRailKeepAliveStack");
    }
    // Shared shell wraps primary SessionSurface in KeepAlivePane.
    expect(shell).toMatch(
      /KeepAlivePane[\s\S]*?active=\{\s*props\.primarySessionActive/,
    );
    expect(shell).toContain("primarySession");
  });
});
