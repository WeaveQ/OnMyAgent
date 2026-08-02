import type { AgentWizardDraft } from "./agent-registry-types";
import {
  parseExpertCoachProposal,
  type ExpertCoachProposal,
} from "./expert-creation-coach-model";

const STORAGE_KEY_PREFIX = "onmyagent.expert-creation.v1";

export type ExpertCoachMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  proposal?: ExpertCoachProposal;
};

export type ExpertCoachVersion = {
  id: string;
  createdAt: number;
  proposal: ExpertCoachProposal;
};

export type ExpertCoachState = {
  sessionId: string | null;
  messages: ExpertCoachMessage[];
  versions: ExpertCoachVersion[];
  appliedVersionId: string | null;
};

export type ExpertCreationStoredState = {
  draft: AgentWizardDraft;
  coach: ExpertCoachState;
};

export const EMPTY_EXPERT_COACH_STATE: ExpertCoachState = {
  sessionId: null,
  messages: [],
  versions: [],
  appliedVersionId: null,
};

function storageKey(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}:${workspaceId.trim() || "default"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function optionalNullableString(value: unknown, fallback: string | null): string | null {
  return value === null || typeof value === "string" ? value : fallback;
}

function parseMessage(value: unknown): ExpertCoachMessage | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.content !== "string") return null;
  if (value.role !== "assistant" && value.role !== "user") return null;
  const proposal = value.proposal === undefined ? null : parseExpertCoachProposal(value.proposal);
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    ...(proposal ? { proposal } : {}),
  };
}

function parseVersion(value: unknown): ExpertCoachVersion | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.createdAt !== "number") return null;
  const proposal = parseExpertCoachProposal(value.proposal);
  return proposal ? { id: value.id, createdAt: value.createdAt, proposal } : null;
}

function parseCoachState(value: unknown): ExpertCoachState {
  if (!isRecord(value)) return EMPTY_EXPERT_COACH_STATE;
  return {
    sessionId: optionalNullableString(value.sessionId, null),
    messages: Array.isArray(value.messages)
      ? value.messages.map(parseMessage).filter((item): item is ExpertCoachMessage => Boolean(item))
      : [],
    versions: Array.isArray(value.versions)
      ? value.versions.map(parseVersion).filter((item): item is ExpertCoachVersion => Boolean(item))
      : [],
    appliedVersionId: optionalNullableString(value.appliedVersionId, null),
  };
}

function restoreDraft(value: unknown, fallback: AgentWizardDraft): AgentWizardDraft {
  if (!isRecord(value)) return fallback;
  const skillIds = Array.isArray(value.skillIds)
    ? value.skillIds.filter((item): item is string => typeof item === "string")
    : fallback.skillIds;
  return {
    ...fallback,
    name: optionalString(value.name, fallback.name),
    description: optionalString(value.description, fallback.description),
    avatarOptionId: optionalString(value.avatarOptionId, fallback.avatarOptionId),
    customAvatarDataUrl: optionalNullableString(value.customAvatarDataUrl, fallback.customAvatarDataUrl),
    userNote: optionalString(value.userNote, fallback.userNote),
    agentMemory: optionalString(value.agentMemory, fallback.agentMemory),
    skillIds,
  };
}

export function readExpertCreationStoredState(
  workspaceId: string,
  fallbackDraft: AgentWizardDraft,
): ExpertCreationStoredState {
  if (typeof window === "undefined") return { draft: fallbackDraft, coach: EMPTY_EXPERT_COACH_STATE };
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (!raw) return { draft: fallbackDraft, coach: EMPTY_EXPERT_COACH_STATE };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) {
      return { draft: fallbackDraft, coach: EMPTY_EXPERT_COACH_STATE };
    }
    return {
      draft: restoreDraft(parsed.draft, fallbackDraft),
      coach: parseCoachState(parsed.coach),
    };
  } catch {
    return { draft: fallbackDraft, coach: EMPTY_EXPERT_COACH_STATE };
  }
}

export function writeExpertCreationStoredState(
  workspaceId: string,
  state: ExpertCreationStoredState,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify({ version: 1, ...state }));
  } catch {
    // Storage is a recovery aid; creation must remain usable when it is unavailable.
  }
}

export function clearExpertCreationStoredState(workspaceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(workspaceId));
  } catch {
    // Ignore unavailable storage after a successful save.
  }
}
