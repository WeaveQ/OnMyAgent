import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const expertsRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins",
);

function runSelfTest(scriptPath: string) {
  const result = spawnSync("python3", [scriptPath, "--self-test"], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

describe("creator ops deterministic skill scripts", () => {
  test("file-level fixtures produce real DOCX and XLSX deliverables", () => {
    const result = spawnSync(
      "python3",
      [join(import.meta.dir, "creator_ops_scripts_fixture_test.py")],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
  }, 15_000);

  test("contract generator rejects incomplete rows and replaces approved placeholders", () => {
    const result = runSelfTest(
      join(
        expertsRoot,
        "kol-content-ops-specialist/skills/rebate-contract-generator/scripts/generate_rebate_contracts.py",
      ),
    );
    expect(result).toEqual({
      complete_records: 1,
      incomplete_records: 1,
      unresolved_placeholders: [],
      chinese_placeholders_ok: 1,
    });
  });

  test("rebate checker sends duplicate matches to manual review", () => {
    const result = runSelfTest(
      join(
        expertsRoot,
        "kol-content-ops-specialist/skills/rebate-contract-checker/scripts/check_rebate_contracts.py",
      ),
    );
    expect(result).toEqual({
      amount_tolerance: 1,
      duplicate_status: "需人工确认",
      unique_status: "核对通过",
      missing_third_leg_status:
        "⚠️ 需人工确认：协议中未提取到达人返点明细，三方核对不完整",
    });
  });

  test("margin analysis handles formulas and zero denominators without fake precision", () => {
    const result = runSelfTest(
      join(
        expertsRoot,
        "kol-project-review-specialist/skills/kol-margin-effect-analysis/scripts/analyze_kol_performance.py",
      ),
    );
    expect(result).toEqual({
      total_amount: 1200,
      natural_ctr: 0.1,
      pure_k_cpc: 10,
      zero_denominator: "数据不足",
      no_threshold_label: "数据不足",
    });
  });

  test("content attribution builds evidence matrices without causal language", () => {
    const result = runSelfTest(
      join(
        expertsRoot,
        "kol-project-review-specialist/skills/kol-content-performance-attribution/scripts/build_content_matrix.py",
      ),
    );
    expect(result).toEqual({
      content_audience_cells: 2,
      search_content_cells: 2,
      conclusion_kind: "相关性观察",
    });
  });
});
