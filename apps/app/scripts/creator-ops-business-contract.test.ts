import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const expertsRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins",
);

const BUSINESS_SKILLS = {
  "kol-media-specialist": [
    "kol-brief-structuring",
    "kol-talent-ranking",
    "kol-data-clean-merge",
    "kol-media-execution-board",
    "kol-pitch-readiness-check",
  ],
  "kol-content-ops-specialist": [
    "xhs-script-assistant",
    "kol-content-delivery-tracker",
    "rebate-contract-generator",
    "rebate-contract-checker",
    "kol-reputation-monitor",
  ],
  "kol-project-review-specialist": [
    "kol-data-clean-merge",
    "kol-margin-effect-analysis",
    "kol-content-performance-attribution",
    "kol-project-review-framework",
    "kol-review-report-audit",
  ],
} as const;

const REQUIRED_MARKERS: Record<string, string[]> = {
  "kol-media-specialist": [
    "种草目标",
    "目标人群",
    "产品卖点",
    "内容方向",
    "达人要求",
    "交付形式",
    "时间节点",
    "待确认问题",
    "风险点",
    "媒介 → 达人运营",
  ],
  "kol-content-ops-specialist": [
    "快速扫描",
    "正式审核",
    "批量审核",
    "合同生成",
    "三方核对",
    "内容履约",
    "达人运营 → 项目复盘",
  ],
  "kol-project-review-specialist": [
    "目标达成",
    "内容表现",
    "达人表现",
    "投流表现",
    "执行协作",
    "客户反馈",
    "问题原因",
    "下次优化",
    "相关性不等于因果",
  ],
};

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("creator ops experts business contract", () => {
  for (const [expertName, skillNames] of Object.entries(BUSINESS_SKILLS)) {
    test(`${expertName} exposes five scenario-specific skills`, () => {
      const packageRoot = join(expertsRoot, expertName);
      const expertManifest = readJson(
        join(packageRoot, ".expert-plugin/plugin.json"),
      );
      const runtimeManifest = readJson(
        join(packageRoot, ".onmyagent-plugin/plugin.json"),
      );

      expect(runtimeManifest).toEqual(expertManifest);
      expect(expertManifest.skills).toEqual(
        skillNames.map((skillName) => `./skills/${skillName}`),
      );

      const agentText = readFileSync(
        join(packageRoot, "agents", `${expertName}.md`),
        "utf8",
      );
      const frontmatterSkills = agentText.match(/skills:\s*\[([^\]]+)\]/);
      expect(
        frontmatterSkills?.[1].split(",").map((value) => value.trim()),
      ).toEqual([...skillNames, "document-processing", "create-automation"]);

      const templates = readJson(
        join(packageRoot, "prompt-templates.json"),
      ) as unknown as Array<{ id: string }>;
      expect(templates.map((template) => template.id)).toEqual(skillNames);

      for (const skillName of skillNames) {
        const skillFile = join(packageRoot, "skills", skillName, "SKILL.md");
        expect(existsSync(skillFile)).toBe(true);
        if (existsSync(skillFile)) {
          expect(readFileSync(skillFile, "utf8")).toContain(`name: ${skillName}`);
        }
      }

      for (const marker of REQUIRED_MARKERS[expertName] ?? []) {
        expect(agentText).toContain(marker);
      }
    });
  }

  test("superseded broad and legacy skills are absent from the three packages", () => {
    for (const expertName of Object.keys(BUSINESS_SKILLS)) {
      const skillsRoot = join(expertsRoot, expertName, "skills");
      expect(existsSync(join(skillsRoot, "kol-content-risk-checklist"))).toBe(
        false,
      );
    }

    const creatorOpsSkills = join(
      expertsRoot,
      "kol-content-ops-specialist",
      "skills",
    );
    expect(existsSync(join(creatorOpsSkills, "kol-script-risk-review"))).toBe(
      false,
    );
    expect(existsSync(join(creatorOpsSkills, "kol-rebate-invoice-audit"))).toBe(
      false,
    );
  });

  test("script review contract covers quick, formal, batch, and evidence-gated checks", () => {
    const skillRoot = join(
      expertsRoot,
      "kol-content-ops-specialist/skills/xhs-script-assistant",
    );
    const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    const reviewText = readFileSync(
      join(skillRoot, "references/review-prompt-template.md"),
      "utf8",
    );
    for (const marker of [
      "不做全文重写",
      "6 字段",
      "只做1次",
      "每个达人一个",
      "爆文基因",
      "医疗化",
      "绝对化",
      "广告腔",
      "客户偏好",
    ]) {
      expect(skillText).toContain(marker);
    }
    expect(reviewText).toContain("超出即 **P0**");
  });
});
