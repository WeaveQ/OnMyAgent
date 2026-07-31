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

/** Shared playbook sections every logistics expert must keep. */
const PLAYBOOK_SECTIONS = [
  "## 身份与风格",
  "## 能力",
  "## 自我介绍",
  "## 必须遵守",
  "## 按诉求交付（重要）",
  "## 定时任务（用户需要时）",
  "## 沟通范例",
  "## 专业知识",
  "## 工作流程",
  "## 文档能力（用户需要时）",
  "## 交付标准",
  "## 与其他专家的边界",
  "## 成功标准",
] as const;

const PLAYBOOK_HARD_MARKERS = [
  "只输出约三小段口语",
  "禁止在自我介绍里出现",
  "我都能帮你搞定",
  "外部动作用户拍板",
  "严格边界",
  "对内说法日常化",
  "按用户本轮诉求交付，不擅自加戏",
  ":::followups",
  "可点击选项",
  "`document-processing`",
  "`create-automation`",
  "automations/proposals",
  "只有用户在 OnMyAgent 里确认后才算真正创建",
  "文件路径",
  "extract-sheets",
  "write-xlsx",
  "产物卡才会出现",
  "禁止**只写「已生成 xxx.xlsx」",
  "不要列长 bullet",
  "也不要再往后面加边界段",
] as const;

const PLAYBOOK_BANNED = [
  "把它当成新同事见面，直接回复下面三段话",
  "无需调用技能",
  "实际文件统一由会话底部的本轮产物卡片展示和打开",
  "如果生成了文件，在最终回复里清楚写出文件名和保存位置",
  "工作目录",
] as const;

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  "order-dispatch-specialist": [
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
    "货运客服专家",
    "车队管理",
    "物流运输",
    "货运财务",
    "无依据不瞎报",
    "一票货交付骨架",
  ],
  "fleet-management-specialist": [
    "专线",
    "城配",
    "冷链",
    "3PL",
    "货运调度分析",
    "挑车",
    "派车前检查",
    "证件",
    "空驶",
    "车队管理专家",
    "货运客服",
    "物流运输",
    "货运财务",
    "无依据不瞎派",
    "write-xlsx",
    "产物卡才会出现",
  ],
  "fulfillment-specialist": [
    "专线",
    "城配",
    "冷链",
    "3PL",
    "在途",
    "送达风险",
    "路况",
    "签收回单",
    "异常",
    "物流运输专家",
    "货运客服",
    "车队管理",
    "货运财务",
    "无依据不瞎报点",
    "一票在途交付骨架",
  ],
  "logistics-finance-specialist": [
    "专线",
    "城配",
    "冷链",
    "3PL",
    "对账",
    "差额",
    "结算",
    "开票",
    "货运财务专家",
    "货运客服",
    "车队管理",
    "物流运输",
    "无依据不瞎算",
    "一批结算交付骨架",
  ],
};

const COLLEAGUE_OPENINGS: Record<string, string> = {
  "order-dispatch-specialist": "行，我先把这票信息捋一下",
  "fleet-management-specialist": "行，我先按这几张表把车和司机理清楚",
  "fulfillment-specialist": "我先把群里的时间线捋出来",
  "logistics-finance-specialist": "行，我先按运单号把这几张表对起来",
};

const GREETING_TITLE: Record<string, string> = {
  "order-dispatch-specialist": "货运客服专家",
  "fleet-management-specialist": "车队管理专家",
  "fulfillment-specialist": "物流运输专家",
  "logistics-finance-specialist": "货运财务专家",
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
  avatar: string;
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
  expect(manifest.avatar).toBe("avatars/expert.png");
  expect(existsSync(join(packageRoot, "avatars", "expert.png"))).toBe(true);

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
  const declaredSkills =
    frontmatterSkills?.[1].split(",").map((value) => value.trim()) ?? [];
  expect(declaredSkills).toEqual([
    ...skillNames,
    "document-processing",
    "create-automation",
  ]);
  expect(agentText).toContain("document-processing");
  expect(agentText).toContain("create-automation");

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

function assertPlaybookContract(packageName: string) {
  const skillNames = EFFICIENCY_EXPERTS[packageName as keyof typeof EFFICIENCY_EXPERTS];
  const { manifest, agentText } = assertPackageShape(packageName, skillNames);

  for (const section of PLAYBOOK_SECTIONS) {
    expect(agentText).toContain(section);
  }
  for (const marker of PLAYBOOK_HARD_MARKERS) {
    expect(agentText).toContain(marker);
  }
  for (const banned of PLAYBOOK_BANNED) {
    expect(agentText).not.toContain(banned);
  }
  for (const keyword of DOMAIN_KEYWORDS[packageName] ?? []) {
    expect(agentText).toContain(keyword);
  }

  expect(agentText).toContain(COLLEAGUE_OPENINGS[packageName] ?? "");
  expect(agentText).toContain("先接住事情，再开始干活");
  // Delivery skeleton variants: per-load vs batch settlement.
  expect(
    agentText.includes("## 这票结论") || agentText.includes("## 这批结论"),
  ).toBe(true);

  expect(manifest.greeting.zh).toStartWith("你好！");
  expect(manifest.greeting.zh).toContain(GREETING_TITLE[packageName] ?? "");
  expect(manifest.greeting.zh).toContain("\n\n无论是");
  expect(manifest.greeting.zh).toContain("我都能帮你搞定");
  expect(manifest.greeting.zh.length).toBeGreaterThan(40);
  expect(manifest.displayDescription.zh).toContain("定时");
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

describe("logistics expert playbook contract (refactored)", () => {
  for (const packageName of Object.keys(EFFICIENCY_EXPERTS)) {
    test(`${packageName} uses shared playbook structure`, () => {
      assertPlaybookContract(packageName);
    });
  }

  test("order-dispatch-specialist keeps CS skill boundary hints", () => {
    const packageName = "order-dispatch-specialist";
    const skillNames = EFFICIENCY_EXPERTS[packageName];
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
