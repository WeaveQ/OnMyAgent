import { useCallback, useEffect, useRef, useState } from "react";
import type { Client, ComposerAttachment, ModelRef } from "../../app/types";
import {
  beginHomePromptEnhance,
  collectDraftMentionNames,
  completeHomePromptEnhance,
  dropHomePromptEnhanceSnapshot,
  failHomePromptEnhance,
  homePromptEnhanceButtonMode,
  INITIAL_HOME_PROMPT_ENHANCE_STATE,
  undoHomePromptEnhance,
  type HomePromptEnhanceState,
} from "../../app/lib/enhance-home-prompt-model";
import {
  enhancePromptWithScratchSession,
  type PromptEnhanceTurn,
} from "../../app/lib/opencode-enhance-prompt";
import { t } from "../../i18n";

export type UseHomePromptEnhanceInput = {
  enabled: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  selectedModel: ModelRef;
  modelUnavailable?: boolean;
  modelVariant?: string | null;
  attachments: ComposerAttachment[];
  workspaceFolderName?: string | null;
  recentTurns?: readonly PromptEnhanceTurn[];
  directory?: string | null;
  client: Client | null;
  onNotice?: (notice: { title: string; tone?: "info" | "success" | "warning" | "error" }) => void;
};

export function useHomePromptEnhance(input: UseHomePromptEnhanceInput) {
  const [state, setState] = useState<HomePromptEnhanceState>(INITIAL_HOME_PROMPT_ENHANCE_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const inputRef = useRef(input);
  inputRef.current = input;
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const modelAvailable =
    !input.modelUnavailable &&
    Boolean(input.selectedModel.providerID?.trim() && input.selectedModel.modelID?.trim()) &&
    Boolean(input.client);
  const mode = homePromptEnhanceButtonMode({
    draft: input.draft,
    modelAvailable,
    state,
  });

  const dropSnapshot = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState(dropHomePromptEnhanceSnapshot());
  }, []);

  useEffect(() => {
    if (!input.enabled) dropSnapshot();
  }, [dropSnapshot, input.enabled]);

  useEffect(() => {
    if (!input.enabled) return;
    if (input.draft.trim()) return;
    if (state.phase === "idle" && state.snapshot === null) return;
    dropSnapshot();
  }, [dropSnapshot, input.draft, input.enabled, state.phase, state.snapshot]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  const wrapSend = useCallback(
    (onSend: () => void | Promise<void>) => {
      return () => {
        dropSnapshot();
        return onSend();
      };
    },
    [dropSnapshot],
  );

  const runEnhance = useCallback(async () => {
    const current = inputRef.current;
    if (!current.enabled || !current.client) return;
    const available =
      !current.modelUnavailable &&
      Boolean(current.selectedModel.providerID?.trim() && current.selectedModel.modelID?.trim());
    if (
      homePromptEnhanceButtonMode({
        draft: current.draft,
        modelAvailable: available,
        state: stateRef.current,
      }) !== "enhance"
    ) {
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const snapshotDraft = current.draft;
    setState((prev) => beginHomePromptEnhance(prev, snapshotDraft));
    try {
      const next = await enhancePromptWithScratchSession({
        client: current.client,
        directory: current.directory,
        model: current.selectedModel,
        variant: current.modelVariant,
        draft: snapshotDraft,
        attachmentNames: current.attachments.map((item) => item.name).filter(Boolean),
        workspaceFolderName: current.workspaceFolderName,
        mentionNames: collectDraftMentionNames(snapshotDraft),
        recentTurns: current.recentTurns,
        signal: abort.signal,
      });
      if (generation !== generationRef.current) return;
      setState((prev) => completeHomePromptEnhance(prev));
      current.onDraftChange(next);
    } catch (error) {
      if (generation !== generationRef.current) return;
      setState((prev) => failHomePromptEnhance(prev));
      if (error instanceof DOMException && error.name === "AbortError") return;
      current.onNotice?.({
        title: t("composer.enhance_prompt_failed"),
        tone: "warning",
      });
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
    }
  }, []);

  const runUndo = useCallback(() => {
    const result = undoHomePromptEnhance(stateRef.current);
    setState(result.state);
    if (result.restored !== null) inputRef.current.onDraftChange(result.restored);
  }, []);

  const onPress = useCallback(() => {
    if (mode === "undo") {
      runUndo();
      return;
    }
    if (mode === "enhance") void runEnhance();
  }, [mode, runEnhance, runUndo]);

  return {
    mode,
    onPress,
    wrapSend,
    dropSnapshot,
  };
}
