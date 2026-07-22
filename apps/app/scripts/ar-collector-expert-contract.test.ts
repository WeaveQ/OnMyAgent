import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/ar-collector",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("ar-collector expert contract", () => {
  test("ships ledger protocol, automation playbook, and artifact script", () => {
    const agent = readExpertFile("agents/ar-collector.md");
    const skill = readExpertFile("skills/ar-collection/SKILL.md");
    const protocol = readExpertFile("skills/ar-collection/references/data-protocol.md");
    const automations = readExpertFile(
      "skills/ar-collection/references/onmyagent-automations.md",
    );
    const readme = readExpertFile("README.md");

    expect(agent).toContain("ar-ledger.json");
    expect(agent).toContain("定时任务");
    expect(agent).toContain("build_ar_artifacts.py");
    expect(agent).toContain("禁止未确认");
    expect(skill).toContain("--mode preview");
    expect(skill).toContain("--mode export");
    expect(skill).toContain("onmyagent-automations.md");
    expect(protocol).toContain("ar-ledger.json");
    expect(protocol).toContain("automations/proposals");
    expect(automations).toContain("createAutomation");
    expect(automations).toContain('"scene": "office"');
    expect(readme).toContain("定时提醒");
  });

  test("preview and export scripts write process board and result artifacts", () => {
    const script = join(
      expertRoot,
      "skills/ar-collection/scripts/build_ar_artifacts.py",
    );
    const outputDir = mkdtempSync(join(tmpdir(), "ar-collector-"));
    try {
      const inputPath = join(outputDir, "ar-ledger.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          asOfDate: "2026-07-21",
          rows: [
            {
              customer: "Acme",
              invoiceNo: "FP-1",
              amountInvoiced: 1000,
              amountPaid: 0,
              amountOpen: 1000,
              dueDate: "2026-07-14",
              status: "overdue",
              owner: "A",
              nextNode: "+7",
              riskFlags: ["long_terms"],
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
      const previewJson = JSON.parse(preview.stdout) as { files: string[] };
      expect(previewJson.files.some((f) => f.endsWith("ar-board.md"))).toBe(true);

      const exported = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", outputDir, "--mode", "export"],
        { encoding: "utf8" },
      );
      expect(exported.status, exported.stderr).toBe(0);
      const exportJson = JSON.parse(exported.stdout) as { files: string[] };
      expect(exportJson.files.some((f) => f.includes("应收台账_"))).toBe(true);
      expect(exportJson.files.some((f) => f.includes("催收话术_"))).toBe(true);
      expect(
        exportJson.files.some((f) => f.endsWith("ar-daily-board.json")),
      ).toBe(true);
      const proposal = readFileSync(
        join(outputDir, "automations/proposals/ar-daily-board.json"),
        "utf8",
      );
      expect(proposal).toContain('"scene": "office"');
      expect(proposal).toContain("应收催收");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
