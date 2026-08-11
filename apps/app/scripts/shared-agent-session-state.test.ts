import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { OnMyAgentAutomationTaskItem } from "../src/app/lib/onmyagent-server";
import {
  addAssistantSession,
  isAssistantSession,
  readAssistantSessionCategory,
  removeAssistantSession,
  writeAssistantSessionCategory,
} from "../src/react-app/domains/agents/agent-session-state";
import {
  removeAutomationSessionRecord,
  readAutomationSessionRecords,
  renameAutomationSessionRecord,
  syncAutomationSessionRecords,
} from "../src/react-app/domains/messaging/automation-session-groups";
import {
  buildExpertSidebarSessionGroups,
  buildExpertWorkspaceSessions,
  listVisibleExpertAgentSessions,
} from "../src/react-app/domains/session/pages/expert-conversation-model";

const storageKeys = [
  "onmyagent:assistantSessionIds",
  "onmyagent:assistantSessionCategoryById",
  "onmyagent.automationSessions.v1:workspace-1",
  "onmyagent.deletedAutomationSessions.v1:workspace-1",
  "onmyagent.assistantSessionWorkspaces.v1",
];

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

const memoryStorage = new MemoryStorage();
const windowEvents = new EventTarget();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: memoryStorage,
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: memoryStorage,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
  },
});

afterEach(() => {
  for (const key of storageKeys) localStorage.removeItem(key);
});

describe("shared agent session state", () => {
  test("persists assistant session ids and categories", () => {
    expect(isAssistantSession("ses-1")).toBe(false);
    expect(readAssistantSessionCategory("ses-1")).toBe("office");

    addAssistantSession("ses-1");
    writeAssistantSessionCategory("ses-1", "office");

    expect(isAssistantSession("ses-1")).toBe(true);
    expect(readAssistantSessionCategory("ses-1")).toBe("office");

    removeAssistantSession("ses-1");

    expect(isAssistantSession("ses-1")).toBe(false);
    expect(readAssistantSessionCategory("unknown")).toBe("office");
  });

  test("scopes expert entries to real sessions in the selected workspace", () => {
    const workspaceASessions = [{ id: "expert-in-a", title: "A" }];
    const workspaceBSessions = [{ id: "session-in-b", title: "B" }];
    const identity = {
      sessionIds: new Set(["expert-in-a", "expert-stale"]),
      agentIdBySessionId: new Map([
        ["expert-in-a", "agent-a"],
        ["expert-stale", "agent-stale"],
      ]),
    };
    expect(listVisibleExpertAgentSessions(workspaceASessions, identity)).toEqual([
      { sessionId: "expert-in-a", agentId: "agent-a" },
    ]);
    expect(listVisibleExpertAgentSessions(workspaceBSessions, identity)).toEqual([]);
    expect(
      buildExpertWorkspaceSessions({ rawWorkspaceSessions: workspaceBSessions }),
    ).toBe(workspaceBSessions);

    const groups = [{
      workspace: { id: "workspace-b", name: "B", path: "/tmp/b", preset: "local", workspaceType: "local" },
      sessions: workspaceBSessions,
      status: "ready" as const,
    }];
    expect(buildExpertSidebarSessionGroups({ groups })).toBe(groups);
  });

  test("does not mix unsummoned starter experts into the conversation list", () => {
    const panelSource = readFileSync(
      resolve(import.meta.dir, "../src/react-app/domains/session/sidebar/agent-conversation-panel.tsx"),
      "utf8",
    );
    expect(panelSource).not.toContain("additionalStarterItems");
    expect(panelSource).not.toContain("buildAgentStarterItems");
  });

  test("indexes each automation run as its own assistant session record", () => {
    const automation = {
      id: "automation-1",
      scene: "office",
      title: "每日 AI 新闻推送",
      prompt: "推送新闻",
      schedule: {
        mode: "weekly",
        day: "daily",
        time: "09:00",
      },
      effectiveRange: {},
      enabled: true,
      createdAt: 1_772_000_000_000,
      updatedAt: 1_772_000_000_000,
      nextRunAt: null,
      running: null,
      lastRun: null,
      runs: [
        {
          status: "success",
          source: "scheduled",
          ranAt: 1_772_100_000_000,
          sessionId: "automation-2026-06-24-09-00-00",
          groupName: "自动化任务-2026-06-24-09-00-00",
          outputDirectory: "/tmp/自动化任务-2026-06-24-09-00-00",
        },
        {
          status: "failed",
          source: "scheduled",
          ranAt: 1_772_200_000_000,
          sessionId: "automation-2026-06-25-09-00-00",
          groupName: "自动化任务-2026-06-25-09-00-00",
          outputDirectory: "/tmp/自动化任务-2026-06-25-09-00-00",
        },
      ],
    } satisfies OnMyAgentAutomationTaskItem;

    syncAutomationSessionRecords("workspace-1", [automation]);

    expect(readAutomationSessionRecords("workspace-1")).toEqual([
      {
        sessionId: "automation-2026-06-24-09-00-00",
        automationId: "automation-1",
        title: "每日 AI 新闻推送",
        groupName: "自动化任务-2026-06-24-09-00-00",
        outputDirectory: "/tmp/自动化任务-2026-06-24-09-00-00",
        category: "office",
        createdAt: 1_772_100_000_000,
      },
      {
        sessionId: "automation-2026-06-25-09-00-00",
        automationId: "automation-1",
        title: "每日 AI 新闻推送",
        groupName: "自动化任务-2026-06-25-09-00-00",
        outputDirectory: "/tmp/自动化任务-2026-06-25-09-00-00",
        category: "office",
        createdAt: 1_772_200_000_000,
      },
    ]);
  });

  test("sync drops local records when the automation definition is gone", () => {
    const automation = {
      id: "automation-1",
      scene: "office",
      title: "异常跟进清单",
      prompt: "跟进",
      schedule: {
        mode: "weekly",
        day: "daily",
        time: "10:00",
      },
      effectiveRange: {},
      enabled: true,
      createdAt: 1_772_000_000_000,
      updatedAt: 1_772_000_000_000,
      nextRunAt: null,
      running: null,
      lastRun: null,
      runs: [
        {
          status: "success",
          source: "scheduled",
          ranAt: 1_772_100_000_000,
          sessionId: "run-1",
          groupName: "自动化任务-异常",
          outputDirectory: "/tmp/自动化任务-异常",
        },
      ],
    } satisfies OnMyAgentAutomationTaskItem;

    syncAutomationSessionRecords("workspace-1", [automation]);
    expect(readAutomationSessionRecords("workspace-1")).toHaveLength(1);

    // Sidebar / page deleted the schedule — remaining automations list is empty.
    syncAutomationSessionRecords("workspace-1", []);
    expect(readAutomationSessionRecords("workspace-1")).toEqual([]);
  });

  test("removes deleted automation sessions and prevents sync from restoring them", () => {
    const automation = {
      id: "automation-1",
      scene: "office",
      title: "每日 AI 新闻推送",
      prompt: "推送新闻",
      schedule: {
        mode: "weekly",
        day: "daily",
        time: "09:00",
      },
      effectiveRange: {},
      enabled: true,
      createdAt: 1_772_000_000_000,
      updatedAt: 1_772_000_000_000,
      nextRunAt: null,
      running: null,
      lastRun: null,
      runs: [
        {
          status: "success",
          source: "scheduled",
          ranAt: 1_772_100_000_000,
          sessionId: "automation-2026-06-24-09-00-00",
          groupName: "自动化任务-2026-06-24-09-00-00",
          outputDirectory: "/tmp/自动化任务-2026-06-24-09-00-00",
        },
      ],
    } satisfies OnMyAgentAutomationTaskItem;

    syncAutomationSessionRecords("workspace-1", [automation]);
    expect(readAutomationSessionRecords("workspace-1")).toHaveLength(1);

    expect(removeAutomationSessionRecord(
      "workspace-1",
      "automation-2026-06-24-09-00-00",
    )).toBe(true);
    expect(readAutomationSessionRecords("workspace-1")).toEqual([]);

    syncAutomationSessionRecords("workspace-1", [automation]);

    expect(readAutomationSessionRecords("workspace-1")).toEqual([]);
  });

  test("renames automation session records for sidebar display", () => {
    const automation = {
      id: "automation-1",
      scene: "office",
      title: "每日代码巡检",
      prompt: "巡检代码",
      schedule: {
        mode: "weekly",
        day: "daily",
        time: "09:00",
      },
      effectiveRange: {},
      enabled: true,
      createdAt: 1_772_000_000_000,
      updatedAt: 1_772_000_000_000,
      nextRunAt: null,
      running: null,
      lastRun: null,
      runs: [
        {
          status: "success",
          source: "scheduled",
          ranAt: 1_772_100_000_000,
          sessionId: "automation-2026-06-24-09-00-00",
          groupName: "自动化任务-2026-06-24-09-00-00",
          outputDirectory: "/tmp/自动化任务-2026-06-24-09-00-00",
        },
      ],
    } satisfies OnMyAgentAutomationTaskItem;

    syncAutomationSessionRecords("workspace-1", [automation]);

    expect(renameAutomationSessionRecord(
      "workspace-1",
      "automation-2026-06-24-09-00-00",
      "已重命名任务",
    )).toBe(true);

    expect(readAutomationSessionRecords("workspace-1")[0]?.title).toBe("已重命名任务");
  });
});
