import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const pluginsRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins",
);

const EFFICIENCY_EXPERTS = {
  "order-dispatch-specialist": [
    "shipment-data-structuring",
    "shipment-information-audit",
    "freight-quote-analysis",
    "order-quote-consistency",
  ],
  "fleet-management-specialist": [
    "fleet-data-consolidation",
    "vehicle-candidate-ranking",
    "dispatch-readiness-audit",
    "dispatch-brief-drafting",
    "fleet-efficiency-analysis",
  ],
  "fulfillment-specialist": [
    "transit-update-structuring",
    "customer-update-drafting",
    "exception-evidence-review",
    "pod-document-audit",
    "fulfillment-performance-analysis",
  ],
  "logistics-finance-specialist": [
    "settlement-data-consolidation",
    "charge-variance-audit",
    "settlement-readiness-audit",
    "invoice-information-audit",
    "freight-profit-analysis",
  ],
} as const;

const SCRIPT_SKILLS = new Map([
  ["shipment-data-structuring", "normalize_shipments.py"],
  ["fleet-data-consolidation", "consolidate_fleet.py"],
  ["transit-update-structuring", "build_transit_timeline.py"],
  ["settlement-data-consolidation", "reconcile_settlement.py"],
]);

const FIRST_TASK_CARDS: Record<string, string[]> = {
  "order-dispatch-specialist": [
    "整理客户发来的发货信息",
    "看看发货信息还缺什么",
    "帮我算怎么报价",
  ],
  "fleet-management-specialist": [
    "整理车辆和司机表",
    "帮我挑合适的车",
    "派车前帮我检查",
  ],
  "fulfillment-specialist": [
    "整理货现在到哪里了",
    "帮我写客户进度通知",
    "整理运输异常和证据",
  ],
  "logistics-finance-specialist": [
    "把运单和账单合到一起",
    "找出哪些金额对不上",
    "检查每票能不能结账",
  ],
};

const NATURAL_GREETING_ENDINGS: Record<string, string> = {
  "order-dispatch-specialist":
    "说说看，今天有什么接单或报价上的事儿需要处理？",
  "fleet-management-specialist":
    "说说看，今天有什么车队或派车上的事儿需要处理？",
  "fulfillment-specialist":
    "说说看，今天有什么运输上的事儿需要处理？",
  "logistics-finance-specialist":
    "说说看，今天有什么对账或结算上的事儿需要处理？",
};

const COLLEAGUE_OPENINGS: Record<string, string> = {
  "order-dispatch-specialist": "行，我先把这票信息捋一下",
  "fleet-management-specialist": "行，我先按这张单挑几辆合适的",
  "fulfillment-specialist": "我先把群里的时间线捋出来",
  "logistics-finance-specialist": "行，我先按运单号把这几张表对起来",
};

const JARGON_TO_AVOID = [
  "原始材料",
  "结构化",
  "完整性",
  "一致性复核",
  "履约",
  "审计",
  "匹配精度",
  "业务维度",
  "复盘框架",
] as const;

const REMOVED_SKILLS = [
  "order-entry",
  "freight-quote",
  "capacity-dispatch",
  "vehicle-readiness",
  "transit-tracking",
  "exception-pod",
  "pod-recon",
  "billing-case",
  "capacity-pool",
  "fuel-audit",
  "affiliate-fleet",
  "claims-case",
  "cold-chain-monitoring",
  "ar-collection",
  "introduce-order-dispatch",
  "introduce-fleet-management",
  "introduce-fulfillment",
  "introduce-logistics-finance",
] as const;

describe("logistics AI efficiency expert capabilities", () => {
  for (const [packageName, skillNames] of Object.entries(EFFICIENCY_EXPERTS)) {
    test(`${packageName} exposes focused, file-driven productivity skills`, () => {
      const packageRoot = join(pluginsRoot, packageName);
      const manifest = JSON.parse(
        readFileSync(join(packageRoot, ".expert-plugin/plugin.json"), "utf8"),
      ) as {
        displayDescription: { zh: string };
        greeting: { zh: string };
        quickPrompts: Array<{ zh: string }>;
        tags: Array<{ zh: string }>;
        skills: string[];
        promptTemplates: string;
      };
      expect(
        JSON.parse(
          readFileSync(
            join(packageRoot, ".onmyagent-plugin/plugin.json"),
            "utf8",
          ),
        ),
      ).toEqual(manifest);
      expect(skillNames.length).toBeGreaterThanOrEqual(3);
      expect(skillNames.length).toBeLessThanOrEqual(5);
      expect(manifest.skills).toEqual(
        skillNames.map((skillName) => `./skills/${skillName}`),
      );

      const templates = JSON.parse(
        readFileSync(join(packageRoot, manifest.promptTemplates), "utf8"),
      ) as Array<{
        title: { zh: string; en: string };
        template: { zh: string; en: string };
        requiredSlots: { zh: string[]; en: string[] };
        conditionalSlots: { zh: string[]; en: string[] };
      }>;
      expect(templates).toHaveLength(4);
      expect(templates.slice(0, 3).map((template) => template.title.zh)).toEqual(
        FIRST_TASK_CARDS[packageName],
      );
      for (const template of templates) {
        for (const locale of ["zh", "en"] as const) {
          const placeholders =
            template.template[locale].match(/<[^<>\r\n]+>/g) ?? [];
          expect(placeholders.length).toBeGreaterThanOrEqual(2);
          expect(placeholders.length).toBeLessThanOrEqual(3);
          expect([
            ...template.requiredSlots[locale],
            ...template.conditionalSlots[locale],
          ]).toHaveLength(placeholders.length);
        }
      }

      const agentText = readFileSync(
        join(packageRoot, "agents", `${packageName}.md`),
        "utf8",
      );
      const skillTexts = skillNames.map((skillName) =>
        readFileSync(
          join(packageRoot, "skills", skillName, "SKILL.md"),
          "utf8",
        ),
      );
      const packageText = [
        readFileSync(join(packageRoot, "README.md"), "utf8"),
        agentText,
        ...skillTexts,
      ].join("\n");
      for (const forbidden of [
        "inlineWidget",
        ".process/",
        "logistics_ledger",
        "record_temperature",
        "update_pod",
        "render_capability_map",
      ]) {
        expect(packageText).not.toContain(forbidden);
      }
      expect(agentText).toContain("## 对话引导");
      expect(agentText).toContain("## 像同事一样协作");
      expect(agentText).toContain("物流部里一起");
      expect(agentText).toContain("先接住事情，再开始干活");
      expect(agentText).toContain("不用客服腔、培训口吻或系统提示口吻");
      expect(agentText).toContain("不用每轮重新介绍能力或复述整段需求");
      expect(agentText).toContain(
        "直接根据本文件的“能力”回答，无需调用技能",
      );
      expect(agentText).toContain("一次问清最关键的两三个问题");
      expect(agentText).toContain("不过度寒暄");
      expect(agentText).toContain(COLLEAGUE_OPENINGS[packageName] ?? "");
      expect(agentText).toContain("最多三个选项");
      expect(agentText).toContain("先");
      expect(agentText).toContain("完成后只推荐最多两个");
      expect(agentText).toContain("不向用户展示内部技能英文名");
      expect(agentText).toContain("实际文件统一由会话底部的本轮产物卡片展示和打开");
      expect(agentText).not.toContain(
        "如果生成了文件，在最终回复里清楚写出文件名和保存位置",
      );
      expect(agentText).not.toContain("输出文件");
      expect(agentText).not.toContain("打开产物");
      expect(agentText).not.toContain("工作目录");
      expect(manifest.greeting.zh).toEndWith(
        NATURAL_GREETING_ENDINGS[packageName] ?? "",
      );

      const userFacingCopy = [
        readFileSync(join(packageRoot, "README.md"), "utf8"),
        manifest.displayDescription.zh,
        manifest.greeting.zh,
        ...manifest.quickPrompts.map((prompt) => prompt.zh),
        ...manifest.tags.map((tag) => tag.zh),
        ...templates.flatMap((template) => [
          template.title.zh,
          template.template.zh,
        ]),
        ...skillTexts,
      ].join("\n");
      for (const jargon of JARGON_TO_AVOID) {
        expect(userFacingCopy).not.toContain(jargon);
      }

      const frontmatterSkills = agentText.match(/skills:\s*\[([^\]]+)\]/);
      expect(
        frontmatterSkills?.[1].split(",").map((value) => value.trim()),
      ).toEqual([...skillNames, "document-processing"]);
      expect(agentText).toContain(
        "使用 `document-processing` 技能处理文件",
      );
      expect(agentText).toContain("仍按本专家的业务技能判断");

      for (const [index, skillName] of skillNames.entries()) {
        const skillRoot = join(packageRoot, "skills", skillName);
        const skillText = skillTexts[index];
        expect(skillText).toContain(`name: ${skillName}`);
        expect(skillText).toContain("## 输入");
        expect(skillText).toContain("## 处理");
        expect(skillText).toContain("## 输出");
        expect(existsSync(join(skillRoot, "references"))).toBe(false);
        expect(existsSync(join(skillRoot, "assets"))).toBe(false);

        const scriptName = SCRIPT_SKILLS.get(skillName);
        const scriptsRoot = join(skillRoot, "scripts");
        if (scriptName) {
          expect(readdirSync(scriptsRoot)).toEqual([scriptName]);
        } else {
          expect(existsSync(scriptsRoot)).toBe(false);
        }
      }
    });
  }

  test("old operational and preview-oriented skills are absent", () => {
    for (const packageName of Object.keys(EFFICIENCY_EXPERTS)) {
      const skillsRoot = join(pluginsRoot, packageName, "skills");
      for (const removed of REMOVED_SKILLS) {
        expect(existsSync(join(skillsRoot, removed))).toBe(false);
      }
    }
  });
});
