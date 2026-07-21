import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/affiliate-vehicle-admin",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("affiliate-vehicle-admin expert contract", () => {
  test("ships fleet protocol, automations, and artifact script", () => {
    const agent = readExpertFile("agents/affiliate-vehicle-admin.md");
    const skill = readExpertFile("skills/affiliate-fleet/SKILL.md");
    const protocol = readExpertFile("skills/affiliate-fleet/references/data-protocol.md");
    const automations = readExpertFile(
      "skills/affiliate-fleet/references/onmyagent-automations.md",
    );

    expect(agent).toContain("fleet-ledger.json");
    expect(agent).toContain("定时任务");
    expect(agent).toContain("build_fleet_artifacts.py");
    expect(skill).toContain("--mode export");
    expect(protocol).toContain("automations/proposals");
    expect(automations).toContain('"scene": "office"');
  });

  test("preview/export produce boards and proposals", () => {
    const script = join(
      expertRoot,
      "skills/affiliate-fleet/scripts/build_fleet_artifacts.py",
    );
    const outputDir = mkdtempSync(join(tmpdir(), "affiliate-fleet-"));
    try {
      const inputPath = join(outputDir, "fleet-ledger.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          asOfDate: "2026-07-21",
          vehicles: [
            {
              plate: "粤B00001",
              driverName: "Driver",
              docs: { driverLicenseExpire: "2026-07-20" },
              insurance: { compulsoryExpire: "2026-07-25" },
              annualInspectionExpire: "2026-12-01",
              violationsOpen: 0,
            },
          ],
        }),
        "utf8",
      );
      const preview = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", outputDir, "--mode", "preview"],
        { encoding: "utf8" },
      );
      expect(preview.status, preview.stderr).toBe(0);
      const exported = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", outputDir, "--mode", "export"],
        { encoding: "utf8" },
      );
      expect(exported.status, exported.stderr).toBe(0);
      const body = JSON.parse(exported.stdout) as { files: string[] };
      expect(body.files.some((f) => f.includes("挂靠车台账_"))).toBe(true);
      expect(
        readFileSync(join(outputDir, "automations/proposals/fleet-daily-scan.json"), "utf8"),
      ).toContain("挂靠车管");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
