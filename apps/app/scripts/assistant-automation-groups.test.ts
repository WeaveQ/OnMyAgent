import { describe, expect, test } from "bun:test";

import { groupAssistantAutomationItems } from "../src/react-app/domains/session/sidebar/assistant-automation-groups";

describe("assistant automation groups", () => {
  test("groups runs from the same automation under one stable task", () => {
    const groups = groupAssistantAutomationItems([
      {
        item: "run-a",
        automationId: "automation-a",
        title: "Daily briefing",
        updatedAt: 100,
      },
      {
        item: "run-b",
        automationId: "automation-a",
        title: "Daily briefing",
        updatedAt: 200,
      },
      {
        item: "run-c",
        automationId: "automation-b",
        title: "Weekly review",
        updatedAt: 300,
      },
    ]);

    expect(groups).toEqual([
      {
        id: "automation-b",
        title: "Weekly review",
        items: ["run-c"],
        updatedAt: 300,
      },
      {
        id: "automation-a",
        title: "Daily briefing",
        items: ["run-a", "run-b"],
        updatedAt: 200,
      },
    ]);
  });
});
