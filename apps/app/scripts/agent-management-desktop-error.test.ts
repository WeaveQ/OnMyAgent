import { describe, expect, test } from "bun:test";

import {
  formatAgentManagementDesktopError,
  unwrapDesktopIpcError,
} from "../src/react-app/domains/local-agents/agent-management/agent-management-desktop-error";
import { resolveSkillCellState } from "../src/react-app/domains/local-agents/agent-management/skill-matrix-layout";
import type { AgentManagementSkill } from "@onmyagent/types/desktop-ipc";

const ipc =
  "Error invoking remote method 'onmyagent:desktop': Error: Unsupported skill agent";

function skill(agents: string[]): AgentManagementSkill {
  return {
    name: "demo",
    description: "demo",
    path: "/tmp/demo",
    agents,
    scopeLabel: "fleet",
    sources: [
      {
        agent: "opencode",
        label: "OpenCode",
        scope: "user",
        root: "/tmp",
        path: "/tmp/demo",
        managedByStudioSwitch: false,
        kind: "skill",
      },
    ],
    managedByStudioSwitch: false,
    studioSwitch: null,
  };
}

describe("agent-management desktop skill errors", () => {
  test("unwraps Electron IPC prefix", () => {
    expect(unwrapDesktopIpcError(new Error(ipc))).toBe("Unsupported skill agent");
  });

  test("maps Unsupported skill agent to i18n, not the raw invoke string", () => {
    const message = formatAgentManagementDesktopError(new Error(ipc));
    expect(message).not.toMatch(/onmyagent:desktop/);
    expect(message).not.toMatch(/Unsupported skill agent/);
    expect(message.length).toBeGreaterThan(8);
  });

  test("maps unmanaged-in-app-dir English IPC without hard-coded CJK", () => {
    const message = formatAgentManagementDesktopError(
      new Error("Unmanaged skill is in the app directory"),
    );
    expect(message).not.toMatch(/Unmanaged skill is in the app directory/);
    expect(message.length).toBeGreaterThan(8);
  });
});

describe("skill matrix cells for fleet agents without skill sync", () => {
  test("Grok is readonly, not clickable-available", () => {
    const { state, tooltip } = resolveSkillCellState(skill([]), "grok", null, false);
    expect(state).toBe("readonly");
    expect(tooltip.toLowerCase()).not.toContain("click to enable");
  });
});
