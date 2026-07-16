import { describe, expect, test } from "bun:test";

import {
  applyAutomationToolSelection,
  appendAutomationPromptText,
  automationInboxFileReference,
} from "../src/react-app/domains/messaging/automation-prompt-tools";

describe("automation prompt tool selections", () => {
  test("supports commands and skills as executable slash prompts", () => {
    expect(applyAutomationToolSelection("existing", { kind: "command", name: "review" })).toBe("/review ");
    expect(applyAutomationToolSelection("existing", { kind: "skill", name: "slides" })).toBe("/slides ");
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
});
