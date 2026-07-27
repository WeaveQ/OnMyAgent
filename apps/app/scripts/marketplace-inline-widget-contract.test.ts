import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Export-style expert skills that emit HTML preview via scripts.
 * Keep this list explicit so new experts must opt into the contract.
 */
const EXPORT_SKILL_GLOBS = [
  "fleet-management-specialist/skills/claims-case/SKILL.md",
  "logistics-finance-specialist/skills/pod-recon/SKILL.md",
  "fleet-management-specialist/skills/fuel-audit/SKILL.md",
  "logistics-finance-specialist/skills/ar-collection/SKILL.md",
  "order-dispatch-specialist/skills/freight-quote/SKILL.md",
  "warehouse-manager/skills/warehouse-ledger/SKILL.md",
  "fleet-management-specialist/skills/affiliate-fleet/SKILL.md",
  "order-dispatch-specialist/skills/capacity-pool/SKILL.md",
  "order-dispatch-specialist/skills/order-entry/SKILL.md",
];

const marketplaceRoot = path.join(
  import.meta.dir,
  "../../desktop/resources/marketplace/experts/plugins",
);

const sharedContractPath = path.join(
  import.meta.dir,
  "../../desktop/resources/marketplace/shared/inline-widget-contract.md",
);

/** Phrases that must appear in every export skill (aligned with shared contract). */
const REQUIRED_PHRASES = [
  "inlineWidget",
  "show_widget",
  "preview:",
] as const;

describe("marketplace inlineWidget shared contract", () => {
  test("shared contract file exists with client safety note", () => {
    const text = readFileSync(sharedContractPath, "utf8");
    expect(text).toContain("inlineWidget");
    expect(text).toContain("show_widget");
    expect(text).toContain("turn-content");
  });

  test("export skills include required inlineWidget constraints", () => {
    for (const rel of EXPORT_SKILL_GLOBS) {
      const abs = path.join(marketplaceRoot, rel);
      const text = readFileSync(abs, "utf8");
      for (const phrase of REQUIRED_PHRASES) {
        expect(text.includes(phrase), `${rel} missing ${phrase}`).toBe(true);
      }
      // At least one explicit forbid for body fences / fragments.
      expect(
        /禁止/.test(text) || /Forbidden|must not|do not/i.test(text),
        `${rel} should forbid body fence / fragment paste`,
      ).toBe(true);
    }
  });

  test("export skill list stays in sync with disk (no missing path)", () => {
    for (const rel of EXPORT_SKILL_GLOBS) {
      const abs = path.join(marketplaceRoot, rel);
      expect(statSync(abs).isFile(), rel).toBe(true);
    }
  });
});
