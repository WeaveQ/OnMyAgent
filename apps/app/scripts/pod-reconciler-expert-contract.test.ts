import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/pod-reconciler",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("pod-reconciler expert contract", () => {
  test("ships POD protocol, executor, and aligned manifests", () => {
    expect(readExpertFile("skills/pod-recon/SKILL.md")).toContain(
      "build_pod_recon_artifacts.py",
    );
    expect(readExpertFile("skills/pod-recon/references/data-protocol.md")).toContain(
      "WAIT_VERIFY",
    );
    const onMyAgentManifest = JSON.parse(
      readExpertFile(".onmyagent-plugin/plugin.json"),
    ) as { version: string };
    const expertManifest = JSON.parse(
      readExpertFile(".expert-plugin/plugin.json"),
    ) as { version: string };
    expect(onMyAgentManifest).toEqual(expertManifest);
    expect(onMyAgentManifest.version).toBe("1.1.0");
  });

  test("exports POD gaps, fee totals, controlled variances, and drafts", () => {
    const script = join(
      expertRoot,
      "skills/pod-recon/scripts/build_pod_recon_artifacts.py",
    );
    const outputDir = mkdtempSync(join(tmpdir(), "pod-reconciler-"));
    try {
      const inputPath = join(outputDir, "pod-recon-data.json");
      cpSync(join(import.meta.dir, "fixtures/pod-reconciler/pod-recon-data.json"), inputPath);
      const exported = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", outputDir, "--mode", "export"],
        { encoding: "utf8" },
      );
      expect(exported.status, exported.stderr).toBe(0);
      const body = JSON.parse(exported.stdout) as {
        rows: Array<{ waybillNo: string; recommendation: string; reasonCode: string }>;
        unmatched: Array<{ reason: string }>;
        totals: { own: number; counterparty: number; variance: number };
        files: string[];
      };
      expect(body.totals).toEqual({ own: 5500, counterparty: 8101, variance: 2601 });
      expect(body.rows.find((row) => row.waybillNo === "WB-002")?.recommendation).toBe(
        "暂缓：费用差异待核",
      );
      expect(body.rows.find((row) => row.waybillNo === "WB-003")?.recommendation).toBe(
        "人工拍板：大额差异",
      );
      expect(body.rows.find((row) => row.waybillNo === "WB-003")?.reasonCode).toBe(
        "DUPLICATE_LINE",
      );
      expect(body.unmatched[0]?.reason).toContain("waybillNo");
      expect(body.files.some((file) => file.includes("对账单_2026-07.csv"))).toBe(true);
      expect(
        readFileSync(join(outputDir, ".process/reconciliation-draft.md"), "utf8"),
      ).toContain("不代表已入账、已付款或已更新回单状态");
      expect(
        readFileSync(join(outputDir, "催回单话术_2026-07.md"), "utf8"),
      ).toContain("仅为催办草稿，不自动发送");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
