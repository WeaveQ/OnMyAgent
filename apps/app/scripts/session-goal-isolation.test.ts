import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { CollaborationGoalRuntime } from "../src/app/types";
import {
  applySessionScopedValue,
  moveSessionScopedValue,
} from "../src/react-app/shell/session-route/composer";

function readSource(relativePath: string) {
  return readFileSync(new URL(`../src/react-app/${relativePath}`, import.meta.url), "utf8");
}

const surfaceSource = readSource("domains/session/surface/session-surface.tsx");

function goalRuntime(
  objective: string,
  status: CollaborationGoalRuntime["status"],
  updatedAt: number,
): CollaborationGoalRuntime {
  return {
    source: "goal_intent",
    status,
    objective,
    messageBaseline: 0,
    startedAt: 100,
    updatedAt,
    totalPausedMs: 0,
  };
}

describe("session goal isolation", () => {
  test("remounts the session surface at every session host boundary", () => {
    const hosts = [
      {
        path: "domains/session/chat/session-page.tsx",
        key: "key={pageView.renderedSessionId}",
      },
      {
        path: "domains/session/pages/assistant.tsx",
        key: "key={renderedSessionId}",
      },
      {
        path: "domains/session/pages/expert.tsx",
        key: "key={renderedSessionId}",
      },
    ];

    for (const host of hosts) {
      const hostSource = readSource(host.path);
      const surfaceStart = hostSource.indexOf("<SessionSurface");
      const surfaceEnd = hostSource.indexOf("/>", surfaceStart);
      const surfaceElement = hostSource.slice(surfaceStart, surfaceEnd);

      expect(surfaceElement).toContain(host.key);
    }
  });

  test("continues the goal runtime supplied by the active session", () => {
    const resumeStart = surfaceSource.indexOf("const resumeGoalRuntime");
    const resumeEnd = surfaceSource.indexOf("const stopActiveRun", resumeStart);
    const resumeBlock = surfaceSource.slice(resumeStart, resumeEnd);

    expect(resumeBlock).toContain("isGoalIntentRuntime(props.goalRuntime)");
    expect(resumeBlock).not.toContain("isGoalIntentRuntime(goalRuntimeRef.current)");
  });

  test("records interruption identity from the active goal runtime", () => {
    const recordStart = surfaceSource.indexOf("const recordSessionInterruption");
    const recordEnd = surfaceSource.indexOf("useEffect(() => {", recordStart);
    const recordBlock = surfaceSource.slice(recordStart, recordEnd);

    expect(recordBlock).toContain("goalRuntime?.lastRunStartedAt");
    expect(recordBlock).not.toContain("goalRuntimeRef.current?.lastRunStartedAt");
  });

  test("start, pause, continue, and delete preserve the other session runtime", () => {
    const sessionB = goalRuntime("Goal B", "running", 200);
    const draftA = goalRuntime("Goal A", "waiting", 100);
    const startedA = goalRuntime("Goal A", "running", 300);
    const pausedA = goalRuntime("Goal A", "paused", 400);
    const continuedA = goalRuntime("Goal A", "running", 500);

    const started = moveSessionScopedValue(
      { "draft:ws_1": draftA, ses_b: sessionB },
      "draft:ws_1",
      "ses_a",
      startedA,
    );
    expect(started).toEqual({ ses_a: startedA, ses_b: sessionB });

    const paused = applySessionScopedValue(started, "ses_a", pausedA);
    expect(paused).toEqual({ ses_a: pausedA, ses_b: sessionB });

    const continued = applySessionScopedValue(paused, "ses_a", continuedA);
    expect(continued).toEqual({ ses_a: continuedA, ses_b: sessionB });

    const deleted = applySessionScopedValue(continued, "ses_a", null);
    expect(deleted).toEqual({ ses_b: sessionB });
  });
});
