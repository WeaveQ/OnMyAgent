import { describe, expect, test } from "bun:test";

import {
  applyAutomationToolSelection,
  appendAutomationPromptText,
  automationInboxFileReference,
  buildAutomationSkillCatalog,
} from "../src/react-app/domains/messaging/automation-prompt-tools";

describe("automation prompt tool selections", () => {
  test("supports commands and skills as executable slash prompts", () => {
    expect(applyAutomationToolSelection("", { kind: "command", name: "review" })).toBe(
      "/review ",
    );
    expect(applyAutomationToolSelection("", { kind: "skill", name: "slides" })).toBe(
      "/slides ",
    );
  });

  test("keeps existing free-text as slash command arguments", () => {
    expect(
      applyAutomationToolSelection("Summarize today's market", {
        kind: "skill",
        name: "stock-brief",
      }),
    ).toBe("/stock-brief Summarize today's market");
    expect(
      applyAutomationToolSelection("/old inspect the repo", {
        kind: "command",
        name: "review",
      }),
    ).toBe("/review inspect the repo");
  });

  test("supports plugins and connectors as durable instructions", () => {
    expect(applyAutomationToolSelection("Start", { kind: "plugin", instruction: "Use docs plugin" }))
      .toBe("Start\nUse docs plugin");
    expect(applyAutomationToolSelection("Start", { kind: "connector", instruction: "Use GitHub" }))
      .toBe("Start\nUse GitHub");
  });

  test("supports uploaded files as durable inbox references", () => {
    const reference = automationInboxFileReference("/workspace/", "/reports/input.pdf");
    expect(reference).toBe("@/workspace/.opencode/onmyagent/inbox/reports/input.pdf");
    expect(appendAutomationPromptText("Review", reference)).toBe(
      "Review\n@/workspace/.opencode/onmyagent/inbox/reports/input.pdf",
    );
  });

  test("merges OpenCode commands and skills like the session composer", () => {
    const catalog = buildAutomationSkillCatalog({
      openCodeCommands: [
        { name: "skills", description: "Enable/disable Skills", source: "command" },
        { name: "mcp-only", description: "hidden", source: "mcp" },
      ],
      skills: [
        { name: "slides", description: "Make slides", path: "/skills/slides" },
        { name: "skills", description: "skill card should lose to command" },
      ],
      markdownCommands: [{ name: "project-cmd", description: "Workspace md" }],
    });
    const names = catalog.map((item) => item.name);
    expect(names).toContain("skills");
    expect(names).toContain("slides");
    expect(names).toContain("project-cmd");
    expect(names).not.toContain("mcp-only");
    // OpenCode command wins over skill card of the same name (mergeSlashCommandsWithSkills).
    expect(catalog.find((item) => item.name === "skills")?.description).toBe(
      "Enable/disable Skills",
    );
  });
});
