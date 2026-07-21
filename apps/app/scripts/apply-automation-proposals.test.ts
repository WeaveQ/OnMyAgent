import { describe, expect, test } from "bun:test";

import {
  applyAutomationProposals,
  automationProposalSearchRoots,
  isAutomationCreateConfirmText,
  knownAutomationProposalPaths,
  parseAutomationProposalPayload,
  type AutomationProposalClient,
} from "../src/react-app/domains/session/artifacts/apply-automation-proposals";

describe("isAutomationCreateConfirmText", () => {
  test("accepts confirm phrases and rejects denials", () => {
    expect(isAutomationCreateConfirmText("确认创建")).toBe(true);
    expect(isAutomationCreateConfirmText("好的，确认创建定时任务")).toBe(true);
    expect(isAutomationCreateConfirmText("confirm create automations")).toBe(true);
    expect(isAutomationCreateConfirmText("先不要创建")).toBe(false);
    expect(isAutomationCreateConfirmText("随便聊聊")).toBe(false);
  });
});

describe("parseAutomationProposalPayload", () => {
  test("accepts expert export proposals", () => {
    const payload = parseAutomationProposalPayload({
      scene: "office",
      title: "应收催收·每日看板",
      prompt: "read ar-ledger.json",
      schedule: {
        mode: "interval",
        day: "daily",
        time: "09:00",
        intervalMinutes: 1440,
        timezone: "Asia/Shanghai",
      },
      enabled: true,
    });
    expect(payload?.title).toBe("应收催收·每日看板");
    expect(payload?.schedule.mode).toBe("interval");
    expect(payload?.schedule.intervalMinutes).toBe(1440);
  });

  test("rejects incomplete payloads", () => {
    expect(parseAutomationProposalPayload({ title: "x" })).toBeNull();
    expect(
      parseAutomationProposalPayload({
        scene: "office",
        title: "t",
        prompt: "p",
        schedule: { mode: "interval", day: "daily" },
      }),
    ).toBeNull();
  });
});

describe("automationProposalSearchRoots", () => {
  test("includes session-isolated proposals dir", () => {
    const roots = automationProposalSearchRoots({
      catalogRoot: "/Users/me/ws",
      sessionRoot: "/Users/me/ws/ar-collector/abc",
    });
    expect(roots[0]).toBe("ar-collector/abc/automations/proposals");
    expect(roots).toContain("automations/proposals");
    expect(knownAutomationProposalPaths(roots).some((p) => p.endsWith("ar-daily-board.json"))).toBe(
      true,
    );
  });
});

describe("applyAutomationProposals", () => {
  test("creates missing proposals and skips existing titles", async () => {
    const created: string[] = [];
    const files: Record<string, string> = {
      "automations/proposals/ar-daily-board.json": JSON.stringify({
        scene: "office",
        title: "应收催收·每日看板",
        prompt: "p1",
        schedule: { mode: "interval", day: "daily", time: "09:00", intervalMinutes: 1440 },
        enabled: true,
      }),
      "automations/proposals/fleet-daily-scan.json": JSON.stringify({
        scene: "office",
        title: "挂靠车管·每日到期扫描",
        prompt: "p2",
        schedule: { mode: "interval", day: "daily", time: "09:00", intervalMinutes: 1440 },
        enabled: true,
      }),
    };

    const client: AutomationProposalClient = {
      listWorkspaceFiles: async () => ({
        items: Object.keys(files).map((path) => ({ path, kind: "file" })),
      }),
      readWorkspaceFile: async (_id, path) => {
        if (!files[path]) throw new Error("missing");
        return { content: files[path] };
      },
      listAutomations: async () => ({
        items: [{ id: "existing", title: "应收催收·每日看板" }],
      }),
      createAutomation: async (_id, payload) => {
        created.push(payload.title);
        return { item: { id: `id-${payload.title}`, title: payload.title, nextRunAt: 1 } };
      },
    };

    const result = await applyAutomationProposals({
      client,
      workspaceId: "ws_1",
      catalogRoot: "/ws",
    });

    expect(result.created.map((item) => item.title)).toEqual(["挂靠车管·每日到期扫描"]);
    expect(result.skipped).toEqual([
      {
        title: "应收催收·每日看板",
        reason: "already_exists",
        path: "automations/proposals/ar-daily-board.json",
      },
    ]);
    expect(created).toEqual(["挂靠车管·每日到期扫描"]);
  });
});
