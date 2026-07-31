import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/fulfillment-specialist",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("fulfillment specialist expert contract", () => {
  test("publishes five AI-assisted fulfillment capabilities", () => {
    const manifest = JSON.parse(
      readExpertFile(".expert-plugin/plugin.json"),
    ) as {
      displayName: { zh: string };
      profession: { zh: string };
      skills: string[];
    };
    expect(JSON.parse(readExpertFile(".onmyagent-plugin/plugin.json"))).toEqual(
      manifest,
    );
    expect(manifest.displayName.zh).toBe("物流运输专家");
    expect(manifest.profession.zh).toBe("物流运输专家");
    expect(manifest.skills).toEqual([
      "./skills/transit-update-structuring",
      "./skills/customer-update-drafting",
      "./skills/exception-evidence-review",
      "./skills/pod-document-audit",
      "./skills/fulfillment-performance-analysis",
    ]);
  });

  test("covers progress, communication, exceptions, POD, and performance analysis", () => {
    const content = [
      readExpertFile("agents/fulfillment-specialist.md"),
      readExpertFile("skills/transit-update-structuring/SKILL.md"),
      readExpertFile("skills/customer-update-drafting/SKILL.md"),
      readExpertFile("skills/exception-evidence-review/SKILL.md"),
      readExpertFile("skills/pod-document-audit/SKILL.md"),
      readExpertFile("skills/fulfillment-performance-analysis/SKILL.md"),
    ].join("\n");
    for (const expected of [
      "最新进度",
      "客户通知",
      "证据",
      "回单",
      "经常晚到",
    ]) {
      expect(content).toContain(expected);
    }
    expect(content).toContain("## 对话引导");
    expect(content).toContain("完成后只推荐最多两个");
    for (const forbidden of [
      "logistics_ledger",
      "record_temperature",
      "update_pod",
      "inlineWidget",
      ".process/",
    ]) {
      expect(content).not.toContain(forbidden);
    }
  });

  test("provides four concise editable prompt templates", () => {
    const templates = JSON.parse(
      readExpertFile("prompt-templates.json"),
    ) as Array<{
      id: string;
      template: { zh: string };
      requiredSlots: { zh: string[] };
      conditionalSlots: { zh: string[] };
    }>;
    expect(templates).toHaveLength(4);
    for (const template of templates) {
      const placeholders = template.template.zh.match(/<[^<>\r\n]+>/g) ?? [];
      expect(placeholders.length).toBeGreaterThanOrEqual(2);
      expect(placeholders.length).toBeLessThanOrEqual(3);
      expect([
        ...template.requiredSlots.zh,
        ...template.conditionalSlots.zh,
      ]).toHaveLength(placeholders.length);
    }
  });
});
