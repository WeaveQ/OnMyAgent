import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/fuel-auditor",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("fuel-auditor expert contract", () => {
  test("ships a deterministic audit protocol and confirmed automation workflow", () => {
    const agent = readExpertFile("agents/fuel-auditor.md");
    const skill = readExpertFile("skills/fuel-audit/SKILL.md");
    const protocol = readExpertFile("skills/fuel-audit/references/data-protocol.md");
    const expertManifest = readExpertFile(".expert-plugin/plugin.json");
    const onMyAgentManifest = readExpertFile(".onmyagent-plugin/plugin.json");

    expect(onMyAgentManifest).toBe(expertManifest);
    expect(JSON.parse(expertManifest).version).toBe("1.1.0");
    expect(agent).toContain("fuel-audit-data.json");
    expect(agent).toContain("build_fuel_audit.py");
    expect(agent).toContain("OnMyAgent 创建结果卡");
    expect(skill).toContain("--mode preview");
    expect(skill).toContain("--mode export");
    expect(skill).toContain("fuel-weekly-scan.json");
    expect(skill).toContain("禁止再建 `output/`");
    expect(protocol).toContain("短里程重复加油");
    expect(protocol).toContain("automations/proposals/fuel-weekly-scan.json");
  });

  test("preview and export identify same-lane outliers and write demo artifacts", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "fuel-auditor-"));
    const script = join(expertRoot, "skills/fuel-audit/scripts/build_fuel_audit.py");
    const fixture = join(import.meta.dir, "fixtures/fuel-auditor/monthly-audit.json");
    try {
      const preview = spawnSync(
        "python3",
        [script, "--input", fixture, "--output-dir", outputDir, "--mode", "preview"],
        { encoding: "utf8" },
      );
      expect(preview.status, preview.stderr).toBe(0);
      const previewBody = JSON.parse(preview.stdout) as {
        anomalyCount: number;
        highRiskVehicles: string[];
        files: string[];
      };
      expect(previewBody.highRiskVehicles).toContain("皖A·D8201");
      expect(previewBody.highRiskVehicles).not.toContain("苏E·5T701");
      expect(previewBody.anomalyCount).toBeGreaterThanOrEqual(5);
      expect(previewBody.files.every(existsSync)).toBe(true);
      const board = readFileSync(join(outputDir, ".process/fuel-audit-board.md"), "utf8");
      expect(board).toContain("38.0");
      expect(board).toContain("25.0");
      expect(board).toContain("严重");

      const exported = spawnSync(
        "python3",
        [script, "--input", fixture, "--output-dir", outputDir, "--mode", "export"],
        { encoding: "utf8" },
      );
      expect(exported.status, exported.stderr).toBe(0);
      const exportBody = JSON.parse(exported.stdout) as { files: string[] };
      expect(exportBody.files.some((file) => file.includes("油费稽核报告_"))).toBe(true);
      expect(exportBody.files.some((file) => file.includes("单车油耗汇总_"))).toBe(true);
      expect(exportBody.files.some((file) => file.includes("油费异常明细_"))).toBe(true);
      const proposal = readFileSync(
        join(outputDir, "automations/proposals/fuel-weekly-scan.json"),
        "utf8",
      );
      expect(proposal).toContain('"scene": "office"');
      expect(proposal).toContain("油费稽核·每周异常扫描");
      expect(proposal).toContain('"weekdays": [');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
