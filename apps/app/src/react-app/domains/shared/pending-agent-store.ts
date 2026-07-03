/** @jsxImportSource react */
import { create } from "zustand";

export type AgentAvatarStyle = "像素风" | "冒险家" | "机器人" | "洛蕾莱";

export type AgentToolCategoryId =
  | "filesystem"
  | "web"
  | "commerce"
  | "code"
  | "media"
  | "utility"
  | "memory"
  | "collaboration";

export type AgentToolAccessMap = Record<string, boolean>;

const TOOL_NAMES_BY_CATEGORY: Record<AgentToolCategoryId, readonly string[]> = {
  filesystem: ["list", "read", "grep", "glob", "write", "edit", "apply_patch"],
  web: ["webfetch", "websearch"],
  commerce: [],
  code: ["bash"],
  media: [],
  utility: ["question"],
  memory: ["todoread", "todowrite"],
  collaboration: ["task"],
};

const AGENT_TOOL_CATEGORY_IDS: readonly AgentToolCategoryId[] = [
  "filesystem",
  "web",
  "commerce",
  "code",
  "media",
  "utility",
  "memory",
  "collaboration",
];

const ALL_AGENT_TOOL_NAMES = Array.from(
  new Set(Object.values(TOOL_NAMES_BY_CATEGORY).flat()),
);

export type PendingAgentContext = {
  id: string;
  name: string;
  description: string;
  avatar: {
    avatarStyle: AgentAvatarStyle;
    avatarOptionId: string;
    customAvatarDataUrl: string | null;
    avatarUrl: string | null;
    avatarBackground: string | null;
  };
  systemPrompt: string;
  model?: { providerID: string; modelID: string };
  tools?: AgentToolAccessMap;
  quickPrompts?: string[];
  conversationStartId?: number;
  draftSource?: "agent-selection" | "new-session";
  marketplaceExpert?: {
    source: "builtin" | "mine";
    packageName: string;
    packagePath: string;
  };
  boundSessionId?: string;
};

type PendingAgentStore = {
  agent: PendingAgentContext | null;
  setAgent: (agent: PendingAgentContext | null) => void;
  getAgent: () => PendingAgentContext | null;
};

export const usePendingAgentStore = create<PendingAgentStore>((set, get) => ({
  agent: null,
  setAgent: (agent) => set({ agent }),
  getAgent: () => get().agent,
}));

export function buildAgentSystemPrompt(agent: {
  name?: string;
  quote?: string;
  tone?: string;
  preferredName?: string;
  preferredLanguage?: string;
  userBackground?: string;
  userNote?: string;
  agentMemory?: string;
  userMemory?: string;
  enabledToolIds?: readonly string[];
  skillIds?: readonly string[];
}): string {
  const parts: string[] = [];
  if (agent.name)
    parts.push(
      `【身份覆盖】你现在的身份是：${agent.name}。你不是 OnMyAgent，不是 OnMyAgent，而是 ${agent.name}。当用户问你"你是谁"时，用 ${agent.name} 来回答，例如："你好，我是${agent.name}。"`,
    );
  if (agent.quote) parts.push(`你的核心定位：${agent.quote}`);
  if (agent.tone) parts.push(`语气风格：${agent.tone}`);
  if (agent.preferredName) parts.push(`称呼用户为：${agent.preferredName}`);
  if (agent.userBackground) parts.push(`用户背景：${agent.userBackground}`);
  if (agent.userNote) parts.push(`特殊要求：${agent.userNote}`);
  const agentMemoryTrimmed = agent.agentMemory?.trim();
  if (agentMemoryTrimmed) {
    parts.push(
      `【智能体记忆】这是你需要一直牢记的关于自身的长期记忆：\n${agentMemoryTrimmed}`,
    );
  }
  const userMemoryTrimmed = agent.userMemory?.trim();
  if (userMemoryTrimmed) {
    parts.push(
      `【用户记忆】这是你需要一直牢记的关于用户的长期记忆（请勿在对话中主动复述这些条目，仅在必要时参考）：\n${userMemoryTrimmed}`,
    );
  }
  if (agent.enabledToolIds && agent.enabledToolIds.length > 0) {
    parts.push(`可用工具类别：${agent.enabledToolIds.join("、")}`);
  }
  if (agent.preferredLanguage)
    parts.push(`回复语言：${agent.preferredLanguage}`);
  return parts.join("\n\n");
}

export function buildAgentToolAccess(agent: {
  enabledToolIds?: readonly AgentToolCategoryId[];
  skillIds?: readonly string[];
}): AgentToolAccessMap | undefined {
  if (!agent.enabledToolIds && !agent.skillIds) return undefined;
  const enabled = new Set(agent.enabledToolIds);
  const disabledTools = new Set(
    agent.enabledToolIds
      ? ALL_AGENT_TOOL_NAMES.filter((toolName) =>
          AGENT_TOOL_CATEGORY_IDS.some(
            (category) =>
              !enabled.has(category) &&
              TOOL_NAMES_BY_CATEGORY[category].includes(toolName),
          ),
        )
      : [],
  );
  if (agent.skillIds && agent.skillIds.length === 0) {
    disabledTools.add("skill");
  }
  if (disabledTools.size === 0) return undefined;
  return Object.fromEntries(
    Array.from(disabledTools).map((toolName) => [toolName, false]),
  );
}
