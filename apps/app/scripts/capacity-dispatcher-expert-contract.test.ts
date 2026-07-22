import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/capacity-dispatcher",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("capacity-dispatcher expert contract", () => {
  test("ships dispatch protocol, executor, and aligned manifests", () => {
    expect(readExpertFile("skills/capacity-pool/SKILL.md")).toContain(
      "build_dispatch_artifacts.py",
    );
    expect(
      readExpertFile("skills/capacity-pool/references/data-protocol.md"),
    ).toContain("stale、非 available");
    const onMyAgentManifest = JSON.parse(
      readExpertFile(".onmyagent-plugin/plugin.json"),
    ) as { version: string };
    const expertManifest = JSON.parse(
      readExpertFile(".expert-plugin/plugin.json"),
    ) as { version: string };
    expect(onMyAgentManifest).toEqual(expertManifest);
    expect(onMyAgentManifest.version).toBe("1.2.0");
  });

  test("exports ranked candidates while rejecting stale and insufficient capacity", () => {
    const script = join(
      expertRoot,
      "skills/capacity-pool/scripts/build_dispatch_artifacts.py",
    );
    const outputDir = mkdtempSync(join(tmpdir(), "capacity-dispatcher-"));
    try {
      const inputPath = join(outputDir, "capacity-dispatch.json");
      cpSync(
        join(import.meta.dir, "fixtures/capacity-dispatcher/capacity-dispatch.json"),
        inputPath,
      );
      const exported = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", outputDir, "--mode", "export"],
        { encoding: "utf8" },
      );
      expect(exported.status, exported.stderr).toBe(0);
      const body = JSON.parse(exported.stdout) as {
        candidates: Array<{ plate: string; freshness: string; score: number }>;
        rejected: Array<{ plate: string; reasons: string[] }>;
        files: string[];
      };
      expect(body.candidates.map((candidate) => candidate.plate)).toEqual([
        "粤B10001",
        "粤B10002",
      ]);
      expect(body.candidates[0]?.score).toBeGreaterThan(body.candidates[1]?.score ?? 0);
      expect(body.candidates[1]?.freshness).toBe("aging");
      expect(
        body.rejected.find((item) => item.plate === "粤B10003")?.reasons,
      ).toContain("运力信息 stale，须先确认");
      expect(
        body.rejected.find((item) => item.plate === "粤B10004")?.reasons,
      ).toContain("剩余载重不足");
      expect(body.files.some((file) => file.includes("运力调配方案_D-001.md"))).toBe(true);
      expect(
        readFileSync(join(outputDir, "运力调配方案_D-001.md"), "utf8"),
      ).toContain("不会自动锁车、改状态或发送外部消息");
      expect(
        readFileSync(join(outputDir, "司机确认话术_D-001.md"), "utf8"),
      ).toContain("仅为草稿，不自动发送");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
