/**
 * Pure helpers for automation-run completion desktop alerts.
 * Free of React / server client so shell can poll and unit-test detection.
 */

export type AutomationRunNotifyStatus = "success" | "failed";

export type AutomationRunNotifyCandidate = {
  workspaceId: string;
  automationId: string;
  title: string;
  status: AutomationRunNotifyStatus;
  ranAt: number;
  sessionId?: string;
  scene?: "office" | "code";
};

export type AutomationRunSnapshotItem = {
  id: string;
  title: string;
  scene?: "office" | "code";
  lastRun: {
    status: string;
    ranAt: number;
    sessionId?: string;
  } | null;
};

export function automationRunNotifyFingerprint(input: {
  workspaceId: string;
  automationId: string;
  ranAt: number;
  status: string;
}): string {
  return `${input.workspaceId}:${input.automationId}:${input.ranAt}:${input.status}`;
}

function isNotifyStatus(status: string): status is AutomationRunNotifyStatus {
  return status === "success" || status === "failed";
}

/**
 * Diff a workspace automation list against already-seen run fingerprints.
 * First pass should use `seedOnly: true` so historical lastRun rows do not
 * flood the OS tray when the app boots.
 */
export function collectAutomationRunNotifications(
  previousSeen: ReadonlySet<string>,
  workspaceId: string,
  tasks: readonly AutomationRunSnapshotItem[],
  options: { seedOnly: boolean },
): {
  notifications: AutomationRunNotifyCandidate[];
  nextSeen: Set<string>;
} {
  const nextSeen = new Set(previousSeen);
  const notifications: AutomationRunNotifyCandidate[] = [];
  const ws = workspaceId.trim();
  if (!ws) return { notifications, nextSeen };

  for (const task of tasks) {
    const lastRun = task.lastRun;
    if (!lastRun || !isNotifyStatus(lastRun.status)) continue;
    if (!Number.isFinite(lastRun.ranAt) || lastRun.ranAt <= 0) continue;

    const fingerprint = automationRunNotifyFingerprint({
      workspaceId: ws,
      automationId: task.id,
      ranAt: lastRun.ranAt,
      status: lastRun.status,
    });
    if (nextSeen.has(fingerprint)) continue;
    nextSeen.add(fingerprint);

    if (options.seedOnly) continue;

    const title = task.title.trim() || task.id;
    const sessionId = lastRun.sessionId?.trim();
    notifications.push({
      workspaceId: ws,
      automationId: task.id,
      title,
      status: lastRun.status,
      ranAt: lastRun.ranAt,
      ...(sessionId ? { sessionId } : {}),
      ...(task.scene === "office" || task.scene === "code"
        ? { scene: task.scene }
        : {}),
    });
  }

  return { notifications, nextSeen };
}

export function buildAutomationRunNotificationCopy(input: {
  title: string;
  status: AutomationRunNotifyStatus;
  labels: {
    successTitle: string;
    failedTitle: string;
    successBody: (taskTitle: string) => string;
    failedBody: (taskTitle: string) => string;
  };
}): { title: string; body: string } {
  const taskTitle = input.title.trim() || "Automation";
  if (input.status === "success") {
    return {
      title: input.labels.successTitle,
      body: input.labels.successBody(taskTitle),
    };
  }
  return {
    title: input.labels.failedTitle,
    body: input.labels.failedBody(taskTitle),
  };
}
