import { describe, expect, it } from "bun:test";

import { coerceAgentManagementUiCache } from "../src/react-app/domains/local-agents/agent-management/agent-management-page";

describe("agent management UI cache coercion", () => {
  it("round-trips every non-empty column filter including cursor-agent and gemini", () => {
    const stored = {
      activePanel: "skills",
      skillColumnFilter: [
        "opencode",
        "codex",
        "claude",
        "hermes",
        "openclaw",
        "onmyagent",
        "gemini",
        "cursor-agent",
        "mimo",
        "workbuddy",
      ],
      skillSearch: "foo",
      selectedSkillKey: "bar",
      healthResults: {},
    };

    const ui = coerceAgentManagementUiCache(stored);

    expect(ui.skillColumnFilter).toEqual(stored.skillColumnFilter);
    // Cursor Agent / Gemini are not in the legacy hardcoded allowlist — they must survive a cache round-trip.
    expect(ui.skillColumnFilter).toContain("cursor-agent");
    expect(ui.skillColumnFilter).toContain("gemini");
  });

  it("drops non-string / blank entries but keeps valid catalog ids", () => {
    const ui = coerceAgentManagementUiCache({
      skillColumnFilter: ["cursor-agent", "", "   ", 42, null, [], {}],
    });

    expect(ui.skillColumnFilter).toEqual(["cursor-agent"]);
  });

  it("falls back to defaults for non-object input", () => {
    expect(coerceAgentManagementUiCache(null).skillColumnFilter).toEqual([]);
    expect(coerceAgentManagementUiCache("nope").skillColumnFilter).toEqual([]);
    expect(coerceAgentManagementUiCache(undefined).activePanel).toBe("agents");
  });

  it("keeps panel/search/selection fields alongside the column filter", () => {
    const ui = coerceAgentManagementUiCache({
      activePanel: "archive",
      skillColumnFilter: ["cursor-agent"],
      skillSearch: "deploy",
      selectedSkillKey: "deploy-skill",
    });

    expect(ui.activePanel).toBe("archive");
    expect(ui.skillSearch).toBe("deploy");
    expect(ui.selectedSkillKey).toBe("deploy-skill");
  });
});
