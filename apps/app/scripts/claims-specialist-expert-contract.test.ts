import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/claims-specialist",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("claims-specialist expert contract", () => {
  test("ships claim protocol, executor, and aligned manifests", () => {
    expect(readExpertFile("skills/claims-case/SKILL.md")).toContain(
      "build_claim_artifacts.py",
    );
    expect(readExpertFile("skills/claims-case/references/data-protocol.md")).toContain(
      "不得自动认责",
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

  test("exports evidence gaps, conditional liability, dual scripts, and progress", () => {
    const script = join(expertRoot, "skills/claims-case/scripts/build_claim_artifacts.py");
    const outputDir = mkdtempSync(join(tmpdir(), "claims-specialist-"));
    try {
      const inputPath = join(outputDir, "claim-case.json");
      cpSync(join(import.meta.dir, "fixtures/claims-specialist/claim-case.json"), inputPath);
      const exported = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", outputDir, "--mode", "export"],
        { encoding: "utf8" },
      );
      expect(exported.status, exported.stderr).toBe(0);
      const body = JSON.parse(exported.stdout) as { missing: string[]; files: string[] };
      expect(body.missing).toContain("loading_photos");
      expect(body.missing).toContain("driver_statement");
      expect(body.missing).toContain("value_proof");
      expect(body.files.some((file) => file.includes("理赔进度_CLM-YD8899.csv"))).toBe(true);
      expect(
        readFileSync(join(outputDir, ".process/liability-draft.md"), "utf8"),
      ).toContain("不是法律结论，不确认唯一责任方");
      expect(
        readFileSync(join(outputDir, "客户沟通话术_CLM-YD8899.md"), "utf8"),
      ).toContain("不承认全责、不承诺赔付金额");
      expect(
        readFileSync(join(outputDir, "保司报案提纲_CLM-YD8899.md"), "utf8"),
      ).toContain("不自动向保司提交");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
