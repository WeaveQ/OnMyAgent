import { describe, expect, test } from "bun:test";

import {
  appendTeamWorkflowPrompt,
  compileTeamWorkflow,
} from "../src/services/workbuddy-team-workflow.js";

describe("WorkBuddy team workflow compiler", () => {
  test("classifies member responsibilities into a compact ordered playbook", () => {
    const workflow = compileTeamWorkflow({
      leadAgentName: "software-team-lead",
      members: [
        { id: "software-team-lead", role: "lead", profession: { zh: "交付总监", en: "Delivery lead" } },
        { id: "software-product-manager", role: "member", profession: { zh: "产品经理", en: "Product manager" } },
        { id: "software-architect", role: "member", profession: { zh: "架构师", en: "Architect" } },
        { id: "software-engineer", role: "member", profession: { zh: "工程师", en: "Engineer" } },
        { id: "software-qa-engineer", role: "member", profession: { zh: "QA工程师", en: "QA engineer" } },
      ],
    });

    expect(workflow.mode).toBe("lead-workflow");
    expect(workflow.memberCount).toBe(5);
    expect(workflow.stages.map((stage) => stage.kind)).toEqual([
      "frame", "investigate", "produce", "verify", "deliver",
    ]);
    expect(workflow.stages[0]?.members.map((member) => member.id))
      .toEqual(["software-product-manager"]);
    expect(workflow.stages[3]?.members.map((member) => member.id))
      .toEqual(["software-qa-engineer"]);
    expect(workflow.stages[4]?.members).toEqual([]);
  });

  test("uses readable agent ids as member fallback without inventing dispatch", () => {
    const workflow = compileTeamWorkflow({
      leadAgentName: "team-lead",
      members: [{ id: "team-lead", role: "lead" }],
      fallbackMemberIds: ["team-lead", "topic-researcher", "report-writer"],
    });
    const prompt = appendTeamWorkflowPrompt("# Lead\nBase instructions.", workflow);

    expect(workflow.memberCount).toBe(3);
    expect(prompt).toContain("you are the only executing model");
    expect(prompt).toContain("not independently running agents");
    expect(prompt).toContain("Never claim that you delegated");
    expect(prompt).toContain("Stage outputs");
    expect(prompt).toContain("simple clarification");
    expect(prompt).toContain("skip stages");
  });
});
