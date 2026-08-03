import type { AgentWizardDraft } from "./agent-registry-types";

export type ExpertDraftSuggestion = {
  name?: string;
  description?: string;
  userNote?: string;
  agentMemory?: string;
};

export type ExpertDraftSuggestionField = keyof ExpertDraftSuggestion;

export type ExpertDraftSuggestionApplyMode = "empty-only" | "force";

export const EXPERT_DRAFT_SUGGESTION_FIELDS = [
  "name",
  "description",
  "userNote",
  "agentMemory",
] as const satisfies readonly ExpertDraftSuggestionField[];

export type ExpertDraftSuggestionPartition = {
  emptyFill: ExpertDraftSuggestion;
  conflicts: ExpertDraftSuggestion;
  matches: ExpertDraftSuggestion;
  emptyFillKeys: ExpertDraftSuggestionField[];
  conflictKeys: ExpertDraftSuggestionField[];
  matchKeys: ExpertDraftSuggestionField[];
};

const EXPERT_UPDATE_START = "<expert-update>";
const EXPERT_UPDATE_END = "</expert-update>";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSuggestionField(
  suggestion: ExpertDraftSuggestion,
  field: ExpertDraftSuggestionField,
): string | undefined {
  const value = suggestion[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readDraftField(
  draft: AgentWizardDraft,
  field: ExpertDraftSuggestionField,
): string {
  return draft[field].trim();
}

function suggestionFromRecord(parsed: Record<string, unknown>): ExpertDraftSuggestion | null {
  const suggestion: ExpertDraftSuggestion = {};
  if (typeof parsed.name === "string" && parsed.name.trim()) suggestion.name = parsed.name.trim();
  if (typeof parsed.description === "string" && parsed.description.trim()) {
    suggestion.description = parsed.description.trim();
  }
  if (typeof parsed.userNote === "string" && parsed.userNote.trim()) {
    suggestion.userNote = parsed.userNote.trim();
  }
  if (typeof parsed.agentMemory === "string" && parsed.agentMemory.trim()) {
    suggestion.agentMemory = parsed.agentMemory.trim();
  }
  return Object.keys(suggestion).length > 0 ? suggestion : null;
}

/**
 * Strip tagged <expert-update> blocks and bare expert-draft JSON objects from
 * visible assistant text. Machine payload must never render in the transcript.
 */
export function parseExpertDraftSuggestion(content: string): {
  content: string;
  suggestion: ExpertDraftSuggestion | null;
} {
  let visible = content;
  let suggestion: ExpertDraftSuggestion | null = null;

  const start = visible.lastIndexOf(EXPERT_UPDATE_START);
  if (start >= 0) {
    const end = visible.indexOf(EXPERT_UPDATE_END, start + EXPERT_UPDATE_START.length);
    const before = visible.slice(0, start).trimEnd();
    if (end < 0) {
      visible = before;
    } else {
      try {
        const parsed: unknown = JSON.parse(
          visible.slice(start + EXPERT_UPDATE_START.length, end),
        );
        if (isRecord(parsed)) {
          suggestion = suggestionFromRecord(parsed);
        }
      } catch {
        // keep suggestion null; still strip broken machine block from view
      }
      visible = `${before}${visible.slice(end + EXPERT_UPDATE_END.length)}`.trimEnd();
    }
  }

  // Models sometimes dump the payload as raw JSON without tags (user-visible leak).
  const bare = stripBareExpertDraftJson(visible);
  visible = bare.content;
  if (!suggestion && bare.suggestion) suggestion = bare.suggestion;

  return {
    content: visible.replace(/\n{3,}/g, "\n\n").trim(),
    suggestion,
  };
}

/** Display-only helper: hide machine payload from transcript. */
export function stripExpertDraftSuggestionFromText(content: string): string {
  return parseExpertDraftSuggestion(content).content;
}

/**
 * Find the last parseable JSON object that looks like an expert draft proposal
 * and remove it from visible text.
 */
function stripBareExpertDraftJson(content: string): {
  content: string;
  suggestion: ExpertDraftSuggestion | null;
} {
  let best: { start: number; end: number; suggestion: ExpertDraftSuggestion } | null =
    null;
  for (let start = content.lastIndexOf("{"); start >= 0; start = content.lastIndexOf("{", start - 1)) {
    for (let end = content.indexOf("}", start + 1); end >= 0; end = content.indexOf("}", end + 1)) {
      const slice = content.slice(start, end + 1);
      try {
        const parsed: unknown = JSON.parse(slice);
        if (!isRecord(parsed)) continue;
        // Require at least name + one body field so we don't strip unrelated JSON.
        const suggestion = suggestionFromRecord(parsed);
        if (!suggestion?.name) continue;
        if (!suggestion.description && !suggestion.userNote && !suggestion.agentMemory) {
          continue;
        }
        best = { start, end: end + 1, suggestion };
      } catch {
        // keep scanning
      }
    }
    if (best) break;
  }
  if (!best) return { content, suggestion: null };
  const next = `${content.slice(0, best.start)}${content.slice(best.end)}`
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { content: next, suggestion: best.suggestion };
}

/** Stable key for pending/dismissed tracking across multi-turn coach proposals. */
export function expertDraftSuggestionFingerprint(
  messageId: string,
  suggestion: ExpertDraftSuggestion,
): string {
  return `${messageId}:${JSON.stringify({
    name: suggestion.name ?? "",
    description: suggestion.description ?? "",
    userNote: suggestion.userNote ?? "",
    agentMemory: suggestion.agentMemory ?? "",
  })}`;
}

export function partitionExpertDraftSuggestion(
  draft: AgentWizardDraft,
  suggestion: ExpertDraftSuggestion,
): ExpertDraftSuggestionPartition {
  const emptyFill: ExpertDraftSuggestion = {};
  const conflicts: ExpertDraftSuggestion = {};
  const matches: ExpertDraftSuggestion = {};
  const emptyFillKeys: ExpertDraftSuggestionField[] = [];
  const conflictKeys: ExpertDraftSuggestionField[] = [];
  const matchKeys: ExpertDraftSuggestionField[] = [];

  for (const field of EXPERT_DRAFT_SUGGESTION_FIELDS) {
    const next = readSuggestionField(suggestion, field);
    if (!next) continue;
    const current = readDraftField(draft, field);
    if (!current) {
      emptyFill[field] = next;
      emptyFillKeys.push(field);
      continue;
    }
    if (current === next) {
      matches[field] = next;
      matchKeys.push(field);
      continue;
    }
    conflicts[field] = next;
    conflictKeys.push(field);
  }

  return {
    emptyFill,
    conflicts,
    matches,
    emptyFillKeys,
    conflictKeys,
    matchKeys,
  };
}

export function mergeExpertDraftSuggestion(
  draft: AgentWizardDraft,
  suggestion: ExpertDraftSuggestion,
  mode: ExpertDraftSuggestionApplyMode,
): { draft: AgentWizardDraft; appliedKeys: ExpertDraftSuggestionField[] } {
  const partition = partitionExpertDraftSuggestion(draft, suggestion);
  const patch =
    mode === "force"
      ? { ...partition.emptyFill, ...partition.conflicts }
      : partition.emptyFill;
  const appliedKeys =
    mode === "force"
      ? [...partition.emptyFillKeys, ...partition.conflictKeys]
      : partition.emptyFillKeys;
  if (appliedKeys.length === 0) {
    return { draft, appliedKeys };
  }
  return {
    draft: { ...draft, ...patch },
    appliedKeys,
  };
}

export function expertDraftSuggestionNeedsSync(
  partition: ExpertDraftSuggestionPartition,
): boolean {
  return partition.emptyFillKeys.length > 0 || partition.conflictKeys.length > 0;
}
