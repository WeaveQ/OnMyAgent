import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAgentReadyNotificationBody,
  looksLikePlaceholderSessionTitle,
  looksLikeSessionId,
  resolveAgentReadyTaskSnippet,
  shouldNotifyAgentReadyTransition,
} from "../src/react-app/domains/shell-feedback";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

  test("rejects session ids and placeholder titles", () => {
    expect(looksLikeSessionId("ses_fe354fa3")).toBe(true);
    expect(looksLikeSessionId("ses_abc_def")).toBe(true);
    expect(looksLikePlaceholderSessionTitle("New session")).toBe(true);
    expect(
      looksLikePlaceholderSessionTitle("New session - 2026-08-20T01:00:00.000Z"),
    ).toBe(true);
    expect(
      looksLikePlaceholderSessionTitle("新建会话", ["新建会话"]),
    ).toBe(true);
    expect(looksLikePlaceholderSessionTitle("核对六月运输账单")).toBe(false);
  });

  test("prefers truncated user prompt over session id", () => {
    expect(
      resolveAgentReadyTaskSnippet({
        userSnippet: "核对六月运输账单",
        sessionTitle: "ses_fe354fa3",
      }),
    ).toBe("核对六月运输账单");
    const longSnippet = resolveAgentReadyTaskSnippet({
      userSnippet: "这是一段很长的用户发起文案需要被缩略成更短的通知标题内容再加几个字",
      sessionTitle: null,
    });
    expect(longSnippet.endsWith("…")).toBe(true);
    expect(longSnippet.length).toBeLessThanOrEqual(29);
  });

  test("production path with no prompt and a placeholder title uses fallback", () => {
    expect(
      resolveAgentReadyTaskSnippet({
        sessionTitle: "New session",
        placeholderTitles: ["新建会话"],
      }),
    ).toBe("");
    expect(
      buildAgentReadyNotificationBody({
        sessionTitle: "新建会话",
        placeholderTitles: ["新建会话"],
        bodyWithSnippet: (snippet) => `Finished: ${snippet}`,
        fallbackBody: "Task finished",
      }),
    ).toBe("Task finished");
    expect(
      buildAgentReadyNotificationBody({
        sessionTitle: "核对六月运输账单",
        placeholderTitles: ["新建会话"],
        bodyWithSnippet: (snippet) => `Finished: ${snippet}`,
        fallbackBody: "Task finished",
      }),
    ).toBe("Finished: 核对六月运输账单");
  });

  test("monitor does not pass a fake userSnippet and rejects default titles", () => {
    const monitor = readFileSync(
      join(
        appRoot,
        "src/react-app/shell/agent-ready-desktop-notification-monitor.tsx",
      ),
      "utf8",
    );
    expect(monitor).toContain('placeholderTitles: [t("session.default_title")]');
    expect(monitor).not.toContain("userSnippet: null");
  });
});
