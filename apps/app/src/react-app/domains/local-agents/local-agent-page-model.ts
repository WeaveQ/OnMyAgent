import { t } from "@/i18n";
import type { PersonalLocalAgent, PersonalLocalAgentApprovalMode, PersonalLocalAgentConversation, PersonalLocalAgentMetadata, PersonalLocalAgentProvider } from "../../../app/lib/desktop";
import claudeIconUrl from "../../../assets/agent-icons/claude.svg";
import codexIconUrl from "../../../assets/agent-icons/openai.svg";
import hermesIconUrl from "../../../assets/agent-icons/hermes.png";
import openclawIconUrl from "../../../assets/agent-icons/claw.svg";
import opencodeIconUrl from "../../../assets/agent-icons/opencode-logo-light.svg";
import { conversationTitle } from "../session/chat/personal-local-agent-scheduled-tasks";
import type { AgentHealthResult } from "./local-agent-page-types";
import type { LocalAgentSlashCommand } from "./local-agent-draft-composer";
import type { ChatMessage } from "./messages/message-types";

export type PersistedLocalAgentChatState = {
  version: 1;
  selectedAgentId?: string;
  selectedConversationIdByAgent?: Record<string, string>;
  messagesByAgent?: Record<string, ChatMessage[]>;
  draftsByAgent?: Record<string, string>;
  activeRunIdByAgent?: Record<string, string | null>;
  healthResults?: Record<string, AgentHealthResult>;
  errorsByAgent?: Record<string, string | null>;
};

export {
  PROVIDER_LABELS,
  isPersonalLocalAgentProvider,
} from "./constants";


const PROVIDER_ICON_URLS: Partial<Record<PersonalLocalAgentProvider, string>> = {
  opencode: opencodeIconUrl,
  codex: codexIconUrl,
  claude: claudeIconUrl,
  openclaw: openclawIconUrl,
  hermes: hermesIconUrl,
};

export function providerIconUrl(provider: PersonalLocalAgentProvider) {
  return PROVIDER_ICON_URLS[provider] ?? null;
}

export function modelSelectorLabel(agent: PersonalLocalAgent | null) {
  if (!agent) return t("local_agent.model");
  const targetKind = agent.capability?.targetKind ?? (agent.provider === "openclaw" ? "agent" : "model");
  if (agent.provider === "openclaw") return t("local_agent.openclaw_agent");
  return targetKindLabel(targetKind);
}

const PERSONAL_AGENT_MODEL_PREF_PREFIX = "onmyagent.personalLocalAgent.model";
const PERSONAL_AGENT_CHAT_STATE_PREFIX = "onmyagent.personalLocalAgent.chatState";
const PERSONAL_AGENT_LIST_CACHE_PREFIX = "onmyagent.personalLocalAgent.agentList";
const PERSONAL_AGENT_APPROVAL_MODE_PREFIX = "onmyagent.personalLocalAgent.approvalMode";
export const LOCAL_AGENT_LIST_MIN_WIDTH = 180;
export const LOCAL_AGENT_LIST_MAX_WIDTH = 320;
export const LOCAL_AGENT_LIST_DEFAULT_WIDTH = 240;
export const OPENCODE_PREFERRED_MODEL = "ark-coding-openai/ark-code-latest";

export const HEALTH_CHECK_PROMPT =
  "Local Agent health check: reply with HEALTH_CHECK_OK only and keep it short.";

export function agentFromAcpMetadata(metadata: PersonalLocalAgentMetadata): PersonalLocalAgent {
  const provider = metadata.backend === "opencode" || metadata.backend === "codex" || metadata.backend === "claude" || metadata.backend === "openclaw" || metadata.backend === "hermes" || metadata.backend === "custom"
    ? metadata.backend
    : "custom";
  const availableModels = Array.isArray(metadata.handshake?.available_models)
    ? metadata.handshake.available_models
    : [];
  const modelOptions = availableModels.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) return [];
    const label = typeof record.label === "string" ? record.label : typeof record.name === "string" ? record.name : id;
    return [{ id, label }];
  });
  const binaryName = metadata.agent_source_info?.binary_name?.trim() || provider;
  return {
    id: metadata.id,
    name: metadata.name,
    provider,
    executablePath: metadata.command?.trim() || binaryName,
    model: null,
    customArgs: Array.isArray(metadata.args) ? metadata.args : [],
    modelOptions,
    defaultModel: modelOptions[0]?.id ?? null,
    connectionMode: metadata.connectionMode ?? null,
    status: metadata.status ?? (metadata.available ? "online" : "offline"),
    version: metadata.agent_source_info?.version ?? null,
    error: metadata.error ?? null,
    capability: metadata.capability ?? null,
    handshake: metadata.handshake,
    behavior_policy: metadata.behavior_policy ?? null,
    lastCheckedAt: Date.now(),
  };
}

export function normalizeAcpSlashCommandList(raw: unknown): LocalAgentSlashCommand[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const rawName = String(source.name ?? source.command ?? source.id ?? "").trim();
    if (!rawName) return [];
    const name = rawName.startsWith("/") ? rawName : `/${rawName}`;
    const rawBehavior = String(source.selectionBehavior ?? source.selection_behavior ?? "insert").toLowerCase();
    const rawInput = source.input && typeof source.input === "object" ? (source.input as Record<string, unknown>) : null;
    const meta = source._meta && typeof source._meta === "object" ? (source._meta as Record<string, unknown>) : null;
    const hint = typeof source.hint === "string" && source.hint.trim()
      ? source.hint.trim()
      : rawInput && typeof rawInput.hint === "string" && rawInput.hint.trim()
        ? rawInput.hint.trim()
        : undefined;
    const rawCompletion = String(source.completion_behavior ?? source.completionBehavior ?? meta?.completion_behavior ?? "").toLowerCase();
    const completionBehavior = rawCompletion === "neutral_tip_on_empty" ? "neutral_tip_on_empty" as const : rawCompletion === "normal" ? "normal" as const : undefined;
    const emptyTurnTipCode = typeof source.empty_turn_tip_code === "string" && source.empty_turn_tip_code.trim()
      ? source.empty_turn_tip_code.trim()
      : typeof source.emptyTurnTipCode === "string" && source.emptyTurnTipCode.trim()
        ? source.emptyTurnTipCode.trim()
        : typeof meta?.empty_turn_tip_code === "string" && (meta.empty_turn_tip_code as string).trim()
          ? (meta.empty_turn_tip_code as string).trim()
          : undefined;
    const emptyTurnTipParamsRaw = source.empty_turn_tip_params ?? source.emptyTurnTipParams ?? meta?.empty_turn_tip_params;
    const emptyTurnTipParams = emptyTurnTipParamsRaw && typeof emptyTurnTipParamsRaw === "object" && !Array.isArray(emptyTurnTipParamsRaw)
      ? (emptyTurnTipParamsRaw as Record<string, unknown>)
      : undefined;
    const description = String(source.description ?? source.summary ?? "").trim();
    const command: LocalAgentSlashCommand = {
      name,
      description,
      source: "acp",
      selectionBehavior: rawBehavior === "execute" ? "execute" : "insert",
    };
    if (hint) command.hint = hint;
    if (completionBehavior) command.completionBehavior = completionBehavior;
    if (emptyTurnTipCode) command.emptyTurnTipCode = emptyTurnTipCode;
    if (emptyTurnTipParams) command.emptyTurnTipParams = emptyTurnTipParams;
    return [command];
  });
}

export function normalizeAcpSlashCommands(agent: PersonalLocalAgent | null): LocalAgentSlashCommand[] {
  const rawCommands = agent && "handshake" in agent && Array.isArray(agent.handshake?.available_commands)
    ? agent.handshake.available_commands
    : [];
  return normalizeAcpSlashCommandList(rawCommands);
}

export function builtinSlashCommands(agent: PersonalLocalAgent | null, options?: { hasConversation?: boolean }): LocalAgentSlashCommand[] {
  if (!agent) return [];
  const commands: LocalAgentSlashCommand[] = [
    { name: "/new", description: t("local_agent.slash_new_desc"), source: "builtin", selectionBehavior: "execute" },
    { name: "/clear", description: t("local_agent.slash_clear_desc"), source: "builtin", selectionBehavior: "execute" },
    { name: "/sessions", description: t("local_agent.slash_sessions_desc"), source: "builtin", selectionBehavior: "execute" },
    { name: "/open", description: t("local_agent.slash_open_desc"), source: "builtin", selectionBehavior: "execute" },
  ];
  if (options?.hasConversation) {
    commands.push({ name: "/copy", description: t("local_agent.slash_copy_desc"), source: "builtin", selectionBehavior: "execute" });
  }
  return commands;
}

export function mergeSlashCommands(commands: LocalAgentSlashCommand[]) {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = command.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export const DEFAULT_HEARTBEAT_PROMPT =
  "Run this scheduled task. Describe the goal, expected output, and whether file changes are allowed.";

export function targetKindLabel(targetKind: "model" | "agent" | "profile" | "command") {
  switch (targetKind) {
    case "model":
      return t("local_agent.target_model");
    case "agent":
      return t("local_agent.target_agent");
    case "profile":
      return t("local_agent.target_profile");
    case "command":
      return t("local_agent.target_command");
  }
}

export const APPROVAL_MODE_OPTIONS: Array<{ id: PersonalLocalAgentApprovalMode; label: string; description: string }> = [
  { id: "auto", get label() { return t("local_agent.approval_auto"); }, get description() { return t("local_agent.approval_auto_desc"); } },
  { id: "ask", get label() { return t("local_agent.approval_ask"); }, get description() { return t("local_agent.approval_ask_desc"); } },
  { id: "read-only-auto", get label() { return t("local_agent.approval_readonly_auto"); }, get description() { return t("local_agent.approval_readonly_auto_desc"); } },
];

export const DEFAULT_HEALTH_RESULT: AgentHealthResult = {
  status: "idle",
  at: null,
  runId: null,
  output: "",
  error: null,
};

export function welcomeMessageForAgent(agent: PersonalLocalAgent | null): ChatMessage {
  const name = agent?.name ?? t("nav.local_agent");
  return {
    id: `welcome-${agent?.id ?? "empty"}`,
    role: "assistant",
    createdAt: Date.now(),
    text: t("local_agent.switched_message", { name }),
    run: null,
  };
}

export function personalAgentModelPrefKey(agentId: string) {
  return `${PERSONAL_AGENT_MODEL_PREF_PREFIX}.${agentId}`;
}

export function personalAgentChatStateKey(workspaceRoot: string) {
  return `${PERSONAL_AGENT_CHAT_STATE_PREFIX}.${workspaceRoot}`;
}

export function personalAgentListCacheKey(workspaceRoot: string) {
  return `${PERSONAL_AGENT_LIST_CACHE_PREFIX}.${workspaceRoot}`;
}

export function personalAgentApprovalModeKey(workspaceRoot: string) {
  return `${PERSONAL_AGENT_APPROVAL_MODE_PREFIX}.${workspaceRoot}`;
}

export function localAgentChatKey(agentId: string, conversationId?: string | null) {
  return conversationId ? `${agentId}::${conversationId}` : agentId;
}

export function agentIdFromChatKey(chatKey: string) {
  return chatKey.split("::")[0] ?? chatKey;
}

export function transcriptMessagesForAgent(
  agent: PersonalLocalAgent,
  messages: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt: number }>,
) {
  if (!messages.length) return [welcomeMessageForAgent(agent)];
  return messages.map((message) => ({
    id: `history-${message.id}`,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
  } satisfies ChatMessage));
}

export function nativeSessionResumeOnlyMessage(agent: PersonalLocalAgent, conversation: PersonalLocalAgentConversation): ChatMessage {
  return {
    id: `native-session-${conversation.id}`,
    role: "assistant",
    text: t("local_agent.native_session_resume_only", { name: agent.name, title: conversationTitle(conversation) }),
    createdAt: Date.now(),
  };
}

export {
  TRANSCRIPT_SOFT_ERRORS,
  isUnsupportedNativeTranscriptError,
} from "./constants";

export function safeReadApprovalMode(workspaceRoot: string): PersonalLocalAgentApprovalMode {
  if (typeof window === "undefined") return "ask";
  const raw = window.localStorage.getItem(personalAgentApprovalModeKey(workspaceRoot));
  if (raw === "auto" || raw === "ask" || raw === "read-only-auto") return raw;
  return "ask";
}

export function safeReadPersistedChatState(workspaceRoot: string): PersistedLocalAgentChatState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(personalAgentChatStateKey(workspaceRoot));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1) return null;
    // Structural guard above validates the persistence version; downstream fields are optional.
    return parsed as PersistedLocalAgentChatState;
  } catch {
    return null;
  }
}

export function safeReadCachedAgents(workspaceRoot: string): PersonalLocalAgent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(personalAgentListCacheKey(workspaceRoot));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PersonalLocalAgent =>
        Boolean(item && typeof item === "object" && "id" in item),
    );
  } catch {
    return [];
  }
}

export function safeWriteCachedAgents(workspaceRoot: string, agents: PersonalLocalAgent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(personalAgentListCacheKey(workspaceRoot), JSON.stringify(agents));
  } catch {
  }
}

export function compactMessagesByAgent(messagesByAgent: Record<string, ChatMessage[]>) {
  const next: Record<string, ChatMessage[]> = {};
  for (const [agentId, messages] of Object.entries(messagesByAgent)) {
    next[agentId] = messages.slice(-80);
  }
  return next;
}

export function recoverActiveRunIds(
  messagesByAgent: Record<string, ChatMessage[]> | undefined,
  persistedActiveRunIds: Record<string, string | null> | undefined,
) {
  const next: Record<string, string | null> = { ...(persistedActiveRunIds ?? {}) };
  for (const [agentId, messages] of Object.entries(messagesByAgent ?? {})) {
    const persistedRunId = next[agentId];
    const persistedRun = persistedRunId
      ? messages.find((message) => message.run?.runId === persistedRunId)?.run
      : null;
    if (persistedRun?.status === "running") continue;
    const runningRun = [...messages].reverse().find((message) => message.run?.status === "running")?.run;
    next[agentId] = runningRun?.runId ?? null;
  }
  return next;
}

export function chooseInitialModel(agent: PersonalLocalAgent | null) {
  if (!agent || typeof window === "undefined") return "";
  const saved = window.localStorage.getItem(personalAgentModelPrefKey(agent.id))?.trim() ?? "";
  if (saved && agent.modelOptions.some((option) => option.id === saved)) return saved;
  if (agent.provider === "opencode" && agent.modelOptions.some((option) => option.id === OPENCODE_PREFERRED_MODEL)) {
    return OPENCODE_PREFERRED_MODEL;
  }
  return "";
}
