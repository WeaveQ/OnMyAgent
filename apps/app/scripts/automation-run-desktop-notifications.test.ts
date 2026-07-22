import { describe, expect, test } from "bun:test";

import {
  automationRunNotifyFingerprint,
  buildAutomationRunNotificationCopy,
  collectAutomationRunNotifications,
} from "../src/react-app/domains/shell-feedback";

describe("automation run desktop notifications", () => {
  test("fingerprints are stable per workspace/task/run/status", () => {
    expect(
      automationRunNotifyFingerprint({
        workspaceId: "ws-1",
        automationId: "auto-1",
        ranAt: 100,
        status: "success",
      }),
    ).toBe("ws-1:auto-1:100:success");
  });

  test("seedOnly records history without emitting notifications", () => {
    const { notifications, nextSeen } = collectAutomationRunNotifications(
      new Set(),
      "ws-1",
      [
        {
          id: "auto-1",
          title: "Daily digest",
          lastRun: { status: "success", ranAt: 100, sessionId: "ses-1" },
        },
      ],
      { seedOnly: true },
    );
    expect(notifications).toEqual([]);
    expect(nextSeen.has("ws-1:auto-1:100:success")).toBe(true);
  });

  test("emits success and failed when lastRun is new", () => {
    const seeded = collectAutomationRunNotifications(
      new Set(),
      "ws-1",
      [
        {
          id: "auto-1",
          title: "Daily digest",
          scene: "office",
          lastRun: { status: "success", ranAt: 100, sessionId: "ses-1" },
        },
      ],
      { seedOnly: true },
    );

    const { notifications } = collectAutomationRunNotifications(
      seeded.nextSeen,
      "ws-1",
      [
        {
          id: "auto-1",
          title: "Daily digest",
          scene: "office",
          lastRun: { status: "failed", ranAt: 200, sessionId: "ses-2" },
        },
        {
          id: "auto-2",
          title: "Weekly report",
          scene: "code",
          lastRun: { status: "success", ranAt: 300, sessionId: "ses-3" },
        },
        {
          id: "auto-3",
          title: "Skipped job",
          lastRun: { status: "skipped", ranAt: 400 },
        },
      ],
      { seedOnly: false },
    );

    expect(notifications).toEqual([
      {
        workspaceId: "ws-1",
        automationId: "auto-1",
        title: "Daily digest",
        status: "failed",
        ranAt: 200,
        sessionId: "ses-2",
        scene: "office",
      },
      {
        workspaceId: "ws-1",
        automationId: "auto-2",
        title: "Weekly report",
        status: "success",
        ranAt: 300,
        sessionId: "ses-3",
        scene: "code",
      },
    ]);
  });

  test("does not re-notify the same fingerprint", () => {
    const first = collectAutomationRunNotifications(
      new Set(),
      "ws-1",
      [
        {
          id: "auto-1",
          title: "Daily digest",
          lastRun: { status: "success", ranAt: 100, sessionId: "ses-1" },
        },
      ],
      { seedOnly: false },
    );
    expect(first.notifications).toHaveLength(1);

    const second = collectAutomationRunNotifications(
      first.nextSeen,
      "ws-1",
      [
        {
          id: "auto-1",
          title: "Daily digest",
          lastRun: { status: "success", ranAt: 100, sessionId: "ses-1" },
        },
      ],
      { seedOnly: false },
    );
    expect(second.notifications).toEqual([]);
  });

  test("builds localized copy from labels", () => {
    expect(
      buildAutomationRunNotificationCopy({
        title: "Daily digest",
        status: "success",
        labels: {
          successTitle: "Automation completed",
          failedTitle: "Automation failed",
          successBody: (taskTitle) => `"${taskTitle}" finished successfully.`,
          failedBody: (taskTitle) => `"${taskTitle}" failed.`,
        },
      }),
    ).toEqual({
      title: "Automation completed",
      body: `"Daily digest" finished successfully.`,
    });

    expect(
      buildAutomationRunNotificationCopy({
        title: "Daily digest",
        status: "failed",
        labels: {
          successTitle: "Automation completed",
          failedTitle: "Automation failed",
          successBody: (taskTitle) => `"${taskTitle}" finished successfully.`,
          failedBody: (taskTitle) => `"${taskTitle}" failed.`,
        },
      }),
    ).toEqual({
      title: "Automation failed",
      body: `"Daily digest" failed.`,
    });
  });
});
