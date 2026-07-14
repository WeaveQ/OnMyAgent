/** @jsxImportSource react */
import { create } from "zustand";

import {
  friendlyModelNameToModelRef,
  isValidSdkModelRef,
  resolveAgentAvatarUrl,
} from "./agent-registry-helpers";
import { buildAgentSystemPrompt, buildAgentToolAccess } from "./pending-agent-store";
import type { PendingAgentContext } from "./pending-agent-store";
import type {
  AgentRecord,
  AgentRegistry,
  AgentTemplate,
} from "./agent-registry-types";

const REGISTRY_CACHE_KEY = "onmyagent:agentRegistryCache";
const AGENT_ID_BY_SESSION_KEY = "onmyagent:customAgentBySessionId";
const AGENT_SNAPSHOT_BY_SESSION_KEY = "onmyagent:customAgentSnapshotBySessionId";

export type SessionAgentSnapshot = {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  avatarBackground: string | null;
  systemPrompt: string;
  runtime?: "browser-use-agent";
};

function readRegistryCache(): AgentRegistry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(REGISTRY_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AgentRegistry;
  } catch {
    return null;
  }
}

function writeRegistryCache(registry: AgentRegistry | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (!registry) {
      localStorage.removeItem(REGISTRY_CACHE_KEY);
    } else {
      localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(registry));
    }
  } catch {
  }
}

function registryContentEqual(
  left: AgentRegistry | null,
  right: AgentRegistry | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

type AgentRegistryStore = {
  registry: AgentRegistry | null;
  setRegistry: (registry: AgentRegistry | null) => void;
  getRegistry: () => AgentRegistry | null;
};

export const useAgentRegistryStore = create<AgentRegistryStore>((set, get) => ({
  registry: readRegistryCache(),
  setRegistry: (registry) => {
    if (registryContentEqual(get().registry, registry)) return;
    writeRegistryCache(registry);
    set({ registry });
  },
  getRegistry: () => get().registry,
}));

export function readCustomAgentIdForSession(sessionId: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(AGENT_ID_BY_SESSION_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[sessionId] ?? null;
  } catch {
    return null;
  }
}

export function readCustomAgentSessionEntries(): Array<{
  sessionId: string;
  agentId: string;
}> {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(AGENT_ID_BY_SESSION_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed).flatMap(([sessionId, agentId]) =>
      typeof agentId === "string" && agentId
        ? [{ sessionId, agentId }]
        : [],
    );
  } catch {
    return [];
  }
}

export function writeCustomAgentIdForSession(
  sessionId: string,
  agentId: string | null,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(AGENT_ID_BY_SESSION_KEY);
    const map = (raw ? (JSON.parse(raw) as Record<string, string>) : {}) as Record<string, string>;
    if (!agentId) {
      delete map[sessionId];
    } else {
      map[sessionId] = agentId;
    }
    localStorage.setItem(AGENT_ID_BY_SESSION_KEY, JSON.stringify(map));
  } catch {
  }
}

function parseSessionAgentSnapshot(value: unknown): SessionAgentSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    !("id" in value) ||
    !("name" in value) ||
    !("description" in value) ||
    !("systemPrompt" in value)
  ) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.systemPrompt !== "string"
  ) return null;
  const avatarUrl = "avatarUrl" in value && typeof value.avatarUrl === "string"
    ? value.avatarUrl
    : null;
  const avatarBackground =
    "avatarBackground" in value && typeof value.avatarBackground === "string"
      ? value.avatarBackground
      : null;
  const runtime = "runtime" in value && value.runtime === "browser-use-agent"
    ? value.runtime
    : undefined;
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    avatarUrl,
    avatarBackground,
    systemPrompt: value.systemPrompt,
    runtime,
  };
}

function readSessionAgentSnapshotRecord() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(AGENT_SNAPSHOT_BY_SESSION_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return {};
  }
}

export function readSessionAgentSnapshot(
  sessionId: string,
): SessionAgentSnapshot | null {
  return parseSessionAgentSnapshot(readSessionAgentSnapshotRecord()[sessionId]);
}

export function writeSessionAgentSnapshot(
  sessionId: string,
  agent: PendingAgentContext | null,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const record = readSessionAgentSnapshotRecord();
    if (!agent) {
      delete record[sessionId];
    } else {
      record[sessionId] = {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        avatarUrl: agent.avatar.avatarUrl,
        avatarBackground: agent.avatar.avatarBackground,
        systemPrompt: agent.systemPrompt,
        runtime: agent.runtime,
      };
    }
    localStorage.setItem(AGENT_SNAPSHOT_BY_SESSION_KEY, JSON.stringify(record));
  } catch {
  }
}

export function buildPendingAgentFromRecord(
  agent: AgentRecord | AgentTemplate,
  registry: AgentRegistry,
): PendingAgentContext | null {
  const customAvatarDataUrl =
    "customAvatarDataUrl" in agent ? (agent.customAvatarDataUrl ?? null) : null;
  const { url: avatarUrl, background: avatarBackground } = resolveAgentAvatarUrl(
    {
      avatarStyle: agent.avatarStyle,
      avatarOptionId: agent.avatarOptionId,
      customAvatarDataUrl,
    },
    registry,
  );
  const modelRef = isValidSdkModelRef(agent.sdkProviderID, agent.sdkModelID)
    ? { providerID: agent.sdkProviderID!, modelID: agent.sdkModelID! }
    : friendlyModelNameToModelRef(agent.modelProvider, agent.model);
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    avatar: {
      avatarStyle: agent.avatarStyle,
      avatarOptionId: agent.avatarOptionId,
      customAvatarDataUrl,
      avatarUrl,
      avatarBackground,
    },
    systemPrompt: buildAgentSystemPrompt(agent),
    model: modelRef ?? undefined,
    tools: buildAgentToolAccess(agent),
  };
}
