import { describe, expect, test, beforeEach } from "bun:test";

import {
  clearPendingQuickCapture,
  enqueuePendingQuickCapture,
  isSessionRoutePath,
  peekPendingQuickCapture,
  resolveQuickCaptureAssistantRoute,
  subscribePendingQuickCapture,
  takePendingQuickCapture,
} from "../src/react-app/shell/quick-capture-pending";

describe("quick-capture pending queue", () => {
  beforeEach(() => {
    clearPendingQuickCapture();
  });

  test("enqueue ignores empty text", () => {
    expect(enqueuePendingQuickCapture({ text: "  " })).toBeNull();
    expect(peekPendingQuickCapture()).toBeNull();
  });

  test("enqueue then take is atomic", () => {
    enqueuePendingQuickCapture({
      text: "hello",
      model: { providerID: "openai", modelID: "gpt-4.1" },
    });
    const first = takePendingQuickCapture();
    expect(first?.text).toBe("hello");
    expect(first?.model).toEqual({
      providerID: "openai",
      modelID: "gpt-4.1",
    });
    expect(takePendingQuickCapture()).toBeNull();
  });

  test("latest enqueue wins", () => {
    enqueuePendingQuickCapture({ text: "one" });
    enqueuePendingQuickCapture({ text: "two" });
    expect(takePendingQuickCapture()?.text).toBe("two");
  });

  test("subscribe notifies on enqueue and take", () => {
    let count = 0;
    const unsub = subscribePendingQuickCapture(() => {
      count += 1;
    });
    enqueuePendingQuickCapture({ text: "ping" });
    expect(count).toBe(1);
    takePendingQuickCapture();
    expect(count).toBe(2);
    unsub();
    enqueuePendingQuickCapture({ text: "later" });
    expect(count).toBe(2);
    clearPendingQuickCapture();
  });
});

describe("quick-capture route helpers", () => {
  test("isSessionRoutePath covers assistant/session workspace routes", () => {
    expect(isSessionRoutePath("/assistant")).toBe(true);
    expect(isSessionRoutePath("/assistant/ses_1")).toBe(true);
    expect(isSessionRoutePath("/session")).toBe(true);
    expect(isSessionRoutePath("/workspace/ws1/assistant")).toBe(true);
    expect(isSessionRoutePath("/workspace/ws1/assistant/ses_1")).toBe(true);
    expect(isSessionRoutePath("/workspace/ws1/session")).toBe(true);
    expect(isSessionRoutePath("/settings/system")).toBe(false);
    expect(isSessionRoutePath("/workspace/ws1/settings/general")).toBe(false);
    expect(isSessionRoutePath("/welcome")).toBe(false);
  });

  test("resolveQuickCaptureAssistantRoute prefers workspace path", () => {
    expect(resolveQuickCaptureAssistantRoute(null)).toBe("/assistant");
    expect(resolveQuickCaptureAssistantRoute("  ")).toBe("/assistant");
    expect(resolveQuickCaptureAssistantRoute("ws/1")).toBe(
      "/workspace/ws%2F1/assistant",
    );
  });
});
