export type ExpertDraftSuggestion = {
  name?: string;
  description?: string;
  userNote?: string;
  agentMemory?: string;
};

const EXPERT_UPDATE_START = "<expert-update>";
const EXPERT_UPDATE_END = "</expert-update>";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExpertDraftSuggestion(content: string): {
  content: string;
  suggestion: ExpertDraftSuggestion | null;
} {
  const start = content.lastIndexOf(EXPERT_UPDATE_START);
  if (start < 0) return { content, suggestion: null };
  const end = content.indexOf(EXPERT_UPDATE_END, start + EXPERT_UPDATE_START.length);
  const visibleContent = content.slice(0, start).trimEnd();
  if (end < 0) return { content: visibleContent, suggestion: null };
  try {
    const parsed: unknown = JSON.parse(content.slice(start + EXPERT_UPDATE_START.length, end));
    if (!isRecord(parsed)) return { content: visibleContent, suggestion: null };
    const suggestion: ExpertDraftSuggestion = {};
    if (typeof parsed.name === "string" && parsed.name.trim()) suggestion.name = parsed.name.trim();
    if (typeof parsed.description === "string" && parsed.description.trim()) suggestion.description = parsed.description.trim();
    if (typeof parsed.userNote === "string" && parsed.userNote.trim()) suggestion.userNote = parsed.userNote.trim();
    if (typeof parsed.agentMemory === "string" && parsed.agentMemory.trim()) suggestion.agentMemory = parsed.agentMemory.trim();
    return {
      content: visibleContent,
      suggestion: Object.keys(suggestion).length > 0 ? suggestion : null,
    };
  } catch {
    return { content: visibleContent, suggestion: null };
  }
}
