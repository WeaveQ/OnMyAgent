import { describe, expect, test } from "bun:test";
import { ApprovalService } from "../src/services/approvals.js";
import { GrokPermissionBridge } from "../src/services/grok-permission-bridge.js";
import { PrimaryRuntimeEventBus } from "../src/services/primary-runtime-events.js";

const workspace = { id: "workspace", path: "/workspace" };

describe("GrokPermissionBridge", () => {
  test("forces visible approval even when the server is configured auto", async () => {
    const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1_000 });
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    const seen: unknown[] = [];
    events.subscribe("product", (event) => seen.push(event));
    const bridge = new GrokPermissionBridge(approvals, events);
    bridge.bindSession("native", "product", workspace);
    const pending = bridge.handle("session/request_permission", {
      sessionId: "native",
      title: "Write fixture",
      cwd: "/workspace/child",
      options: [
        { optionId: "allow", kind: "allow_once" },
        { optionId: "deny", kind: "reject_once" },
      ],
    });
    await Bun.sleep(0);
    expect(approvals.list()).toHaveLength(1);
    const approval = approvals.list()[0]!;
    const approvalId = approval.id;
    expect(approval).toMatchObject({
      id: approvalId,
      workspaceId: "workspace",
      action: "grok_runtime_permission",
      paths: ["/workspace/child"],
    });
    expect(approvalId).toBeString();
    const approvalResponse = approvals.respond(approvalId, "allow");
    expect(approvalResponse).toMatchObject({
      id: approvalId,
      allowed: true,
    });
    await expect(pending).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      kind: "permission.requested",
      productSessionId: "product",
      permission: {
        permissionId: approvalId,
        productSessionId: "product",
        title: "Write fixture",
        options: [
          { optionId: "allow", kind: "allow_once" },
          { optionId: "deny", kind: "reject_once" },
        ],
      },
    });
    expect(seen[1]).toMatchObject({
      kind: "permission.resolved",
      decision: { outcome: "selected", optionId: "allow" },
    });
  });

  test("cancels unknown sessions and pending requests on shutdown", async () => {
    const approvals = new ApprovalService({ mode: "manual", timeoutMs: 1_000 });
    const bridge = new GrokPermissionBridge(approvals);
    await expect(bridge.handle("session/request_permission", {
      sessionId: "unknown",
      options: [{ optionId: "allow", kind: "allow_once" }],
    })).resolves.toEqual({ outcome: { outcome: "cancelled" } });
    bridge.bindSession("native", "product", workspace);
    const pending = bridge.handle("session/request_permission", {
      sessionId: "native",
      options: [{ optionId: "allow", kind: "allow_once" }],
    });
    await Bun.sleep(0);
    approvals.cancelAll();
    await expect(pending).resolves.toEqual({ outcome: { outcome: "cancelled" } });
  });

  test("fails closed without creating an approval when native options are empty", async () => {
    const approvals = new ApprovalService({ mode: "manual", timeoutMs: 1_000 });
    const bridge = new GrokPermissionBridge(approvals);
    bridge.bindSession("native", "product", workspace);
    await expect(bridge.handle("session/request_permission", {
      sessionId: "native",
      options: [],
    })).resolves.toEqual({ outcome: { outcome: "cancelled" } });
    expect(approvals.list()).toEqual([]);
  });

  test("bridges native ask-user questions into canonical events and exact responses", async () => {
    const approvals = new ApprovalService({ mode: "manual", timeoutMs: 1_000 });
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    const seen: unknown[] = [];
    events.subscribe("product", (event) => seen.push(event));
    const bridge = new GrokPermissionBridge(approvals, events);
    bridge.bindSession("native", "product", workspace);
    const pending = bridge.handle("x.ai/ask_user_question", {
      sessionId: "native",
      toolCallId: "question-1",
      questions: [
        {
          id: "scope",
          question: "Which scope?",
          options: [
            { id: "local", label: "Local", description: "This workspace" },
            { id: "global", label: "Global" },
          ],
          multiSelect: true,
          custom: true,
        },
        {
          id: "confirm",
          question: "Continue?",
          options: [{ id: "yes", label: "Yes" }],
          custom: false,
        },
      ],
    });
    await Bun.sleep(0);
    expect(seen[0]).toMatchObject({
      kind: "question.requested",
      question: {
        questionId: "question-1",
        productSessionId: "product",
        items: [
          {
            key: "scope",
            prompt: "Which scope?",
            multiple: true,
            allowFreeText: true,
          },
          {
            key: "confirm",
            prompt: "Continue?",
            multiple: false,
            allowFreeText: false,
          },
        ],
      },
    });
    bridge.respondQuestion({
      productSessionId: "product",
      questionId: "question-1",
      answers: [["Local", "custom note"], ["Yes"]],
    });
    await expect(pending).resolves.toEqual({
      outcome: "accepted",
      answers: {
        "Which scope?": ["Local", "Other"],
        "Continue?": ["Yes"],
      },
      annotations: { "Which scope?": { notes: "custom note" } },
    });
    expect(seen[1]).toMatchObject({
      kind: "question.resolved",
      answer: {
        questionId: "question-1",
        selectedOptionIds: ["Local", "custom note", "Yes"],
      },
    });
  });

  test("dismisses, unbinds, and replaces pending questions without hanging ACP", async () => {
    const approvals = new ApprovalService({ mode: "manual", timeoutMs: 1_000 });
    const bridge = new GrokPermissionBridge(approvals);
    bridge.bindSession("native", "product", workspace);
    const params = {
      sessionId: "native",
      toolCallId: "same-id",
      questions: [{ question: "Continue?", options: [{ label: "Yes" }] }],
    };
    const first = bridge.handle("x.ai/ask_user_question", params);
    const replacement = bridge.handle("_x.ai/ask_user_question", { params });
    await expect(first).resolves.toEqual({ outcome: "cancelled" });
    bridge.respondQuestion({
      productSessionId: "product",
      questionId: "same-id",
      answers: [[]],
    });
    await expect(replacement).resolves.toEqual({ outcome: "cancelled" });

    const unbound = bridge.handle("x.ai/ask_user_question", {
      ...params,
      toolCallId: "unbind-id",
    });
    bridge.unbindSession("native");
    await expect(unbound).resolves.toEqual({ outcome: "cancelled" });
    expect(() => bridge.respondQuestion({
      productSessionId: "product",
      questionId: "unbind-id",
      answers: [["Yes"]],
    })).toThrow(expect.objectContaining({ code: "agent_runtime_question_not_found" }));
  });

  test("rejects invalid question answers and preserves the pending request", async () => {
    const approvals = new ApprovalService({ mode: "manual", timeoutMs: 1_000 });
    const bridge = new GrokPermissionBridge(approvals);
    bridge.bindSession("native", "product", workspace);
    const pending = bridge.handle("x.ai/ask_user_question", {
      sessionId: "native",
      toolCallId: "strict-id",
      questions: [{
        question: "Continue?",
        options: [{ label: "Yes" }],
        custom: false,
      }],
    });
    expect(() => bridge.respondQuestion({
      productSessionId: "product",
      questionId: "strict-id",
      answers: [["No"]],
    })).toThrow(expect.objectContaining({ code: "agent_runtime_question_answer_invalid" }));
    bridge.respondQuestion({
      productSessionId: "product",
      questionId: "strict-id",
      answers: [["Yes"]],
    });
    await expect(pending).resolves.toMatchObject({
      outcome: "accepted",
      answers: { "Continue?": ["Yes"] },
    });
  });
});
