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

/** Still using the shared colleague-intro package shape (not yet refactored). */
const LEGACY_COLLEAGUE_INTRO_EXPERTS = [
  "fleet-management-specialist",
  "fulfillment-specialist",
  "logistics-finance-specialist",
] as const;

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
  "fleet-management-specialist":
    "说说看，今天有什么车队或派车上的事儿需要处理？",
  "fulfillment-specialist":
    "说说看，今天有什么运输上的事儿需要处理？",
  "logistics-finance-specialist":
    "说说看，今天有什么对账或结算上的事儿需要处理？",
};

const COLLEAGUE_OPENINGS: Record<string, string> = {
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

type ExpertManifest = {
  displayDescription: { zh: string };
  greeting: { zh: string };
  quickPrompts: Array<{ zh: string }>;
  tags: Array<{ zh: string }>;
  skills: string[];
  promptTemplates: string;
};

type PromptTemplate = {
  title: { zh: string; en: string };
  template: { zh: string; en: string };
  requiredSlots: { zh: string[]; en: string[] };
  conditionalSlots: { zh: string[]; en: string[] };
};

function readManifest(packageName: string): ExpertManifest {
  return JSON.parse(
    readFileSync(
      join(pluginsRoot, packageName, ".expert-plugin/plugin.json"),
      "utf8",
    ),
  ) as ExpertManifest;
}

function readAgent(packageName: string): string {
  return readFileSync(
    join(pluginsRoot, packageName, "agents", `${packageName}.md`),
    "utf8",
  );
}

function assertPackageShape(packageName: string, skillNames: readonly string[]) {
  const packageRoot = join(pluginsRoot, packageName);
  const manifest = readManifest(packageName);
  expect(
    JSON.parse(
      readFileSync(join(packageRoot, ".onmyagent-plugin/plugin.json"), "utf8"),
    ),
  ).toEqual(manifest);
  expect(skillNames.length).toBeGreaterThanOrEqual(3);
  expect(skillNames.length).toBeLessThanOrEqual(5);
  expect(manifest.skills).toEqual(
    skillNames.map((skillName) => `./skills/${skillName}`),
  );

  const templates = JSON.parse(
    readFileSync(join(packageRoot, manifest.promptTemplates), "utf8"),
  ) as PromptTemplate[];
  expect(templates.length).toBeGreaterThanOrEqual(3);
  expect(templates.length).toBeLessThanOrEqual(5);
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

  const agentText = readAgent(packageName);
  const skillTexts = skillNames.map((skillName) =>
    readFileSync(join(packageRoot, "skills", skillName, "SKILL.md"), "utf8"),
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
  expect(agentText).toContain("document-processing");

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

  return { manifest, agentText, skillTexts, templates };
}

describe("logistics AI efficiency expert capabilities", () => {
  for (const [packageName, skillNames] of Object.entries(EFFICIENCY_EXPERTS)) {
    test(`${packageName} package shape stays consistent`, () => {
      assertPackageShape(packageName, skillNames);
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

describe("order-dispatch-specialist agent contract (refactored)", () => {
  const packageName = "order-dispatch-specialist";
  const skillNames = EFFICIENCY_EXPERTS[packageName];

  test("agent.md uses playbook structure with hard rules and delivery skeleton", () => {
    const { manifest, agentText } = assertPackageShape(packageName, skillNames);

    for (const section of [
      "## 身份与风格",
      "## 能力",
      "## 自我介绍",
      "## 必须遵守",
      "## 沟通范例",
      "## 专业知识",
      "## 工作流程",
      "## 交付标准",
      "## 与其他专家的边界",
      "## 成功标准",
    ]) {
      expect(agentText).toContain(section);
    }

    // Domain coverage for linehaul / city / cold-chain / 3PL CS work
    for (const keyword of [
      "专线",
      "城配",
      "冷链",
      "3PL",
      "计费重",
      "成本参考",
      "最低可报",
      "建议客户价",
      "温度区间",
      "多点",
      "车队管理",
      "物流运输",
      "货运财务",
    ]) {
      expect(agentText).toContain(keyword);
    }

    // Hard rules + self-intro protocol (not a fixed three-paragraph script)
    expect(agentText).toContain("无依据不瞎报");
    expect(agentText).toContain("外部动作用户拍板");
    expect(agentText).toContain("严格边界");
    expect(agentText).toContain("一票货交付骨架");
    expect(agentText).toContain("## 这票结论");
    expect(agentText).toContain("用户问“你能做什么”");
    expect(agentText).toContain("不要背诵技能英文名");
    expect(agentText).toContain("允许按对话情境微调");
    expect(agentText).toContain(":::followups");
    expect(agentText).toContain("可点击选项");

    // Colleague tone without legacy forced phrases
    expect(agentText).toContain("行，我先把这票信息捋一下");
    expect(agentText).toContain("先接住事情，再开始干活");
    expect(agentText).not.toContain("把它当成新同事见面，直接回复下面三段话");
    expect(agentText).not.toContain("无需调用技能");
    expect(agentText).not.toContain(
      "实际文件统一由会话底部的本轮产物卡片展示和打开",
    );
    expect(agentText).not.toContain("如果生成了文件，在最终回复里清楚写出文件名和保存位置");
    expect(agentText).not.toContain("工作目录");

    // Marketplace greeting stays natural and points users to send materials
    expect(manifest.greeting.zh).toStartWith("你好！");
    expect(manifest.greeting.zh).toContain("货运客服专家");
    expect(manifest.greeting.zh).toContain("聊天");
    expect(manifest.greeting.zh.length).toBeGreaterThan(40);
    expect(agentText).toContain("货运客服专家");
  });

  test("skills stay aligned to four CS capabilities plus shared document-processing", () => {
    const agentText = readAgent(packageName);
    expect(agentText).toContain("整理发货信息");
    expect(agentText).toContain("检查缺项");
    expect(agentText).toContain("建议报价");
    expect(agentText).toContain("核对订单");
    expect(agentText).toContain("`document-processing`");

    const skillBoundaryHints: Record<string, string[]> = {
      "shipment-data-structuring": ["提取与归表", "## 边界"],
      "shipment-information-audit": ["补问", "## 边界", "不编造报价"],
      "freight-quote-analysis": ["不编造", "## 边界", "成本参考"],
      "order-quote-consistency": ["交叉核对", "## 边界", "车队管理"],
    };

    for (const skillName of skillNames) {
      const skillText = readFileSync(
        join(pluginsRoot, packageName, "skills", skillName, "SKILL.md"),
        "utf8",
      );
      const sceneAware =
        skillText.includes("冷链") ||
        skillText.includes("城配") ||
        skillText.includes("专线") ||
        skillText.includes("温控");
      expect(sceneAware).toBe(true);
      for (const hint of skillBoundaryHints[skillName] ?? []) {
        expect(skillText).toContain(hint);
      }
    }
  });
});


describe("legacy logistics colleague-intro experts", () => {
  for (const packageName of LEGACY_COLLEAGUE_INTRO_EXPERTS) {
    test(`${packageName} keeps shared colleague-intro contract`, () => {
      const skillNames = EFFICIENCY_EXPERTS[packageName];
      const { manifest, agentText } = assertPackageShape(
        packageName,
        skillNames,
      );

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
      expect(agentText).toContain("完成后只推荐最多两个");
      expect(agentText).toContain("不向用户展示内部技能英文名");
      expect(agentText).toContain(
        "实际文件统一由会话底部的本轮产物卡片展示和打开",
      );
      expect(agentText).not.toContain(
        "如果生成了文件，在最终回复里清楚写出文件名和保存位置",
      );
      expect(agentText).not.toContain("输出文件");
      expect(agentText).not.toContain("打开产物");
      expect(agentText).not.toContain("工作目录");
      expect(manifest.greeting.zh).toEndWith(
        NATURAL_GREETING_ENDINGS[packageName] ?? "",
      );
      expect(manifest.greeting.zh).toStartWith("你好！");
      expect(manifest.greeting.zh).toContain("我是你的");
      expect(manifest.greeting.zh).toContain("\n\n无论是");
      expect(agentText).toContain(manifest.greeting.zh);
      expect(agentText).toContain(
        "把它当成新同事见面，直接回复下面三段话",
      );
      expect(agentText).toContain(
        "使用 `document-processing` 技能处理文件",
      );
      expect(agentText).toContain("仍按本专家的业务技能判断");
    });
  }
});
