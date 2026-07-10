import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  forgetWorkspaceMemory,
  readActiveWorkspaceId,
  readLastSessionFor,
  readSessionAccessModes,
  readSessionCollaborationModes,
  readSessionGoalRuntimes,
  readWorkspaceOrderIds,
  writeActiveWorkspaceId,
  writeLastSessionFor,
  writeSessionAccessModes,
  writeSessionCollaborationModes,
  writeSessionGoalRuntimes,
  writeWorkspaceOrderIds,
} from "../src/react-app/shell/session-memory";

const ACTIVE_WORKSPACE_KEY = "onmyagent.react.activeWorkspace";
const SESSION_BY_WORKSPACE_KEY = "onmyagent.react.sessionByWorkspace";
const WORKSPACE_ORDER_KEY = "onmyagent.react.workspaceOrder";
const GOAL_RUNTIME_BY_SESSION_KEY = "onmyagent.react.goalRuntimeBySession.v1";
const ACCESS_MODE_BY_SESSION_KEY = "onmyagent.react.accessModeBySession.v1";
const COLLABORATION_MODE_BY_SESSION_KEY = "onmyagent.react.collaborationModeBySession.v1";

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: createLocalStorage() },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("session memory", () => {
  test("persists trimmed active workspace ids and removes empty values", () => {
    writeActiveWorkspaceId(" ws_1 ");
    expect(readActiveWorkspaceId()).toBe("ws_1");
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe("ws_1");

    writeActiveWorkspaceId("   ");
    expect(readActiveWorkspaceId()).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBeNull();
  });

  test("reads workspace order ids from valid string arrays only", () => {
    window.localStorage.setItem(WORKSPACE_ORDER_KEY, JSON.stringify([" ws_a ", "", 123, "ws_b"]));
    expect(readWorkspaceOrderIds()).toEqual(["ws_a", "ws_b"]);

    window.localStorage.setItem(WORKSPACE_ORDER_KEY, "not-json");
    expect(readWorkspaceOrderIds()).toEqual([]);
  });

  test("writes normalized workspace order ids and clears empty order", () => {
    writeWorkspaceOrderIds([" ws_a ", "", "ws_b"]);
    expect(JSON.parse(window.localStorage.getItem(WORKSPACE_ORDER_KEY) ?? "[]")).toEqual(["ws_a", "ws_b"]);

    writeWorkspaceOrderIds(["  "]);
    expect(window.localStorage.getItem(WORKSPACE_ORDER_KEY)).toBeNull();
  });

  test("persists and removes last session ids by workspace", () => {
    writeLastSessionFor(" ws_a ", " ses_1 ");
    writeLastSessionFor("ws_b", "ses_2");
    expect(readLastSessionFor("ws_a")).toBe("ses_1");
    expect(readLastSessionFor(" ws_b ")).toBe("ses_2");

    writeLastSessionFor("ws_a", null);
    expect(readLastSessionFor("ws_a")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SESSION_BY_WORKSPACE_KEY) ?? "{}"))
      .toEqual({ ws_b: "ses_2" });
  });

  test("ignores malformed last-session maps", () => {
    window.localStorage.setItem(SESSION_BY_WORKSPACE_KEY, JSON.stringify(["not", "a", "map"]));
    expect(readLastSessionFor("ws_a")).toBeNull();

    window.localStorage.setItem(SESSION_BY_WORKSPACE_KEY, JSON.stringify({ ws_a: "ses_1", ws_b: 42 }));
    expect(readLastSessionFor("ws_a")).toBe("ses_1");
    expect(readLastSessionFor("ws_b")).toBeNull();
  });

  test("persists only valid session access modes", () => {
    writeSessionAccessModes({ ses_default: "default", ses_full: "full", " ": "full" });

    expect(readSessionAccessModes()).toEqual({
      ses_default: "default",
      ses_full: "full",
    });

    window.localStorage.setItem(
      ACCESS_MODE_BY_SESSION_KEY,
      JSON.stringify({ ses_default: "default", ses_invalid: "unsafe" }),
    );
    expect(readSessionAccessModes()).toEqual({ ses_default: "default" });

    writeSessionAccessModes({});
    expect(window.localStorage.getItem(ACCESS_MODE_BY_SESSION_KEY)).toBeNull();
  });

  test("persists only valid session collaboration modes", () => {
    writeSessionCollaborationModes({
      ses_ask: { kind: "ask", planning: false, pursueGoal: false },
      ses_plan: { kind: "plan", planning: true, pursueGoal: false },
    });

    expect(readSessionCollaborationModes()).toEqual({
      ses_ask: { kind: "ask", planning: false, pursueGoal: false },
      ses_plan: { kind: "plan", planning: true, pursueGoal: false },
    });

    window.localStorage.setItem(
      COLLABORATION_MODE_BY_SESSION_KEY,
      JSON.stringify({
        ses_valid: { kind: "craft", planning: false, pursueGoal: true },
        ses_invalid: { kind: "other", planning: false, pursueGoal: false },
      }),
    );
    expect(readSessionCollaborationModes()).toEqual({
      ses_valid: { kind: "craft", planning: false, pursueGoal: true },
    });
  });

  test("persists goal runtimes with checkpoints, logs, and cached todos by session", () => {
    writeSessionGoalRuntimes({
      ses_a: {
        source: "goal_intent",
        status: "waiting",
        waitingReason: "permission",
        objective: "Create a long-running project manager demo",
        summary: "项目管理工具 Demo 搭建",
        messageBaseline: 3,
        lastRunMessageBaseline: 5,
        startedAt: 100,
        updatedAt: 400,
        totalPausedMs: 20,
        lastRunStartedAt: 300,
        currentCheckpoint: "浏览器自测",
        completionCriteria: ["功能可用", "自测通过"],
        validationCommands: ["pnpm test:ui"],
        progressLog: ["已创建脚手架", "已完成基础样式"],
        lastKnownTodos: [
          {
            id: "todo-1",
            content: "完成权限审批验证",
            status: "in_progress",
            priority: "medium",
          },
        ],
      },
      ses_b: {
        source: "goal_intent",
        status: "completed",
        objective: "Finished goal",
        messageBaseline: 1,
        startedAt: 10,
        updatedAt: 20,
        completedAt: 30,
        totalPausedMs: 0,
      },
      " ": {
        status: "running",
        objective: "ignored",
        messageBaseline: 0,
        startedAt: 1,
        updatedAt: 1,
        totalPausedMs: 0,
      },
      ses_empty: {
        status: "running",
        objective: "   ",
        messageBaseline: 0,
        startedAt: 1,
        updatedAt: 1,
        totalPausedMs: 0,
      },
    });

    expect(readSessionGoalRuntimes()).toEqual({
      ses_a: {
        source: "goal_intent",
        status: "waiting",
        waitingReason: "permission",
        objective: "Create a long-running project manager demo",
        summary: "项目管理工具 Demo 搭建",
        messageBaseline: 3,
        lastRunMessageBaseline: 5,
        startedAt: 100,
        updatedAt: 400,
        totalPausedMs: 20,
        lastRunStartedAt: 300,
        currentCheckpoint: "浏览器自测",
        completionCriteria: ["功能可用", "自测通过"],
        validationCommands: ["pnpm test:ui"],
        progressLog: ["已创建脚手架", "已完成基础样式"],
        lastKnownTodos: [
          {
            id: "todo-1",
            content: "完成权限审批验证",
            status: "in_progress",
            priority: "medium",
          },
        ],
      },
      ses_b: {
        source: "goal_intent",
        status: "completed",
        objective: "Finished goal",
        messageBaseline: 1,
        startedAt: 10,
        updatedAt: 20,
        completedAt: 30,
        totalPausedMs: 0,
      },
    });

    writeSessionGoalRuntimes({});
    expect(window.localStorage.getItem(GOAL_RUNTIME_BY_SESSION_KEY)).toBeNull();
  });

  test("ignores legacy inferred goal runtimes without an explicit source", () => {
    window.localStorage.setItem(
      GOAL_RUNTIME_BY_SESSION_KEY,
      JSON.stringify({
        ses_legacy: {
          status: "waiting",
          objective: "This was inferred from a historical user message",
          messageBaseline: 0,
          startedAt: 10,
          updatedAt: 20,
          totalPausedMs: 0,
        },
      ses_goal: {
        source: "goal_intent",
        status: "waiting",
        objective: "Real goal",
        summary:
          "You 项目要求：1. 新建文件夹 long-goal-project-manager-demo，不要改动当前工作区已有业务代码。",
        messageBaseline: 0,
        startedAt: 10,
        updatedAt: 20,
        totalPausedMs: 0,
        },
      }),
    );

    expect(readSessionGoalRuntimes()).toMatchObject({
      ses_goal: {
        summary:
          "新建文件夹 long-goal-project-manager-demo，不要改动当前工作区已有业务代码",
      },
    });
  });

  test("forgets active workspace, last-session entry, and workspace order", () => {
    writeActiveWorkspaceId("ws_a");
    writeWorkspaceOrderIds(["ws_a", "ws_b"]);
    writeLastSessionFor("ws_a", "ses_a");
    writeLastSessionFor("ws_b", "ses_b");

    forgetWorkspaceMemory(" ws_a ");

    expect(readActiveWorkspaceId()).toBeNull();
    expect(readWorkspaceOrderIds()).toEqual(["ws_b"]);
    expect(readLastSessionFor("ws_a")).toBeNull();
    expect(readLastSessionFor("ws_b")).toBe("ses_b");
  });
});
