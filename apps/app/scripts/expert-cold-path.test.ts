import { describe, expect, test, beforeEach } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  buildExpertColdPrewarmKey,
  claimOrCreateExpertColdSession,
  enqueueExpertColdPath,
  getExpertColdPrewarmDebugSnapshot,
  getOrStartExpertColdSession,
  resetExpertColdPathForTests,
  skillNamesFingerprint,
  startExpertColdPrewarm,
} from "../src/react-app/domains/session/sync/expert-cold-path";
import { scheduleIdleExpertColdPrewarmTask } from "../src/react-app/shell/session-route/prewarm-schedule";

describe("expert cold path queue + prewarm", () => {
  beforeEach(() => {
    resetExpertColdPathForTests();
  });

  test("skillNamesFingerprint is order-insensitive", () => {
    expect(skillNamesFingerprint(["b", "a"])).toBe(
      skillNamesFingerprint(["a", "b"]),
    );
    expect(skillNamesFingerprint([])).toBe("");
  });

  test("enqueueExpertColdPath runs tasks serially", async () => {
    const order: number[] = [];
    const slow = enqueueExpertColdPath(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
      return "a";
    });
    const fast = enqueueExpertColdPath(async () => {
      order.push(3);
      return "b";
    });
    const [a, b] = await Promise.all([slow, fast]);
    expect(a).toBe("a");
    expect(b).toBe("b");
    expect(order).toEqual([1, 2, 3]);
  });

  test("prewarm + claim reuses one create", async () => {
    let creates = 0;
    const runner = {
      createIsolatedDirectory: async () => {
        creates += 1;
        return { directory: `/tmp/expert-${creates}` };
      },
      createSession: async (directory: string) => {
        return { id: `ses_${directory.split("-").pop()}` };
      },
    };
    const request = {
      workspaceId: "ws1",
      agentId: "agent-a",
      agentName: "A",
      skillNames: ["s1"],
    };
    startExpertColdPrewarm(request, runner);
    // Let prewarm start
    await new Promise((r) => setTimeout(r, 0));
    const claimed = await claimOrCreateExpertColdSession(request, runner);
    expect(creates).toBe(1);
    expect(claimed.sessionId).toBe("ses_1");
    expect(claimed.directory).toBe("/tmp/expert-1");
    expect(getExpertColdPrewarmDebugSnapshot()).toEqual([]);
  });

  test("second claim after first creates a new session", async () => {
    let creates = 0;
    const runner = {
      createIsolatedDirectory: async () => {
        creates += 1;
        return { directory: `/tmp/expert-${creates}` };
      },
      createSession: async () => ({ id: `ses_${creates}` }),
    };
    const request = {
      workspaceId: "ws1",
      agentId: "agent-a",
      agentName: "A",
    };
    const first = await claimOrCreateExpertColdSession(request, runner);
    const second = await claimOrCreateExpertColdSession(request, runner);
    expect(creates).toBe(2);
    expect(first.sessionId).toBe("ses_1");
    expect(second.sessionId).toBe("ses_2");
  });

  test("concurrent claims for two agents serialize create work", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runnerFor = (label: string) => ({
      createIsolatedDirectory: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return { directory: `/tmp/${label}` };
      },
      createSession: async (directory: string) => ({
        id: `ses_${directory.split("/").pop()}`,
      }),
    });
    const [a, b] = await Promise.all([
      claimOrCreateExpertColdSession(
        { workspaceId: "ws", agentId: "a", agentName: "A" },
        runnerFor("a"),
      ),
      claimOrCreateExpertColdSession(
        { workspaceId: "ws", agentId: "b", agentName: "B" },
        runnerFor("b"),
      ),
    ]);
    expect(maxInFlight).toBe(1);
    expect(a.sessionId).toBe("ses_a");
    expect(b.sessionId).toBe("ses_b");
  });

  test("getOrStart reuses in-flight promise without consuming", async () => {
    let creates = 0;
    const runner = {
      createIsolatedDirectory: async () => {
        creates += 1;
        await new Promise((r) => setTimeout(r, 15));
        return { directory: "/tmp/shared" };
      },
      createSession: async () => ({ id: "ses_shared" }),
    };
    const request = {
      workspaceId: "ws",
      agentId: "x",
      agentName: "X",
    };
    const p1 = getOrStartExpertColdSession(request, runner);
    const p2 = getOrStartExpertColdSession(request, runner);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(creates).toBe(1);
    expect(r1.sessionId).toBe(r2.sessionId);
    expect(getExpertColdPrewarmDebugSnapshot()[0]?.phase).toBe("ready");
  });

  test("canonical package and approved-agent metadata invalidate stale prewarm", async () => {
    let creates = 0;
    const runner = {
      createIsolatedDirectory: async () => ({ directory: `/tmp/meta-${++creates}` }),
      createSession: async () => ({ id: `ses_${creates}` }),
    };
    await getOrStartExpertColdSession({
      workspaceId: "ws",
      agentId: "expert",
      agentName: "Expert",
      packageName: "package-a",
      approvedAgentIds: ["agent-a"],
      skillNames: ["skill-a"],
    }, runner);
    await getOrStartExpertColdSession({
      workspaceId: "ws",
      agentId: "expert",
      agentName: "Expert",
      packageName: "package-b",
      approvedAgentIds: ["agent-b"],
      skillNames: ["skill-a"],
    }, runner);
    expect(creates).toBe(2);
  });

  test("buildExpertColdPrewarmKey trims ids", () => {
    expect(buildExpertColdPrewarmKey(" ws ", " ag ")).toBe("ws\0ag");
  });
});

describe("expert cold path wiring contracts", () => {
  test("home first send does not enter the expert cold-path isolate", async () => {
    const source = await readFile(
      new URL(
        "../src/react-app/shell/session-route/surface-props-hook-impl.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("if (pageMode === \"expert\" && sendPlan.needsNewSession)");
    expect(source).not.toContain("pageMode === \"expert\" || pageMode === \"assistant\"");
    expect(source).not.toContain('agentName: "assistant"');
  });

  test("home send clears leftover pending expert before first prompt", async () => {
    const source = await readFile(
      new URL(
        "../src/react-app/domains/session/pages/assistant.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const send = source.indexOf("async (draft: ComposerDraft)");
    const clear = source.indexOf("usePendingAgentStore.getState().setAgent(null)", send);
    const ifNoSession = source.indexOf("if (!props.selectedSessionId", send);
    expect(send).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(send);
    expect(ifNoSession === -1 || clear < ifNoSession).toBe(true);
  });

  test("send path claims expert cold session for isolated first send", async () => {
    const source = await readFile(
      new URL(
        "../src/react-app/shell/session-route/surface-props-hook-impl.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("claimOrCreateExpertColdSession(");
    expect(source).toContain("expertColdClaim");
    expect(source).toContain("pendingForColdPath?.skillIds ?? []");
    expect(source).toContain("approvedAgentIds");
    expect(source).not.toContain("parseSkillNamesFromAgentMarkdown");
  });

  test("draft activation starts expert cold prewarm", async () => {
    const source = await readFile(
      new URL(
        "../src/react-app/domains/session/pages/use-expert-page-navigation.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("startExpertColdPrewarm(");
    expect(source).toContain("createIsolatedExpertSessionRuntimeDirectory");
    // Must use registry workspace path + endpoint workspace id (not session root).
    expect(source).toContain("workspaceFilesRoot");
    expect(source).toContain("runtimeWorkspaceId");
  });

  test("surface props also prewarms with send-path workspace id", async () => {
    const source = await readFile(
      new URL(
        "../src/react-app/shell/session-route/surface-props-hook-impl.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("startExpertColdPrewarm(");
    expect(source).toContain(
      "selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspaceId",
    );
  });

  test("empty expert shell opens idle draft without awaiting session.create", async () => {
    const pageView = await readFile(
      new URL(
        "../src/react-app/shell/session-route/page-view.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const intent = await readFile(
      new URL(
        "../src/react-app/shell/session-route/intent.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(pageView).toContain("openExpertFreshIdleDraft(");
    expect(pageView).toContain("scheduleIdleExpertColdPrewarm(");
    expect(pageView).not.toContain("await claimOrCreateExpertColdSession(");
    expect(pageView).not.toContain("await opencodeClient.session.create");
    const prewarmStart = intent.indexOf(
      "export function scheduleIdleExpertColdPrewarm",
    );
    expect(prewarmStart).toBeGreaterThan(0);
    const prewarmBody = intent.slice(prewarmStart);
    const idleIdx = prewarmBody.indexOf("scheduleIdleExpertColdPrewarmTask(");
    const createIdx = prewarmBody.indexOf("startExpertColdPrewarm(");
    expect(idleIdx).toBeGreaterThan(0);
    expect(createIdx).toBeGreaterThan(idleIdx);
  });

  test("idle expert prewarm starts only from the idle callback", () => {
    let started = 0;
    let run: () => void = () => undefined;
    scheduleIdleExpertColdPrewarmTask({
      agentId: "agent-a",
      getCurrentAgentId: () => "agent-a",
      startPrewarm: () => {
        started += 1;
      },
      host: {
        requestIdleCallback: (cb) => {
          run = cb;
          return 1;
        },
        cancelIdleCallback: () => undefined,
        setTimeout: () => {
          throw new Error("idle API should be used");
        },
        clearTimeout: () => undefined,
      },
    });
    expect(started).toBe(0);
    run();
    expect(started).toBe(1);
  });

  test("idle expert prewarm skips start if pending agent changed", () => {
    let started = 0;
    let run: () => void = () => undefined;
    scheduleIdleExpertColdPrewarmTask({
      agentId: "agent-a",
      getCurrentAgentId: () => "agent-b",
      startPrewarm: () => {
        started += 1;
      },
      host: {
        requestIdleCallback: (cb) => {
          run = cb;
          return 1;
        },
        cancelIdleCallback: () => undefined,
        setTimeout: () => {
          throw new Error("idle API should be used");
        },
        clearTimeout: () => undefined,
      },
    });
    run();
    expect(started).toBe(0);
  });
});
