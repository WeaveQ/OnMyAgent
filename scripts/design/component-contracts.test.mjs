import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildDesignReport,
  evaluatePrimitiveDefault,
  extraGlobalTypeSizes,
  walkComponentContracts,
} from "./extract-tokens.mjs";
import { loadDesignYaml } from "./design-yaml.mjs";
import { loadDesignContractsYaml } from "./component-contracts.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("evaluatePrimitiveDefault fails a planted Input class vs DESIGN YAML", () => {
  const yaml = loadDesignContractsYaml(repoRoot);
  const hits = evaluatePrimitiveDefault(
    "input",
    "h-9 w-full rounded-lg border border-dls-border bg-dls-background px-3 py-1",
    yaml,
  );
  assert.ok(
    hits.some((hit) => hit.field === "height"),
    "planted h-9 Input must fail YAML height (40 / h-10)",
  );
});

test("evaluatePrimitiveDefault fails a planted Tooltip shadow", () => {
  const yaml = loadDesignContractsYaml(repoRoot);
  const hits = evaluatePrimitiveDefault(
    "tooltip",
    "rounded-sm bg-dls-surface-solid px-2 py-1 shadow-[0_4px_16px_rgba(15,23,42,0.12)]",
    yaml,
  );
  assert.ok(
    hits.some((hit) => hit.field === "shadow"),
    "planted Tooltip shadow must fail",
  );
});

test("planted YAML height mismatch fails against live Input defaults", () => {
  const yaml = structuredClone(loadDesignYaml(join(repoRoot, "DESIGN.md")));
  yaml.components.contracts.input.height = 24;
  const hits = walkComponentContracts(repoRoot, yaml).mismatches;
  assert.ok(
    hits.some((hit) => hit.id === "input" && hit.field === "height"),
    `YAML height 24 vs live Input must fail, got ${JSON.stringify(hits)}`,
  );
});

test("shipped Input/SelectMenu/Tooltip/StatusBadge/session-card defaults match DESIGN contracts", () => {
  const walked = walkComponentContracts(repoRoot);
  assert.deepEqual(
    walked.mismatches,
    [],
    `contract mismatches: ${JSON.stringify(walked.mismatches, null, 2)}`,
  );
});

test("undeclared extra global type sizes are empty", () => {
  const extras = extraGlobalTypeSizes(repoRoot);
  assert.deepEqual(
    extras,
    [],
    `extra type sizes: ${JSON.stringify(extras, null, 2)}`,
  );
});

test("buildDesignReport from the shipped extractor includes componentContracts", () => {
  const report = buildDesignReport();
  assert.ok(report.componentContracts);
  assert.equal(report.componentContracts.mismatches.length, 0);
  assert.equal(report.componentContracts.extraTypeSizes.length, 0);
  const tooltip = report.componentContracts;
  assert.ok(tooltip);
});
