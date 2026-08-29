import { describe, expect, test } from "bun:test";
import { t } from "../src/i18n";

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
    expect(formatAgentManagementDesktopError(new Error(ipc))).toBe(
      t("skills.error_unsupported_agent"),
    );
  });

  test("maps other desktop skill throws", () => {
    expect(
      formatAgentManagementDesktopError(new Error("Skill source is missing SKILL.md")),
    ).toBe(t("skills.error_missing_skill_md"));
    expect(
      formatAgentManagementDesktopError(new Error("Skill directory not found")),
    ).toBe(t("skills.error_directory_not_found"));
    expect(
      formatAgentManagementDesktopError(new Error("Unsupported skill action")),
    ).toBe(t("skills.error_unsupported_action"));
    expect(
      formatAgentManagementDesktopError(new Error("Invalid skill directory")),
    ).toBe(t("skills.error_invalid_directory"));
    expect(
      formatAgentManagementDesktopError(new Error("Unmanaged skill is in the app directory")),
    ).toBe(t("skills.error_unmanaged_in_app_dir"));
  });
});

describe("skill matrix cells for fleet agents without skill sync", () => {
  test("Grok is readonly whether or not the skill is already enabled", () => {
    expect(resolveSkillCellState(skill([]), "grok", null, false).state).toBe("readonly");
    expect(resolveSkillCellState(skill(["grok"]), "grok", null, false).state).toBe("readonly");
  });
});
