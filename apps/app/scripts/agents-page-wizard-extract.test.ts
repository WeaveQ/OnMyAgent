import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createBlankWizardDraft,
  createDefaultAgentRegistry,
} from "../src/react-app/domains/agents/agent-registry";
import {
  matchesAgentSearch,
  nextStep,
  previousStep,
  type AgentCardItem,
} from "../src/react-app/domains/agents/agents-page-model";

const appRoot = join(import.meta.dir, "..");

describe("agents-page wizard extract (shipped)", () => {
  test("page imports CreateAgentWizard host module", () => {
    const page = readFileSync(
      join(appRoot, "src/react-app/domains/agents/agents-page.tsx"),
      "utf8",
    );
    const wizard = readFileSync(
      join(appRoot, "src/react-app/domains/agents/create-agent-wizard.tsx"),
      "utf8",
    );
    expect(page).toContain('from "./create-agent-wizard"');
    expect(page).not.toMatch(/export function CreateAgentWizard/);
    expect(wizard).toContain("export function CreateAgentWizard");
    expect(wizard).toContain("function AgentPreviewCard");
    expect(wizard).toContain("function SkillsChooser");
    expect(page).toContain('from "./agents-page-styles"');
    expect(wizard).toContain('from "./agents-page-styles"');
  });

  test("wizard draft step helpers advance and reverse", () => {
    expect(nextStep(0)).toBe(1);
    expect(nextStep(1)).toBe(2);
    expect(nextStep(5)).toBe(5);
    expect(previousStep(2)).toBe(1);
    expect(previousStep(0)).toBe(0);
  });

  test("createBlankWizardDraft yields empty named draft for registry", () => {
    const registry = createDefaultAgentRegistry();
    const draft = createBlankWizardDraft(registry, []);
    expect(typeof draft.name).toBe("string");
    expect(Array.isArray(draft.enabledToolIds)).toBe(true);
    expect(Array.isArray(draft.skillIds)).toBe(true);
  });

  test("matchesAgentSearch filters template cards by name", () => {
    const registry = createDefaultAgentRegistry();
    const template = registry.templates[0];
    expect(template).toBeTruthy();
    const item = {
      kind: "template",
      template,
    } as AgentCardItem;
    const needle = template.name.slice(0, 3).toLowerCase();
    expect(matchesAgentSearch(item, needle)).toBe(true);
    expect(matchesAgentSearch(item, "zzz-not-a-real-agent-name")).toBe(false);
  });
});
