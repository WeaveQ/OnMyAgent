export type HomePromptEnhancePhase = "idle" | "enhancing" | "undoable";

export type HomePromptEnhanceState = {
  phase: HomePromptEnhancePhase;
  snapshot: string | null;
};

export const INITIAL_HOME_PROMPT_ENHANCE_STATE: HomePromptEnhanceState = {
  phase: "idle",
  snapshot: null,
};

export type HomePromptEnhanceButtonMode = "disabled" | "enhance" | "loading" | "undo";

export function canEnhanceHomePrompt(input: {
  draft: string;
  modelAvailable: boolean;
}): boolean {
  return input.draft.trim().length > 0 && input.modelAvailable;
}

export function homePromptEnhanceButtonMode(input: {
  draft: string;
  modelAvailable: boolean;
  state: HomePromptEnhanceState;
}): HomePromptEnhanceButtonMode {
  if (input.state.phase === "enhancing") return "loading";
  if (input.state.phase === "undoable" && input.state.snapshot !== null) return "undo";
  if (canEnhanceHomePrompt({ draft: input.draft, modelAvailable: input.modelAvailable })) {
    return "enhance";
  }
  return "disabled";
}

/** One-level snapshot of the draft immediately before enhance. */
export function beginHomePromptEnhance(
  _state: HomePromptEnhanceState,
  currentDraft: string,
): HomePromptEnhanceState {
  return { phase: "enhancing", snapshot: currentDraft };
}

export function completeHomePromptEnhance(
  state: HomePromptEnhanceState,
): HomePromptEnhanceState {
  if (state.phase !== "enhancing" || state.snapshot === null) return state;
  return { phase: "undoable", snapshot: state.snapshot };
}

export function failHomePromptEnhance(
  _state: HomePromptEnhanceState,
): HomePromptEnhanceState {
  return INITIAL_HOME_PROMPT_ENHANCE_STATE;
}

export function undoHomePromptEnhance(state: HomePromptEnhanceState): {
  state: HomePromptEnhanceState;
  restored: string | null;
} {
  if (state.snapshot === null) {
    return { state: INITIAL_HOME_PROMPT_ENHANCE_STATE, restored: null };
  }
  return {
    state: INITIAL_HOME_PROMPT_ENHANCE_STATE,
    restored: state.snapshot,
  };
}

export function dropHomePromptEnhanceSnapshot(): HomePromptEnhanceState {
  return INITIAL_HOME_PROMPT_ENHANCE_STATE;
}

export function workspaceFolderNameFromPath(path: string | null | undefined): string {
  const trimmed = path?.trim() ?? "";
  if (!trimmed) return "";
  return (
    trimmed
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .pop() ?? trimmed
  );
}

export function collectDraftMentionNames(draft: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = /@([^\s@]+)/g;
  for (const match of draft.matchAll(pattern)) {
    const raw = match[1] ?? "";
    const name = raw.replaceAll("%20", " ").replaceAll("%25", "%").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
