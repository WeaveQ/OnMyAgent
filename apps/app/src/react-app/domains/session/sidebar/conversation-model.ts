import { t } from "../../../../i18n";
import type {
  OnMyAgentServerStatus,
  OnMyAgentSessionMessage,
  OnMyAgentSessionSnapshot,
} from "../../../../app/lib/onmyagent-server";
import {
  DEFAULT_SESSION_TITLE,
  getDisplaySessionTitle,
  isGeneratedSessionTitle,
} from "../../../../app/lib/session-title";
import type { WorkspaceSessionGroup } from "../../../../app/types";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { createDefaultAgentRegistry } from "../../agents";
import {
  resolveAgentAvatarUrl,
} from "../../agents";
import type {
  AgentRegistry,
  AgentTemplate,
} from "../../agents";
import {
  buildPendingAgentFromRecord,
} from "../../agents";
import { findBuiltinMarketplaceExpertById } from "../expert-marketplace/data";
import {
  readCustomAgentIdForSession,
  readSessionAgentSnapshot,
  useAgentRegistryStore,
  writeCustomAgentIdForSession,
} from "../../agents";
import {
  isAssistantSession,
  isExpertSession,
} from "../../agents";
import {
  ONMYAGENT_ASSISTANT_AVATAR,
  onmyagentAssistantName,
} from "../surface/personal-assistant-config";

export type TaskStatusIndicator = {
  label: string;
  variant: "available" | "loading" | "limited" | "offline";
};

export {
  buildPendingAgentFromRecord,
  createDefaultAgentRegistry,
  resolveAgentAvatarUrl,
  useAgentRegistryStore,
  writeCustomAgentIdForSession,
  type AgentRegistry,
  type AgentTemplate,
};

export type AgentConversationGroup = {
  key: string;
  agentId: string | null;
  name: string;
  description: string;
  /** Last-message snippet for list scannability; optional. */
  preview?: string;
  avatarUrl: string | null;
  avatarBackground: string;
  sessions: WorkspaceSessionGroup["sessions"];
  latestSession: WorkspaceSessionGroup["sessions"][number];
};

export type AgentStarterItem = {
  key: string;
  agentId: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  avatarBackground: string;
};

export function workspaceTaskStatus(
  clientConnected: boolean,
  onmyagentServerStatus: OnMyAgentServerStatus,
  loading: boolean,
): TaskStatusIndicator {
  if (loading) return { label: t("session.preparing_workspace"), variant: "loading" };
  if (clientConnected) return { label: t("status.ready_for_tasks"), variant: "available" };
  if (onmyagentServerStatus === "limited") {
    return { label: t("status.limited_mode"), variant: "limited" };
  }
  return { label: t("status.unavailable_for_tasks"), variant: "offline" };
}

export function normalizeTimestamp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

export function formatConversationTime(value: number | null | undefined) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDelta = Math.round(
    (today.getTime() - targetDay.getTime()) / 86_400_000,
  );
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (dayDelta === 0) return time;
  if (dayDelta > 0) return t("time.days_ago", { count: dayDelta });
  return time;
}

function sessionMessageTime(message: OnMyAgentSessionMessage) {
  const completed =
    "completed" in message.info.time ? message.info.time.completed : null;
  return (
    normalizeTimestamp(completed) ??
    normalizeTimestamp(message.info.time?.created)
  );
}

function messagePartPreview(part: OnMyAgentSessionMessage["parts"][number]) {
  if (part.type === "text") {
    if (part.synthetic || part.ignored) return "";
    return part.text.trim();
  }
  // Reasoning is internal monologue (often "The user sent…") — never list subtitle.
  if (part.type === "reasoning") return "";
  if (part.type === "tool") return t("session.preview_tool", { tool: part.tool });
  if (part.type === "agent")
    return part.name ? `@${part.name}` : t("session.preview_agent_mention");
  if (part.type === "file") return t("session.preview_file");
  return "";
}

/** Visible text parts only (model reply / user text), no reasoning. */
function messageVisibleTextPreview(message: OnMyAgentSessionMessage) {
  return message.parts
    .map((part) => {
      if (part.type !== "text") return "";
      if (part.synthetic || part.ignored) return "";
      return part.text.trim();
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sessionMessagePreview(message: OnMyAgentSessionMessage) {
  return message.parts
    .map(messagePartPreview)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Expert list subtitle: prefer latest **model reply** text.
 * Skips user turns and reasoning so we never show "The user sent…".
 */
export function sessionAssistantReplyPreview(
  message: OnMyAgentSessionMessage,
): string {
  if (message.info.role !== "assistant") return "";
  return messageVisibleTextPreview(message);
}

export function snapshotConversationSummary(
  snapshot: OnMyAgentSessionSnapshot | undefined,
  fallbackTime: number | null | undefined,
  options?: {
    /**
     * Expert list: last assistant text reply first.
     * Falls back to last user text only if no model reply yet.
     */
    preferAssistantReply?: boolean;
  },
) {
  if (!snapshot) {
    return {
      preview: t("session.default_title"),
      time: formatConversationTime(fallbackTime),
    };
  }

  const pickFromMessages = (
    matcher: (message: OnMyAgentSessionMessage) => string,
  ) => {
    for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
      const message = snapshot.messages[index];
      if (!message) continue;
      const preview = matcher(message);
      if (preview) {
        return {
          preview,
          time: formatConversationTime(
            sessionMessageTime(message) ??
              snapshot.session.time?.updated ??
              snapshot.session.time?.created ??
              fallbackTime,
          ),
        };
      }
    }
    return null;
  };

  if (options?.preferAssistantReply) {
    const assistantHit = pickFromMessages(sessionAssistantReplyPreview);
    if (assistantHit) return assistantHit;
    // Waiting for model: show last user text, still never reasoning.
    const userHit = pickFromMessages((message) =>
      message.info.role === "user" ? messageVisibleTextPreview(message) : "",
    );
    if (userHit) return userHit;
  } else {
    const anyHit = pickFromMessages(sessionMessagePreview);
    if (anyHit) return anyHit;
  }

  return {
    preview: t("session.default_title"),
    time: formatConversationTime(
      snapshot.session.time?.updated ??
        snapshot.session.time?.created ??
        fallbackTime,
    ),
  };
}

const ASSISTANT_PINNED_SESSIONS_STORAGE_KEY =
  "onmyagent.assistantPinnedSessions.v1";

export function readAssistantPinnedSessionIds(workspaceId: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(ASSISTANT_PINNED_SESSIONS_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const value = (parsed as Record<string, unknown>)[workspaceId];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeAssistantPinnedSessionIds(workspaceId: string, sessionIds: string[]) {
  if (typeof window === "undefined") return;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(ASSISTANT_PINNED_SESSIONS_STORAGE_KEY) ?? "{}",
    );
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    const uniqueSessionIds = Array.from(new Set(sessionIds));
    if (uniqueSessionIds.length > 0) record[workspaceId] = uniqueSessionIds;
    else delete record[workspaceId];
    window.localStorage.setItem(
      ASSISTANT_PINNED_SESSIONS_STORAGE_KEY,
      JSON.stringify(record),
    );
  } catch {
    return;
  }
}

/** Expert list pin — by agentId (one row = one expert), local only. */
const EXPERT_PINNED_AGENTS_STORAGE_KEY = "onmyagent.expertPinnedAgents.v1";

export function readExpertPinnedAgentIds(workspaceId: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(EXPERT_PINNED_AGENTS_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const value = (parsed as Record<string, unknown>)[workspaceId];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeExpertPinnedAgentIds(workspaceId: string, agentIds: string[]) {
  if (typeof window === "undefined") return;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(EXPERT_PINNED_AGENTS_STORAGE_KEY) ?? "{}",
    );
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    const uniqueAgentIds = Array.from(new Set(agentIds));
    if (uniqueAgentIds.length > 0) record[workspaceId] = uniqueAgentIds;
    else delete record[workspaceId];
    window.localStorage.setItem(
      EXPERT_PINNED_AGENTS_STORAGE_KEY,
      JSON.stringify(record),
    );
  } catch {
    return;
  }
}

/** Session tab pin within an expert — order chips (pinned first), local only. */
const AGENT_SESSION_TAB_PINNED_STORAGE_KEY =
  "onmyagent.agentSessionTabPinned.v1";

export function readAgentSessionTabPinnedIds(workspaceId: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(AGENT_SESSION_TAB_PINNED_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const value = (parsed as Record<string, unknown>)[workspaceId];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeAgentSessionTabPinnedIds(
  workspaceId: string,
  sessionIds: string[],
) {
  if (typeof window === "undefined") return;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(AGENT_SESSION_TAB_PINNED_STORAGE_KEY) ?? "{}",
    );
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    const uniqueSessionIds = Array.from(new Set(sessionIds));
    if (uniqueSessionIds.length > 0) record[workspaceId] = uniqueSessionIds;
    else delete record[workspaceId];
    window.localStorage.setItem(
      AGENT_SESSION_TAB_PINNED_STORAGE_KEY,
      JSON.stringify(record),
    );
  } catch {
    return;
  }
}

function summarizeAssistantGeneratedTitle(input: string | undefined) {
  const cleaned = (input ?? "")
    // Keep matching legacy Chinese prefixes via \u escapes (no literal CJK glyphs).
    .replace(
      new RegExp(
        "\u7528\u6237\u53D1\u9001\u4E86|The user|I should|This is",
        "gi",
      ),
      "",
    )
    .replace(/["""''.。？?！!,，:：；;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function assistantTaskTitle(
  session: WorkspaceSessionGroup["sessions"][number],
  generatedFallback?: string,
) {
  const rawTitle = session.title?.trim() ?? "";
  const defaultTitle = t("session.default_title");
  if (
    rawTitle &&
    rawTitle !== DEFAULT_SESSION_TITLE &&
    rawTitle !== defaultTitle &&
    !isGeneratedSessionTitle(rawTitle)
  ) {
    return rawTitle;
  }
  return (
    summarizeAssistantGeneratedTitle(generatedFallback) ??
    t("session.default_title")
  );
}

export function buildAssistantConversationGroups(
  sessions: WorkspaceSessionGroup["sessions"],
  generatedTitleFallbacks?: Map<string, string>,
  previewBySessionId?: Map<string, string>,
): AgentConversationGroup[] {
  return sessions
    .filter((session) => isAssistantSession(session.id))
    .map((session) => {
      const preview = previewBySessionId?.get(session.id)?.trim() || undefined;
      const title = assistantTaskTitle(
        session,
        generatedTitleFallbacks?.get(session.id),
      );
      // Avoid duplicating the same text on title + preview rows.
      const showPreview =
        preview &&
        preview !== title &&
        preview !== t("session.default_title")
          ? preview
          : undefined;
      return {
        key: `assistant:${session.id}`,
        agentId: null,
        name: onmyagentAssistantName(),
        description: title,
        preview: showPreview,
        avatarUrl: resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR),
        avatarBackground: "#eef7f2",
        sessions: [session],
        latestSession: session,
      };
    })
    .sort(
      (a, b) =>
        (b.latestSession.time?.updated ?? b.latestSession.time?.created ?? 0) -
        (a.latestSession.time?.updated ?? a.latestSession.time?.created ?? 0),
    );
}

/**
 * Collapse whitespace for one-line list previews (WeChat-style last message).
 */
export function compactConversationPreview(input: string | undefined): string {
  return (input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildAgentConversationGroups(
  sessions: WorkspaceSessionGroup["sessions"],
  registry: AgentRegistry | null,
  previewBySessionId?: Map<string, string>,
): AgentConversationGroup[] {
  const groups = new Map<string, AgentConversationGroup>();
  for (const session of sessions) {
    if (!isExpertSession(session.id)) continue;
    const fallbackTitle = getDisplaySessionTitle(session.title);
    const agentId = readCustomAgentIdForSession(session.id);
    if (!agentId) continue;
    const agent =
      registry && agentId
        ? (registry.agents.find((item) => item.id === agentId) ??
          registry.templates.find((item) => item.id === agentId))
        : null;
    const restoredAgent =
      agent && registry ? buildPendingAgentFromRecord(agent, registry) : null;
    const marketplaceExpert = restoredAgent
      ? null
      : findBuiltinMarketplaceExpertById(agentId);
    const sessionAgentSnapshot = restoredAgent || marketplaceExpert
      ? null
      : readSessionAgentSnapshot(session.id);
    const key = `agent:${agentId}`;
    const existing = groups.get(key);
    const sessionPreview =
      compactConversationPreview(previewBySessionId?.get(session.id)) ||
      undefined;

    if (existing) {
      existing.sessions.push(session);
      if (
        (session.time?.updated ?? session.time?.created ?? 0) >
        (existing.latestSession.time?.updated ??
          existing.latestSession.time?.created ??
          0)
      ) {
        existing.latestSession = session;
        // Keep list subtitle in sync with the newest session’s last message.
        if (sessionPreview) existing.preview = sessionPreview;
      }
      continue;
    }

    const name =
      restoredAgent?.name ??
      marketplaceExpert?.displayName ??
      sessionAgentSnapshot?.name ??
      fallbackTitle ??
      t("session.agent_fallback_name", { id: agentId.slice(0, 8) });
    const description =
      restoredAgent && agent
        ? agent.description.trim() || t("session.default_title")
        : marketplaceExpert?.description ??
          sessionAgentSnapshot?.description ??
          t("session.agent_config_missing");

    groups.set(key, {
      key,
      agentId,
      name,
      description,
      preview: sessionPreview,
      avatarUrl:
        restoredAgent?.avatar.avatarUrl ??
        marketplaceExpert?.avatarUrl ??
        sessionAgentSnapshot?.avatarUrl ??
        null,
      avatarBackground:
        restoredAgent?.avatar.avatarBackground ??
        sessionAgentSnapshot?.avatarBackground ??
        "var(--ow-primary-light)",
      sessions: [session],
      latestSession: session,
    });
  }

  return Array.from(groups.values()).sort(
    (a, b) =>
      (b.latestSession.time?.updated ?? b.latestSession.time?.created ?? 0) -
      (a.latestSession.time?.updated ?? a.latestSession.time?.created ?? 0),
  );
}

export function buildAgentStarterItems(
  registry: AgentRegistry | null,
): AgentStarterItem[] {
  if (!registry) return [];
  return registry.templates
    .filter((template) => template.showInOverview)
    .map((template) => {
      const restoredAgent = buildPendingAgentFromRecord(template, registry);
      return {
        key: `starter:${template.id}`,
        agentId: template.id,
        name: restoredAgent?.name ?? template.name,
        description: template.description.trim() || t("session.cmd_new_session_title"),
        avatarUrl: restoredAgent?.avatar.avatarUrl ?? null,
        avatarBackground:
          restoredAgent?.avatar.avatarBackground ?? "var(--ow-primary-light)",
      };
    });
}
