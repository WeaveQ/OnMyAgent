import { useMemo, type RefObject } from "react";
import type { UIMessage } from "ai";
import { t } from "../../../../i18n";
import {
  type OnMyAgentControlAction,
  useControlAction,
} from "../../../shell";
import type { ComposerAttachment, ComposerDraft } from "../../../../app/types";
import {
  controlRecentMessageCount,
  controlTextArgument,
  DEFAULT_COMPOSER_CONTROL_TEXT,
  latestMessageControlResult,
  transcriptControlResult,
} from "./session-surface-model";

export type SessionSurfaceControlActionsInput = {
  composerShellRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  typeComposerText: (text: string) => Promise<void>;
  onDraftChange: (draft: ComposerDraft) => void;
  buildDraft: (text: string, attachments: ComposerAttachment[]) => ComposerDraft;
  attachments: ComposerAttachment[];
  draft: string;
  handleSend: () => Promise<void>;
  handleAbort: () => Promise<void>;
  modelUnavailable?: boolean;
  transitionState: string;
  chatStreaming: boolean;
  sessionId: string;
  renderedMessages: UIMessage[];
  jumpToLatest: (behavior?: ScrollBehavior) => void;
};

/** Register session/composer control actions (mechanical extract from SessionSurface). */
export function useSessionSurfaceControlActions(input: SessionSurfaceControlActionsInput) {
  const {
    composerShellRef,
    scrollRef,
    typeComposerText,
    onDraftChange,
    buildDraft,
    attachments,
    draft,
    handleSend,
    handleAbort,
    modelUnavailable,
    transitionState,
    chatStreaming,
    sessionId,
    renderedMessages,
    jumpToLatest,
  } = input;

  const composerSetTextControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "composer.set_text",
      label: t("session.control_type_composer"),
      description:
        "Replace the current session draft and type the supplied text visibly.",
      sideEffect: "none",
      requiresArgs: true,
      args: [
        {
          name: "text",
          type: "string",
          required: true,
          description: t("session.control_prompt_text_desc"),
        },
      ],
      previewArgs: { text: DEFAULT_COMPOSER_CONTROL_TEXT },
      targetRef: composerShellRef,
      execute: async (args, helpers) => {
        const text = controlTextArgument(args);
        helpers.setNarration(
          t("session.control_typing_chars", {
            count: text.length.toLocaleString(),
          }),
        );
        await typeComposerText(text);
        onDraftChange(buildDraft(text, attachments));
        return { draftLength: text.length };
      },
    }),
    [attachments, buildDraft, onDraftChange, typeComposerText],
  );
  useControlAction(composerSetTextControlAction);

  const composerSendControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "composer.send",
      label: t("session.control_send_composer"),
      description: t("session.control_send_composer_desc"),
      sideEffect: "mutation",
      disabled:
        modelUnavailable ||
        (!draft.trim() && attachments.length === 0) ||
        transitionState !== "idle",
      targetRef: composerShellRef,
      execute: async () => {
        await handleSend();
        return true;
      },
    }),
    [
      attachments.length,
      draft,
      handleSend,
      transitionState,
      modelUnavailable,
    ],
  );
  useControlAction(composerSendControlAction);

  const composerStopControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "composer.stop",
      label: t("session.control_stop_run"),
      description: t("session.control_stop_run_desc"),
      sideEffect: "mutation",
      disabled: !chatStreaming,
      targetRef: composerShellRef,
      execute: async () => {
        await handleAbort();
        return true;
      },
    }),
    [chatStreaming, handleAbort],
  );
  useControlAction(composerStopControlAction);

  const sessionScrollTopControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "session.scroll_top",
      label: t("session.control_scroll_top"),
      description: t("session.control_scroll_top_desc"),
      sideEffect: "none",
      execute: () => {
        const container = scrollRef.current;
        if (!container)
          return { ok: false, error: t("session.control_transcript_not_mounted") };
        container.scrollTo({ top: 0, behavior: "smooth" });
        return { ok: true, position: "top" };
      },
    }),
    [],
  );
  useControlAction(sessionScrollTopControlAction);

  const sessionScrollBottomControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "session.scroll_bottom",
      label: t("session.control_scroll_bottom"),
      description: t("session.control_scroll_bottom_desc"),
      sideEffect: "none",
      execute: () => {
        jumpToLatest("smooth");
        return { ok: true, position: "bottom" };
      },
    }),
    [jumpToLatest],
  );
  useControlAction(sessionScrollBottomControlAction);

  const sessionLatestMessageControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "session.latest_message",
      label: t("session.voice_read_latest_short"),
      description: t("session.control_latest_message_desc"),
      sideEffect: "none",
      execute: () => {
        const result = latestMessageControlResult({
          messages: renderedMessages,
          sessionId: sessionId,
        });
        if (!result)
          return {
            ok: false,
            error: t("session.control_no_visible_messages"),
          };
        return result;
      },
    }),
    [sessionId, renderedMessages],
  );
  useControlAction(sessionLatestMessageControlAction);

  const sessionReadTranscriptControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "session.read_transcript",
      label: t("session.control_read_transcript"),
      description: t("session.control_read_transcript_desc"),
      sideEffect: "none",
      args: [
        {
          name: "count",
          type: "number",
          required: false,
          description: t("session.control_recent_messages_count_desc"),
        },
      ],
      execute: (args) => {
        const result = transcriptControlResult({
          count: controlRecentMessageCount(args),
          messages: renderedMessages,
          sessionId: sessionId,
        });
        if (!result)
          return { ok: false, error: t("session.control_no_messages") };
        return result;
      },
    }),
    [sessionId, renderedMessages],
  );
  useControlAction(sessionReadTranscriptControlAction);
}
