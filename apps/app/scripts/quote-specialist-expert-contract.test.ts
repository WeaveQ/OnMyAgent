import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/quote-specialist",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("quote-specialist expert contract", () => {
  test("ships executable quote protocol and aligned manifests", () => {
    const skill = readExpertFile("skills/freight-quote/SKILL.md");
    const protocol = readExpertFile("skills/freight-quote/references/data-protocol.md");
    expect(skill).toContain("build_quote_artifacts.py");
    expect(protocol).toContain("底价 = 档位成本");
    const onMyAgentManifest = JSON.parse(
      readExpertFile(".onmyagent-plugin/plugin.json"),
    ) as { version: string };
    const expertManifest = JSON.parse(
      readExpertFile(".expert-plugin/plugin.json"),
    ) as { version: string };
    expect(onMyAgentManifest).toEqual(expertManifest);
    expect(onMyAgentManifest.version).toBe("1.2.0");
  });

  test("preview/export calculate three options and clamp the floor", () => {
    const script = join(
      expertRoot,
      "skills/freight-quote/scripts/build_quote_artifacts.py",
    );
    const outputDir = mkdtempSync(join(tmpdir(), "quote-specialist-"));
    try {
      const inputPath = join(outputDir, "quote-request.json");
      cpSync(
        join(import.meta.dir, "fixtures/quote-specialist/quote-request.json"),
        inputPath,
      );
      const exported = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", outputDir, "--mode", "export"],
        { encoding: "utf8" },
      );
      expect(exported.status, exported.stderr).toBe(0);
      const body = JSON.parse(exported.stdout) as {
        gaps: string[];
        options: Array<{
          key: string;
          floor: number;
          price: number;
          floorClamped: boolean;
        }>;
        files: string[];
      };
      expect(body.gaps).toEqual([]);
      expect(body.options.map((option) => option.key)).toEqual([
        "fastest",
        "balanced",
        "cheapest",
      ]);
      expect(body.options.every((option) => option.price >= option.floor)).toBe(true);
      expect(body.options.find((option) => option.key === "cheapest")?.floorClamped).toBe(true);
      expect(body.files.some((file) => file.includes("报价方案_Q-20260723-001.csv"))).toBe(true);
      const quote = readFileSync(
        join(outputDir, "报价方案_Q-20260723-001.md"),
        "utf8",
      );
      expect(quote).toContain("最快");
      expect(quote).toContain("平衡");
      expect(quote).toContain("最便宜");
      expect(quote).toContain("内部底价不得对外转发");
      expect(
        readFileSync(join(outputDir, "砍价话术_Q-20260723-001.md"), "utf8"),
      ).toContain("不能直接跌破内部底价");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  test("missing cost blocks numeric quotes instead of inventing market prices", () => {
    const script = join(
      expertRoot,
      "skills/freight-quote/scripts/build_quote_artifacts.py",
    );
    const outputDir = mkdtempSync(join(tmpdir(), "quote-specialist-gaps-"));
    try {
      const inputPath = join(outputDir, "quote-request.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          quoteId: "Q-GAP",
          inquiry: {
            origin: "广州",
            destination: "长沙",
            cargoName: "普货",
            weightKg: 1000,
            volumeM3: 5,
            requiredHours: 48,
          },
          costBase: {},
        }),
        "utf8",
      );
      const preview = spawnSync(
        "python3",
        [script, "--input", inputPath, "--output-dir", outputDir, "--mode", "preview"],
        { encoding: "utf8" },
      );
      expect(preview.status, preview.stderr).toBe(0);
      const body = JSON.parse(preview.stdout) as {
        gaps: string[];
        options: Array<{ price: number | null }>;
      };
      expect(body.gaps).toContain("costBase.linehaul");
      expect(body.options.every((option) => option.price === null)).toBe(true);
      expect(
        readFileSync(join(outputDir, ".process/quote-floor-guard.md"), "utf8"),
      ).toContain("BLOCKED");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
