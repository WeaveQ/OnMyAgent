export type TeamWorkflowStageKind =
  | "frame"
  | "investigate"
  | "produce"
  | "verify"
  | "deliver";

type LocalizedPair = { zh: string; en: string };

type TeamWorkflowMember = {
  id: string;
  name: LocalizedPair;
  profession: LocalizedPair;
};

export type TeamWorkflowStage = {
  id: string;
  kind: TeamWorkflowStageKind;
  title: LocalizedPair;
  description: LocalizedPair;
  members: TeamWorkflowMember[];
  deliverables: { zh: string[]; en: string[] };
  checks: { zh: string[]; en: string[] };
};

export type TeamWorkflow = {
  mode: "lead-workflow";
  version: 1;
  leadAgentName: string;
  memberCount: number;
  stages: TeamWorkflowStage[];
};

type StageDefinition = Omit<TeamWorkflowStage, "members">;

const STAGE_DEFINITIONS: Record<TeamWorkflowStageKind, StageDefinition> = {
  frame: {
    id: "frame",
    kind: "frame",
    title: { zh: "澄清与规划", en: "Frame and plan" },
    description: {
      zh: "明确目标、约束、受众和完成标准。",
      en: "Clarify the goal, constraints, audience, and acceptance criteria.",
    },
    deliverables: {
      zh: ["任务框架", "执行重点"],
      en: ["Task frame", "Execution priorities"],
    },
    checks: {
      zh: ["目标与边界明确", "缺失信息已标注"],
      en: ["Goal and boundaries are explicit", "Missing inputs are identified"],
    },
  },
  investigate: {
    id: "investigate",
    kind: "investigate",
    title: { zh: "专业分析", en: "Specialist analysis" },
    description: {
      zh: "用相关成员职责作为分析视角，收集证据并形成判断。",
      en: "Use the relevant member responsibilities as analytical lenses and form evidence-backed judgments.",
    },
    deliverables: {
      zh: ["关键发现", "证据与假设"],
      en: ["Key findings", "Evidence and assumptions"],
    },
    checks: {
      zh: ["事实与推断分离", "重要反例已检查"],
      en: ["Facts are separated from inference", "Material counter-evidence is checked"],
    },
  },
  produce: {
    id: "produce",
    kind: "produce",
    title: { zh: "方案产出", en: "Produce the solution" },
    description: {
      zh: "把分析转化为可用的方案、内容或执行结果。",
      en: "Turn the analysis into a usable solution, artifact, or execution result.",
    },
    deliverables: {
      zh: ["核心产物", "关键决策说明"],
      en: ["Primary deliverable", "Key decision rationale"],
    },
    checks: {
      zh: ["产物回应原始目标", "关键取舍可解释"],
      en: ["The deliverable answers the original goal", "Key tradeoffs are explained"],
    },
  },
  verify: {
    id: "verify",
    kind: "verify",
    title: { zh: "审查与校验", en: "Review and verify" },
    description: {
      zh: "从审查、质量和风险视角发现缺口并修正。",
      en: "Review the work through quality and risk lenses, then close identified gaps.",
    },
    deliverables: {
      zh: ["审查结论", "修正记录"],
      en: ["Review findings", "Corrections made"],
    },
    checks: {
      zh: ["关键风险已覆盖", "验收条件已核对"],
      en: ["Key risks are covered", "Acceptance criteria are reconciled"],
    },
  },
  deliver: {
    id: "deliver",
    kind: "deliver",
    title: { zh: "整合与交付", en: "Synthesize and deliver" },
    description: {
      zh: "由主理人整合各阶段结果，给出清晰结论和下一步。",
      en: "Have the lead synthesize the stage results into a clear conclusion and next action.",
    },
    deliverables: {
      zh: ["最终结论", "阶段产出表"],
      en: ["Final conclusion", "Stage output table"],
    },
    checks: {
      zh: ["结论与证据一致", "未完成项明确披露"],
      en: ["Conclusions match the evidence", "Unfinished items are disclosed"],
    },
  },
};

const FRAME_KEYWORDS = [
  "intake", "planner", "strategist", "product-manager", "策划", "采集", "产品经理", "策略师",
];
const VERIFY_KEYWORDS = [
  "reviewer", "reviser", "editor", "qa", "risk", "contrarian", "审稿", "修订", "编辑", "qa工程师", "风险", "逆向",
];
const DELIVER_KEYWORDS = [
  "finalizer", "publisher", "manager", "adapter", "终稿", "发布", "主管", "改编",
];
const PRODUCE_KEYWORDS = [
  "writer", "creator", "generator", "engineer", "trader", "文案", "创作", "生成", "工程师", "交易员", "撰写",
];

function localizedPair(value: unknown, fallback: string): LocalizedPair {
  if (typeof value === "string" && value.trim()) {
    return { zh: value.trim(), en: value.trim() };
  }
  if (isRecord(value)) {
    const zh = typeof value.zh === "string" ? value.zh.trim() : "";
    const en = typeof value.en === "string" ? value.en.trim() : "";
    return { zh: zh || en || fallback, en: en || zh || fallback };
  }
  return { zh: fallback, en: fallback };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function includesKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function classifyMember(member: TeamWorkflowMember): TeamWorkflowStageKind {
  const searchable = [
    member.id,
    member.name.zh,
    member.name.en,
    member.profession.zh,
    member.profession.en,
  ].join(" ").toLocaleLowerCase();
  if (includesKeyword(searchable, FRAME_KEYWORDS)) return "frame";
  if (includesKeyword(searchable, VERIFY_KEYWORDS)) return "verify";
  if (includesKeyword(searchable, DELIVER_KEYWORDS)) return "deliver";
  if (includesKeyword(searchable, PRODUCE_KEYWORDS)) return "produce";
  return "investigate";
}

function normalizeMember(member: Record<string, unknown>): TeamWorkflowMember | null {
  const id = stringValue(member.id);
  if (!id) return null;
  const profession = localizedPair(member.profession, id);
  return {
    id,
    name: localizedPair(member.name, profession.zh || id),
    profession,
  };
}

export function compileTeamWorkflow(input: {
  leadAgentName: string;
  members: Record<string, unknown>[];
  fallbackMemberIds?: string[];
}): TeamWorkflow {
  const normalizedMembers = input.members
    .filter((member) => stringValue(member.role) !== "lead")
    .map(normalizeMember)
    .filter((member): member is TeamWorkflowMember => member !== null);
  const knownIds = new Set(normalizedMembers.map((member) => member.id));
  for (const id of input.fallbackMemberIds ?? []) {
    if (!id || id === input.leadAgentName || knownIds.has(id)) continue;
    normalizedMembers.push({
      id,
      name: { zh: id, en: id },
      profession: { zh: id, en: id },
    });
    knownIds.add(id);
  }

  const grouped = new Map<TeamWorkflowStageKind, TeamWorkflowMember[]>();
  for (const member of normalizedMembers) {
    const kind = classifyMember(member);
    grouped.set(kind, [...(grouped.get(kind) ?? []), member]);
  }
  const stageOrder: TeamWorkflowStageKind[] = [
    "frame", "investigate", "produce", "verify", "deliver",
  ];
  const stages = stageOrder
    .filter((kind) => kind === "deliver" || (grouped.get(kind)?.length ?? 0) > 0)
    .map((kind) => ({
      ...STAGE_DEFINITIONS[kind],
      members: grouped.get(kind) ?? [],
    }));

  return {
    mode: "lead-workflow",
    version: 1,
    leadAgentName: input.leadAgentName,
    memberCount: normalizedMembers.length + 1,
    stages,
  };
}

export function appendTeamWorkflowPrompt(
  leadMarkdown: string,
  workflow: TeamWorkflow,
): string {
  const stageLines = workflow.stages.map((stage, index) => {
    const responsibilityLabels = stage.members.map((member) => member.profession.en).filter(Boolean);
    const lenses = responsibilityLabels.length > 0
      ? responsibilityLabels.join(", ")
      : `team lead (${workflow.leadAgentName})`;
    return `${index + 1}. ${stage.title.en}: ${stage.description.en} Responsibility lenses: ${lenses}. Deliverables: ${stage.deliverables.en.join(", ")}. Checks: ${stage.checks.en.join(", ")}.`;
  });
  const protocol = [
    "## OnMyAgent team workflow (single-lead mode)",
    "",
    "Runtime truth: you are the only executing model in one session and one permission context. The listed team members are responsibility lenses for quality, not independently running agents.",
    "Never claim that you delegated to, messaged, waited for, or received work from a member. Never invent member task IDs, parallel runs, private discussions, or independent member results.",
    "For a substantive task, execute the relevant stages below in order. For a greeting, simple clarification, or one-step factual answer, respond directly without ceremony.",
    "The user may ask to focus on or skip stages. Honor that request, while retaining any safety-critical check and marking skipped stages honestly.",
    "When stages are used, make progress visible with concise headings in the reply language, such as `Stage 1/4 · Frame and plan`. End with a compact `Stage outputs` table containing stage, status, key output, and check. Do not role-play separate member voices.",
    "",
    "Workflow stages:",
    ...stageLines,
  ].join("\n");
  return `${leadMarkdown.trimEnd()}\n\n${protocol}\n`;
}
