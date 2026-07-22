import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/warehouse-manager",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("warehouse-manager expert contract", () => {
  test("ships warehouse protocol, automations, and artifact script", () => {
    const agent = readExpertFile("agents/warehouse-manager.md");
    const skill = readExpertFile("skills/warehouse-ledger/SKILL.md");
    const protocol = readExpertFile("skills/warehouse-ledger/references/data-protocol.md");
    const automations = readExpertFile(
      "skills/warehouse-ledger/references/onmyagent-automations.md",
    );

    expect(agent).toContain("warehouse-ledger.json");
    expect(agent).toContain("定时任务");
    expect(agent).toContain("build_warehouse_artifacts.py");
    expect(skill).toContain("--mode export");
    expect(protocol).toContain("automations/proposals");
    expect(automations).toContain('"scene": "office"');
  });

  test("preview/export produce snapshot and proposals", () => {
    const script = join(
      expertRoot,
      "skills/warehouse-ledger/scripts/build_warehouse_artifacts.py",
    );
    const outputDir = mkdtempSync(join(tmpdir(), "warehouse-"));
    try {
      const inputPath = join(outputDir, "warehouse-ledger.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          asOfDate: "2026-07-21",
          dwellAlertDays: 7,
          movements: [
            {
              time: "2026-07-21T10:00:00",
              type: "in",
              waybill: "YD-1",
              sku: "box",
              qtyDelta: 2,
              unit: "件",
              bin: "A-1",
              operator: "op",
            },
          ],
          balances: [
            {
              waybill: "YD-1",
              sku: "box",
              bin: "A-1",
              qty: 2,
              unit: "件",
              inboundDate: "2026-07-01",
              status: "in_stock",
            },
          ],
          anomalies: [],
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
      expect(body.files.some((f) => f.includes("库存台账_"))).toBe(true);
      expect(
        readFileSync(
          join(outputDir, "automations/proposals/warehouse-daily-brief.json"),
          "utf8",
        ),
      ).toContain("仓储");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
