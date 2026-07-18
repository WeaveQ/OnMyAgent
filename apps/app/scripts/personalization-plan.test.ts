/**
 * Drives shipped buildPersonalizationPlan + profile option sources +
 * automation template tags (no reimplementation of scoring).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AUTOMATION_TEMPLATES,
  LOGISTICS_AUTOMATION_TEMPLATE_IDS,
} from "../src/react-app/domains/messaging/automation-model";
import { industryOptions } from "../src/react-app/domains/settings/pages/onboarding-profile-shared";
import {
  assertNoForbiddenVerticalsInCatalog,
  buildPersonalizationPlan,
  listPersonalizationVerticalIds,
} from "../src/react-app/domains/shared/personalization/plan";
import {
  FORBIDDEN_VERTICAL_IDS,
  isForbiddenVerticalId,
} from "../src/react-app/domains/shared/personalization/verticals";

const repoRoot = join(import.meta.dir, "../../..");

const FORBIDDEN_INDUSTRY_VALUES = [
  "healthcare",
  "energy",
  "new-energy",
  "real-estate",
  "property-mgmt",
  "construction",
  "agriculture",
  "aquaculture",
  "food-beverage",
  "fnb",
] as const;

describe("personalization plan (shipped)", () => {
  test("catalog has no forbidden verticals", () => {
    expect(() => assertNoForbiddenVerticalsInCatalog()).not.toThrow();
    for (const id of listPersonalizationVerticalIds()) {
      expect(isForbiddenVerticalId(id)).toBe(false);
    }
    for (const forbidden of FORBIDDEN_VERTICAL_IDS) {
      expect(listPersonalizationVerticalIds()).not.toContain(forbidden);
    }
  });

  test("internet + technology → software vertical; logistics not in auto-create top", () => {
    const plan = buildPersonalizationPlan({
      roles: ["technology"],
      industries: ["internet"],
      tools: ["claude-code"],
      tasks: ["code", "weekly-report"],
    });

    expect(plan.primaryVerticalId).toBe("software-product");
    expect(plan.workbench).toBe("code");
    expect(plan.defaultAutoInstallExpert).toBeTruthy();
    expect(
      plan.experts.some((e) => e.packageName === "software-architect"),
    ).toBe(true);

    const autoCreate = new Set(plan.defaultAutoCreateTemplateIds);
    for (const logisticsId of LOGISTICS_AUTOMATION_TEMPLATE_IDS) {
      expect(autoCreate.has(logisticsId)).toBe(false);
    }
    expect(
      plan.defaultAutoCreateTemplateIds.some(
        (id) => id.startsWith("code-") || id === "weekly-work-report",
      ),
    ).toBe(true);
  });

  test("logistics industry + operations → logistics vertical and logistics templates", () => {
    const plan = buildPersonalizationPlan({
      roles: ["operations", "logistics-ops"],
      industries: ["logistics"],
      tools: ["excel", "feishu"],
      tasks: ["dispatch", "recon", "daily-brief"],
    });

    expect(plan.primaryVerticalId).toBe("logistics-supply");
    expect(plan.workbench).toBe("office");
    expect(plan.defaultAutoInstallExpert).toBe("logistics-ops-navigator");

    const rankedIds = plan.automations.map((a) => a.templateId);
    const logisticsHits = LOGISTICS_AUTOMATION_TEMPLATE_IDS.filter((id) =>
      rankedIds.includes(id),
    );
    expect(logisticsHits.length).toBeGreaterThanOrEqual(3);

    const autoCreate = plan.defaultAutoCreateTemplateIds;
    expect(
      autoCreate.some((id) =>
        (LOGISTICS_AUTOMATION_TEMPLATE_IDS as readonly string[]).includes(id),
      ),
    ).toBe(true);
  });

  test("manufacturing + operations heuristic ranks logistics-supply", () => {
    const plan = buildPersonalizationPlan({
      roles: ["operations"],
      industries: ["manufacturing"],
      tasks: ["dispatch"],
    });
    expect(plan.primaryVerticalId).toBe("logistics-supply");
  });

  test("plan scores never emit forbidden vertical ids", () => {
    const plan = buildPersonalizationPlan({
      roles: ["technology"],
      industries: ["internet", "healthcare", "energy", "real-estate"],
      tasks: ["code"],
    });
    expect(isForbiddenVerticalId(plan.primaryVerticalId)).toBe(false);
    for (const id of plan.secondaryVerticalIds) {
      expect(isForbiddenVerticalId(id)).toBe(false);
    }
    // healthcare/energy/real-estate ignored as industry inputs
    expect(plan.primaryVerticalId).toBe("software-product");
  });
});

describe("profile industry options (shipped)", () => {
  test("includes logistics and excludes healthcare/energy/real-estate/food", () => {
    const values = industryOptions.map((o) => o.value);
    expect(values).toContain("logistics");
    expect(values).toContain("ecommerce");
    expect(values).toContain("software");
    expect(values).toContain("gaming");
    expect(values).toContain("government");
    for (const forbidden of FORBIDDEN_INDUSTRY_VALUES) {
      expect(values).not.toContain(forbidden);
    }
  });

  test("source file does not export healthcare industry option", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/settings/pages/onboarding-profile-shared.tsx",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/value:\s*"healthcare"/);
    expect(source).not.toMatch(/value:\s*"energy"/);
    expect(source).not.toMatch(/value:\s*"real-estate"/);
    expect(source).not.toMatch(/value:\s*"food-beverage"/);
    expect(source).not.toMatch(/value:\s*"fnb"/);
    expect(source).toContain('value: "logistics"');
  });
});

describe("automation template tags (shipped)", () => {
  test("logistics templates carry logistics-supply verticalIds", () => {
    for (const id of LOGISTICS_AUTOMATION_TEMPLATE_IDS) {
      const template = AUTOMATION_TEMPLATES.find((row) => row.id === id);
      expect(template, id).toBeTruthy();
      expect(template?.verticalIds?.includes("logistics-supply")).toBe(true);
    }
  });

  test("logistics profile plan intersects tagged logistics templates", () => {
    const plan = buildPersonalizationPlan({
      industries: ["logistics"],
      roles: ["operations"],
      tasks: ["dispatch"],
    });
    const taggedLogistics = new Set(
      AUTOMATION_TEMPLATES.filter((t) =>
        t.verticalIds?.includes("logistics-supply"),
      ).map((t) => t.id),
    );
    const planIds = plan.automations.map((a) => a.templateId);
    const intersection = planIds.filter((id) => taggedLogistics.has(id));
    expect(intersection.length).toBeGreaterThan(0);
  });
});
