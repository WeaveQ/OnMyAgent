/**
 * Visibility-aware poll helpers — imports shipped pure functions + structural
 * assert that server-provider wires them for health polling.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isAutomationRefreshRequestCurrent } from "../src/react-app/domains/messaging/automation-page";

import {
  DEFAULT_VISIBILITY_POLL_POLICY,
  isDocumentHidden,
  nextPollDelayMs,
  shouldRunPollTick,
  type VisibilityPollPolicy,
} from "../src/react-app/infra/visibility-poll";

const appRoot = join(import.meta.dir, "..");

describe("DEFAULT_VISIBILITY_POLL_POLICY", () => {
  test("focused 10s; hidden pauses (0)", () => {
    expect(DEFAULT_VISIBILITY_POLL_POLICY.focusedIntervalMs).toBe(10_000);
    expect(DEFAULT_VISIBILITY_POLL_POLICY.hiddenIntervalMs).toBe(0);
  });
});

describe("nextPollDelayMs (shipped)", () => {
  const policy: VisibilityPollPolicy = {
    focusedIntervalMs: 10_000,
    hiddenIntervalMs: 0,
  };

  test("returns focused interval when visible", () => {
    expect(nextPollDelayMs(policy, false)).toBe(10_000);
  });

  test("returns null when hidden and hiddenIntervalMs is 0 (pause)", () => {
    expect(nextPollDelayMs(policy, true)).toBeNull();
  });

  test("returns slower hidden interval when configured", () => {
    const slow: VisibilityPollPolicy = {
      focusedIntervalMs: 10_000,
      hiddenIntervalMs: 60_000,
    };
    expect(nextPollDelayMs(slow, true)).toBe(60_000);
    expect(nextPollDelayMs(slow, false)).toBe(10_000);
  });

  test("null when focused interval is non-positive", () => {
    expect(
      nextPollDelayMs({ focusedIntervalMs: 0, hiddenIntervalMs: 5_000 }, false),
    ).toBeNull();
    expect(
      nextPollDelayMs({ focusedIntervalMs: -1, hiddenIntervalMs: 5_000 }, false),
    ).toBeNull();
  });

  test("uses default policy values", () => {
    expect(nextPollDelayMs(DEFAULT_VISIBILITY_POLL_POLICY, false)).toBe(10_000);
    expect(nextPollDelayMs(DEFAULT_VISIBILITY_POLL_POLICY, true)).toBeNull();
  });
});

describe("shouldRunPollTick (shipped)", () => {
  test("runs when visible", () => {
    expect(shouldRunPollTick(false)).toBe(true);
    expect(shouldRunPollTick(false, true)).toBe(true);
    expect(shouldRunPollTick(false, false)).toBe(true);
  });

  test("pauses when hidden and pauseWhenHidden is true (default)", () => {
    expect(shouldRunPollTick(true)).toBe(false);
    expect(shouldRunPollTick(true, true)).toBe(false);
  });

  test("allows tick when hidden if pauseWhenHidden is false", () => {
    expect(shouldRunPollTick(true, false)).toBe(true);
  });
});

describe("isDocumentHidden (shipped)", () => {
  test("honors explicit boolean", () => {
    expect(isDocumentHidden(true)).toBe(true);
    expect(isDocumentHidden(false)).toBe(false);
  });
});

describe("server-provider health poll wiring", () => {
  test("imports visibility-poll helpers and reschedules on visibilitychange", () => {
    const source = readFileSync(
      join(appRoot, "src/react-app/kernel/server-provider.tsx"),
      "utf8",
    );
    expect(source).toContain('from "../infra/visibility-poll"');
    expect(source).toContain("nextPollDelayMs");
    expect(source).toContain("shouldRunPollTick");
    expect(source).toContain("DEFAULT_VISIBILITY_POLL_POLICY");
    expect(source).toContain('addEventListener("visibilitychange"');
    // No fixed always-on 10s interval without visibility reschedule.
    expect(source).not.toMatch(/setInterval\(\s*run\s*,\s*10_000\s*\)/);
  });
});

describe("personal-local-agent host poll wiring", () => {
  test("page uses visibility-aware interval helpers for heartbeats and run polls", () => {
    const page = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/local-agents/host/personal-local-agent-page.tsx",
      ),
      "utf8",
    );
    expect(page).toContain('from "../../../infra/visibility-poll"');
    expect(page).toContain("shouldRunPollTick");
    expect(page).toContain("isDocumentHidden");
    expect(page).toContain("useVisibilityInterval");
    expect(page).toContain("usePersonalLocalAgentProcessSync");
  });

  test("process-sync hook pauses ACP process list polling while hidden", () => {
    const source = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/local-agents/host/use-personal-local-agent-process-sync.ts",
      ),
      "utf8",
    );
    expect(source).toContain('from "../../../infra/visibility-poll"');
    expect(source).toContain("shouldRunPollTick");
    expect(source).toContain("isDocumentHidden");
    expect(source).toContain("personalLocalAgentAcpProcessesList");
  });
});

describe("deferred high-value network/status poll wiring", () => {
  test("automation refresh rejects a stale workspace response after a scope switch", () => {
    const oldClient = {};
    const newClient = {};
    expect(
      isAutomationRefreshRequestCurrent({
        requestId: 1,
        activeRequestId: 2,
        requestClient: oldClient,
        activeClient: newClient,
        requestWorkspaceId: "workspace-old",
        activeWorkspaceId: "workspace-new",
      }),
    ).toBe(false);
    expect(
      isAutomationRefreshRequestCurrent({
        requestId: 2,
        activeRequestId: 2,
        requestClient: newClient,
        activeClient: newClient,
        requestWorkspaceId: "workspace-new",
        activeWorkspaceId: "workspace-new",
      }),
    ).toBe(true);
  });

  test("messaging-view-state pauses 10s refresh while hidden", () => {
    const source = readFileSync(
      join(appRoot, "src/react-app/domains/settings/state/messaging-view-state.ts"),
      "utf8",
    );
    expect(source).toContain('from "../../../infra/visibility-poll"');
    expect(source).toContain("shouldRunPollTick");
    expect(source).toContain("isDocumentHidden");
  });

  test("desktop-config-provider pauses signed-in config refresh while hidden", () => {
    const source = readFileSync(
      join(appRoot, "src/react-app/domains/cloud/desktop-config-provider.tsx"),
      "utf8",
    );
    expect(source).toContain('from "../../infra/visibility-poll"');
    expect(source).toContain("shouldRunPollTick");
    expect(source).toContain("isDocumentHidden");
  });

  test("session-route refresh-hook pauses reload-event poll while hidden", () => {
    const source = readFileSync(
      join(appRoot, "src/react-app/shell/session-route/refresh-hook.ts"),
      "utf8",
    );
    expect(source).toContain("shouldRunReloadEventsPoll");
    expect(source).toContain("const scheduleNextPoll");
    expect(source).toContain("window.setTimeout");
    expect(source).not.toContain("window.setInterval");
  });

  test("automation-page pauses status poll while hidden", () => {
    const source = readFileSync(
      join(appRoot, "src/react-app/domains/messaging/automation-page.tsx"),
      "utf8",
    );
    expect(source).toContain('from "../../infra/visibility-poll"');
    expect(source).toContain("shouldRunPollTick");
    expect(source).toContain("isDocumentHidden");
    expect(source).toContain("automationRefreshStateRef");
    expect(source).toContain("automationRefreshScopeRef");
    expect(source).toContain("const isCurrentRequest");
    expect(source).toContain("activeRequestId: refreshState.requestId");
    expect(source).toContain("const scheduleNextPoll");
    expect(source).toContain("await refreshAutomations({ silent: true })");
    expect(source).toContain("window.setTimeout");
    expect(source).not.toContain("window.setInterval");
  });
});

describe("code-workspace-side-panel automations poll wiring", () => {
  test("imports visibility-poll helpers and no longer uses bare 15s setInterval", () => {
    const source = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
      ),
      "utf8",
    );
    expect(source).toContain('from "../../../infra/visibility-poll"');
    expect(source).toContain("nextPollDelayMs");
    expect(source).toContain("shouldRunPollTick");
    expect(source).toContain("isDocumentHidden");
    expect(source).toContain('addEventListener("visibilitychange"');
    expect(source).toContain("focusedIntervalMs: 15_000");
    expect(source).toContain("await load(false)");
    expect(source).toContain("window.setTimeout");
    expect(source).not.toContain("window.setInterval");
    // No fixed always-on 15s automations load interval without visibility pause.
    expect(source).not.toMatch(
      /setInterval\(\s*\(\)\s*=>\s*void\s*load\(false\)\s*,\s*15_000\s*\)/,
    );
  });
});
