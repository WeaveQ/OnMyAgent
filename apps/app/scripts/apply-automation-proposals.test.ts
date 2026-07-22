import { describe, expect, test } from "bun:test";

import {
  applyAutomationProposals,
  automationProposalSearchRoots,
  automationProposalsFingerprint,
  buildAutomationPayloadFromDraft,
  createAutomationsFromPayloads,
  isAutomationCreateConfirmText,
  knownAutomationProposalPaths,
  parseAutomationProposalPayload,
  type AutomationProposalClient,
} from "../src/react-app/domains/session/artifacts/apply-automation-proposals";
import {
  applyAutomationOfferAnswer,
  buildAutomationOfferQuestion,
  listMissingRequiredFields,
  startAutomationOfferFlow,
  type AutomationOfferLabels,
} from "../src/react-app/domains/session/artifacts/expert-automation-offer-flow";

describe("isAutomationCreateConfirmText", () => {
  test("still recognizes legacy confirm phrases", () => {
    expect(isAutomationCreateConfirmText("确认创建")).toBe(true);
    expect(isAutomationCreateConfirmText("confirm create automations")).toBe(true);
    expect(isAutomationCreateConfirmText("先不要创建")).toBe(false);
  });
});

describe("buildAutomationPayloadFromDraft", () => {
  test("requires HH:mm and non-empty title/prompt", () => {
    const base = parseAutomationProposalPayload({
      scene: "office",
      title: "t",
      prompt: "p",
      schedule: { mode: "interval", day: "daily", time: "09:00", intervalMinutes: 1440 },
      enabled: true,
    });
    expect(base).not.toBeNull();
    if (!base) return;
    expect(
      buildAutomationPayloadFromDraft({
        base,
        title: " 每日看板 ",
        prompt: "run",
        time: "18:30",
        enabled: true,
      })?.schedule.time,
    ).toBe("18:30");
    expect(
      buildAutomationPayloadFromDraft({
        base,
        title: "",
        prompt: "run",
        time: "18:30",
        enabled: true,
      }),
    ).toBeNull();
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

  test("can omit workspace-global proposals for session-scoped offers", () => {
    const roots = automationProposalSearchRoots({
      catalogRoot: "/Users/me/ws",
      sessionRoot: "/Users/me/ws/ar-collector/abc",
      includeWorkspaceRoot: false,
    });
    expect(roots).toEqual(["ar-collector/abc/automations/proposals"]);
    expect(
      automationProposalSearchRoots({
        catalogRoot: "/Users/me/ws",
        includeWorkspaceRoot: false,
      }),
    ).toEqual([]);
  });
});

const flowLabels: AutomationOfferLabels = {
  offerHeader: "offer",
  offerQuestion: (count, titles) => `${count}:${titles}`,
  optAutoCreate: "auto",
  optAutoCreateDesc: "auto-d",
  optSkip: "skip",
  optSkipDesc: "skip-d",
  requiredHeader: "req",
  requiredTitleQuestion: (task) => `title:${task}`,
  requiredPromptQuestion: (task) => `prompt:${task}`,
  requiredTimeQuestion: (task) => `time:${task}`,
  optionalHeader: "opt",
  optionalQuestion: "need-opt?",
  optOptionalYes: "yes-opt",
  optOptionalYesDesc: "yes-d",
  optOptionalNo: "no-opt",
  optOptionalNoDesc: "no-d",
  optionalTimezoneQuestion: "tz?",
  confirmHeader: "confirm",
  confirmQuestion: (count, summary) => `${count}:${summary}`,
  optConfirm: "create",
  optConfirmDesc: "create-d",
  optCancel: "cancel",
  optCancelDesc: "cancel-d",
  customAnswerLabel: "custom",
};

describe("expert automation offer flow", () => {
  test("auto-create with complete payload goes to optional then confirm", () => {
    const payload = parseAutomationProposalPayload({
      scene: "office",
      title: "T",
      prompt: "P",
      schedule: { mode: "interval", day: "daily", time: "09:00", intervalMinutes: 1440 },
    });
    expect(payload).not.toBeNull();
    if (!payload) return;
    expect(listMissingRequiredFields(payload)).toEqual([]);
    let state = startAutomationOfferFlow({
      proposals: [{ path: "p.json", payload }],
      fingerprint: "fp",
    });
    expect(buildAutomationOfferQuestion(state, flowLabels)?.options[0]?.label).toBe("auto");
    let decided = applyAutomationOfferAnswer({
      state,
      answers: [["auto"]],
      labels: flowLabels,
    });
    expect(decided.kind).toBe("state");
    if (decided.kind !== "state") return;
    state = decided.state;
    expect(state.phase).toBe("ask_optional");
    decided = applyAutomationOfferAnswer({
      state,
      answers: [["no-opt"]],
      labels: flowLabels,
    });
    expect(decided.kind).toBe("state");
    if (decided.kind !== "state") return;
    state = decided.state;
    expect(state.phase).toBe("confirm");
    decided = applyAutomationOfferAnswer({
      state,
      answers: [["create"]],
      labels: flowLabels,
    });
    expect(decided.kind).toBe("create");
  });

  test("missing required fields are collected before confirm", () => {
    const payload = parseAutomationProposalPayload({
      scene: "office",
      title: "T",
      prompt: "P",
      schedule: { mode: "interval", day: "daily", time: "09:00", intervalMinutes: 1440 },
    });
    expect(payload).not.toBeNull();
    if (!payload) return;
    payload.title = "";
    let state = startAutomationOfferFlow({
      proposals: [{ path: "p.json", payload }],
      fingerprint: "fp",
    });
    let decided = applyAutomationOfferAnswer({
      state,
      answers: [["auto"]],
      labels: flowLabels,
    });
    expect(decided.kind).toBe("state");
    if (decided.kind !== "state") return;
    state = decided.state;
    expect(state.phase).toBe("collect_required");
    decided = applyAutomationOfferAnswer({
      state,
      answers: [["New Title"]],
      labels: flowLabels,
    });
    expect(decided.kind).toBe("state");
    if (decided.kind !== "state") return;
    state = decided.state;
    expect(state.phase).toBe("ask_optional");
    expect(state.drafts[0]?.payload.title).toBe("New Title");
  });
});

describe("automationProposalsFingerprint", () => {
  test("stable across order of same proposals", () => {
    const a = {
      path: "b.json",
      payload: parseAutomationProposalPayload({
        scene: "office",
        title: "B",
        prompt: "p",
        schedule: { mode: "interval", day: "daily", time: "10:00", intervalMinutes: 1440 },
      })!,
    };
    const b = {
      path: "a.json",
      payload: parseAutomationProposalPayload({
        scene: "office",
        title: "A",
        prompt: "p",
        schedule: { mode: "interval", day: "daily", time: "09:00", intervalMinutes: 1440 },
      })!,
    };
    expect(automationProposalsFingerprint([a, b])).toBe(
      automationProposalsFingerprint([b, a]),
    );
  });
});

describe("createAutomationsFromPayloads", () => {
  test("creates selected payloads only", async () => {
    const created: string[] = [];
    const client: Pick<
      AutomationProposalClient,
      "listAutomations" | "createAutomation"
    > = {
      listAutomations: async () => ({ items: [] }),
      createAutomation: async (_id, payload) => {
        created.push(payload.title);
        return { item: { id: "1", title: payload.title } };
      },
    };
    const payload = parseAutomationProposalPayload({
      scene: "office",
      title: "T1",
      prompt: "run",
      schedule: { mode: "interval", day: "daily", time: "09:00", intervalMinutes: 1440 },
    });
    expect(payload).not.toBeNull();
    if (!payload) return;
    const result = await createAutomationsFromPayloads({
      client,
      workspaceId: "ws",
      items: [{ path: "p.json", payload }],
    });
    expect(result.created).toHaveLength(1);
    expect(created).toEqual(["T1"]);
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
