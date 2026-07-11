import { t } from "../../../../../i18n";
import type {
  OnMyAgentServerStatus,
  OnMyAgentSessionMessage,
  OnMyAgentSessionSnapshot,
} from "../../../../../app/lib/onmyagent-server";
import {
  DEFAULT_SESSION_TITLE,
  getDisplaySessionTitle,
  isGeneratedSessionTitle,
} from "../../../../../app/lib/session-title";
import type { WorkspaceSessionGroup } from "../../../../../app/types";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { createDefaultAgentRegistry } from "../../../agents/agent-default-registry";
import {
  resolveAgentAvatarUrl,
} from "../../../agents/agent-registry-helpers";
import type {
  AgentRegistry,
  AgentTemplate,
} from "../../../agents/agent-registry-types";
import {
  buildPendingAgentFromRecord,
} from "../../../agents/agent-registry-store";
import { findBuiltinMarketplaceExpertById } from "../../expert-marketplace/data";
import {
  readCustomAgentIdForSession,
  readSessionAgentSnapshot,
  useAgentRegistryStore,
  writeCustomAgentIdForSession,
} from "../../../agents/agent-registry-store";
import {
  isAssistantSession,
  isExpertSession,
} from "../../../agents/agent-session-state";
import {
  ONMYAGENT_ASSISTANT_AVATAR,
  onmyagentAssistantName,
} from "../../surface/personal-assistant-config";

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
  if (loading) return { label: "正在准备工作区", variant: "loading" };
  if (clientConnected) return { label: "可接受新任务", variant: "available" };
  if (onmyagentServerStatus === "limited") {
    return { label: "受限模式", variant: "limited" };
  }
  return { label: "暂不可接受任务", variant: "offline" };
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
  if (dayDelta === 1) return "昨天";
  return `${date.getMonth() + 1}/${date.getDate()}`;
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
  if (part.type === "reasoning") return part.text.trim();
  if (part.type === "tool") return `[工具] ${part.tool}`;
  if (part.type === "agent") return part.name ? `@${part.name}` : "@智能体";
  if (part.type === "file") return "[文件]";
  return "";
}

export function sessionMessagePreview(message: OnMyAgentSessionMessage) {
  return message.parts
    .map(messagePartPreview)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function snapshotConversationSummary(
  snapshot: OnMyAgentSessionSnapshot | undefined,
  fallbackTime: number | null | undefined,
) {
  if (!snapshot) {
    return { preview: "新建会话", time: formatConversationTime(fallbackTime) };
  }
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (!message) continue;
    const preview = sessionMessagePreview(message);
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
  return {
    preview: "新建会话",
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

function summarizeAssistantGeneratedTitle(input: string | undefined) {
  const cleaned = (input ?? "")
    .replace(/用户发送了|The user|I should|This is/gi, "")
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
): AgentConversationGroup[] {
  return sessions
    .filter((session) => isAssistantSession(session.id))
    .map((session) => ({
      key: `assistant:${session.id}`,
      agentId: null,
      name: onmyagentAssistantName(),
      description: assistantTaskTitle(
        session,
        generatedTitleFallbacks?.get(session.id),
      ),
      avatarUrl: resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR),
      avatarBackground: "#eef7f2",
      sessions: [session],
      latestSession: session,
    }))
    .sort(
      (a, b) =>
        (b.latestSession.time?.updated ?? b.latestSession.time?.created ?? 0) -
        (a.latestSession.time?.updated ?? a.latestSession.time?.created ?? 0),
    );
}

export function buildAgentConversationGroups(
  sessions: WorkspaceSessionGroup["sessions"],
  registry: AgentRegistry | null,
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

    if (existing) {
      existing.sessions.push(session);
      if (
        (session.time?.updated ?? session.time?.created ?? 0) >
        (existing.latestSession.time?.updated ??
          existing.latestSession.time?.created ??
          0)
      ) {
        existing.latestSession = session;
      }
      continue;
    }

    const name =
      restoredAgent?.name ??
      marketplaceExpert?.displayName ??
      sessionAgentSnapshot?.name ??
      fallbackTitle ??
      `智能体 (${agentId.slice(0, 8)}...)`;
    const description =
      restoredAgent && agent
        ? agent.description.trim() || "新建会话"
        : marketplaceExpert?.description ??
          sessionAgentSnapshot?.description ??
          "该智能体的配置尚未加载或已被删除";

    groups.set(key, {
      key,
      agentId,
      name,
      description,
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
