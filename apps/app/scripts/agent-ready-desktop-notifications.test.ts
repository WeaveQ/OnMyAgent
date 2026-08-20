import { describe, expect, test } from "bun:test";

import {
  buildAgentReadyNotificationBody,
  resolveAgentReadyTaskSnippet,
  shouldNotifyAgentReadyTransition,
} from "../src/react-app/domains/shell-feedback";

describe("agent ready desktop notifications", () => {
  test("only notifies when leaving a busy state for idle", () => {
    expect(shouldNotifyAgentReadyTransition("responding", "idle")).toBe(true);
    expect(shouldNotifyAgentReadyTransition("thinking", "idle")).toBe(true);
    expect(shouldNotifyAgentReadyTransition("idle", "idle")).toBe(false);
    expect(shouldNotifyAgentReadyTransition(undefined, "idle")).toBe(false);
    expect(shouldNotifyAgentReadyTransition("responding", "thinking")).toBe(
      false,
    );
  });

  test("prefers truncated user prompt over session id", () => {
    expect(resolveAgentReadyTaskSnippet({ userSnippet: "核对六月运输账单", sessionTitle: "ses_fe354fa3" })).toBe(
      "核对六月运输账单",
    );
    expect(
      resolveAgentReadyTaskSnippet({
        userSnippet: null,
        sessionTitle: "ses_fe354fa3",
      }),
    ).toBe("");
    const longSnippet = resolveAgentReadyTaskSnippet({
      userSnippet: "这是一段很长的用户发起文案需要被缩略成更短的通知标题内容再加几个字",
      sessionTitle: null,
    });
    expect(longSnippet.endsWith("…")).toBe(true);
    expect(longSnippet.length).toBeLessThanOrEqual(29);
    expect(
      buildAgentReadyNotificationBody({
        sessionTitle: "核对六月运输账单",
        userSnippet: null,
        bodyWithSnippet: (snippet) => `${snippet} 任务完成了`,
        fallbackBody: "任务完成了",
      }),
    ).toBe("核对六月运输账单 任务完成了");
    expect(
      buildAgentReadyNotificationBody({
        sessionTitle: "ses_fe354fa3",
        userSnippet: null,
        bodyWithSnippet: (snippet) => `${snippet} 任务完成了`,
        fallbackBody: "任务完成了",
      }),
    ).toBe("任务完成了");
  });
});
