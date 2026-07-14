/** @jsxImportSource react */
import { create } from "zustand";

export type AgentAvatarStyle = "pixel" | "adventurer" | "robot" | "lorelei";

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
  runtime?: "browser-use-agent";
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
      `[Identity override] Your identity is now: ${agent.name}. You are not OnMyAgent; you are ${agent.name}. When the user asks who you are, answer as ${agent.name}, for example: "Hi, I am ${agent.name}."`,
    );
  if (agent.quote) parts.push(`Core positioning: ${agent.quote}`);
  if (agent.tone) parts.push(`Tone: ${agent.tone}`);
  if (agent.preferredName) parts.push(`Address the user as: ${agent.preferredName}`);
  if (agent.userBackground) parts.push(`User background: ${agent.userBackground}`);
  if (agent.userNote) parts.push(`Special instructions: ${agent.userNote}`);
  const agentMemoryTrimmed = agent.agentMemory?.trim();
  if (agentMemoryTrimmed) {
    parts.push(
      `[Agent memory] Long-term memory about yourself that you must retain:\n${agentMemoryTrimmed}`,
    );
  }
  const userMemoryTrimmed = agent.userMemory?.trim();
  if (userMemoryTrimmed) {
    parts.push(
      `[User memory] Long-term memory about the user (do not proactively recap these items; use only when needed):\n${userMemoryTrimmed}`,
    );
  }
  if (agent.enabledToolIds && agent.enabledToolIds.length > 0) {
    parts.push(`Available tool categories: ${agent.enabledToolIds.join(", ")}`);
  }
  if (agent.preferredLanguage)
    parts.push(`Reply language: ${agent.preferredLanguage}`);
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
