import { describe, expect, test } from "bun:test";

import {
  SKILL_AGENT_LABELS,
  SKILL_AGENT_TONES,
  STUDIO_SWITCH_SKILL_AGENT_OPTIONS,
} from "../src/react-app/domains/local-agents/agent-management/agent-management-skill-model";
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  DEFAULT_AGENT_TEMPLATE_ID,
  GLOBAL_VOICE_SIDE_PANEL_KEY,
  STARTUP_SKELETON_ROWS,
  sessionTitleForId,
} from "../src/react-app/domains/session/sidebar/session-panel-model";

describe("session panel model", () => {
  test("resolves display session titles across workspace groups", () => {
    const groups = [
      {
        workspace: { id: "ws_1", name: "One", path: "/tmp/one", preset: "local", workspaceType: "local" },
        sessions: [
          { id: "ses_1", title: "First" },
          { id: "ses_generated", title: "New session - 2026-06-24T00:00:00.000Z" },
        ],
        status: "ready",
      },
      {
        workspace: { id: "ws_2", name: "Two", path: "/tmp/two", preset: "local", workspaceType: "local" },
        sessions: [{ id: "ses_2", title: "Second" }],
        status: "ready",
      },
    ] as const;

    expect(sessionTitleForId(groups, "ses_2")).toBe("Second");
    expect(sessionTitleForId(groups, "ses_generated")).toBeString();
    expect(sessionTitleForId(groups, "missing")).toBe("");
    expect(sessionTitleForId(groups, null)).toBe("");
  });

  test("keeps panel sizing and default ids within expected bounds", () => {
    expect(STARTUP_SKELETON_ROWS.map((row) => row.id)).toEqual(["intro", "middle", "final"]);
    expect(AGENT_PANEL_MIN_WIDTH).toBeLessThan(AGENT_PANEL_DEFAULT_WIDTH);
    expect(AGENT_PANEL_DEFAULT_WIDTH).toBeLessThan(AGENT_PANEL_MAX_WIDTH);
    expect(GLOBAL_VOICE_SIDE_PANEL_KEY).toBe("__onmyagent_voice__");
    expect(DEFAULT_AGENT_TEMPLATE_ID).toBe("daily-assistant");
  });
});

describe("agent management skill model", () => {
  test("keeps studio switch agent options labelled and toned", () => {
    expect(STUDIO_SWITCH_SKILL_AGENT_OPTIONS).toEqual([
      "opencode",
      "codex",
      "claude",
      "gemini",
      "hermes",
      "openclaw",
      "onmyagent",
    ]);

    for (const agent of STUDIO_SWITCH_SKILL_AGENT_OPTIONS) {
      expect(SKILL_AGENT_LABELS[agent]).toBeString();
      expect(SKILL_AGENT_TONES[agent]?.active).toContain("bg-");
      expect(SKILL_AGENT_TONES[agent]?.badge).toContain("text-");
      expect(SKILL_AGENT_TONES[agent]?.dot).toContain("bg-");
    }

    // Locale under bun may be en or zh.
    expect(["未识别", "Unrecognized"]).toContain(SKILL_AGENT_LABELS.unknown);
    expect(SKILL_AGENT_LABELS.onmyagent).toBe("OnMyAgent");
    expect(SKILL_AGENT_TONES.unknown.dot).toBe("bg-dls-secondary");
    expect(SKILL_AGENT_TONES.onmyagent.dot).toBe("bg-dls-secondary");
  });
});
