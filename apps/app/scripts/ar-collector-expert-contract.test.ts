import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/logistics-finance-specialist",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("ar-collector expert contract", () => {
  test("ships ledger protocol, automation playbook, and artifact script", () => {
    const agent = readExpertFile("agents/logistics-finance-specialist.md");
    const skill = readExpertFile("skills/ar-collection/SKILL.md");
    const protocol = readExpertFile("skills/ar-collection/references/data-protocol.md");
    const automations = readExpertFile(
      "skills/ar-collection/references/onmyagent-automations.md",
    );
    const readme = readExpertFile("README.md");
    const expertManifest = readExpertFile(".expert-plugin/plugin.json");
    const onMyAgentManifest = readExpertFile(".onmyagent-plugin/plugin.json");

    expect(onMyAgentManifest).toBe(expertManifest);
    expect(JSON.parse(expertManifest).version).toBe("1.0.0");
    expect(agent).toContain("skills: [pod-recon, billing-case, ar-collection, introduce-logistics-finance]");
    expect(agent).toContain("回款催收");
    expect(agent).toContain("不自动入账");
    expect(skill).toContain("--mode preview");
    expect(skill).toContain("--mode export");
    expect(skill).toContain("onmyagent-automations.md");
    expect(protocol).toContain("ar-ledger.json");
    expect(protocol).toContain("automations/proposals");
    expect(automations).toContain("createAutomation");
    expect(automations).toContain('"scene": "office"');
    expect(readme).toContain("回单对账、开票管理和回款催收");
  });

  test("preview and export scripts write process board and result artifacts", () => {
    const script = join(
      expertRoot,
      "skills/ar-collection/scripts/build_ar_artifacts.py",
    );
    const outputDir = mkdtempSync(join(tmpdir(), "ar-collector-"));
    const capabilityDir = join(outputDir, "回款催收");
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
              dueDate: "2026-08-14",
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
        [script, "--input", inputPath, "--output-dir", capabilityDir, "--mode", "preview"],
        { encoding: "utf8" },
      );
      expect(preview.status, preview.stderr).toBe(0);
      const previewJson = JSON.parse(preview.stdout) as { files: string[] };
      expect(previewJson.files.some((f) => f.endsWith("ar-preview.html"))).toBe(true);

      const exported = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", capabilityDir, "--mode", "export"],
        { encoding: "utf8" },
      );
      expect(exported.status, exported.stderr).toBe(0);
      const exportJson = JSON.parse(exported.stdout) as { files: string[] };
      expect(exportJson.files.some((f) => f.includes("应收台账_"))).toBe(true);
      expect(exportJson.files.some((f) => f.includes("催收话术_"))).toBe(true);
      expect(
        exportJson.files.some((f) => f.endsWith("ar-daily-board.json")),
      ).toBe(true);
      expect(
        exportJson.files.some((f) => f.endsWith("ar-Acme-FP-1-next.json")),
      ).toBe(true);
      const proposal = readFileSync(
        join(capabilityDir, "automations/proposals/ar-daily-board.json"),
        "utf8",
      );
      expect(proposal).toContain('"scene": "office"');
      expect(proposal).toContain("应收催收");
      const invoiceProposal = readFileSync(
        join(capabilityDir, "automations/proposals/ar-Acme-FP-1-next.json"),
        "utf8",
      );
      expect(invoiceProposal).toContain('"mode": "once"');
      expect(invoiceProposal).toContain('"invoiceNo": "FP-1"');
      expect(invoiceProposal).toContain("不自动发送");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
