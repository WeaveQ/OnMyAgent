/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ComposerAttachment, ModelRef } from "../../../app/types";
import { t } from "../../../i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentWizardDraft } from "./agent-registry-types";
import type { AgentToolAccessMap } from "./pending-agent-store";
import { runExpertPreviewTurn } from "./expert-creation-preview-runtime";
import {
  expertDraftSuggestionFingerprint,
  expertDraftSuggestionNeedsSync,
  expertDraftSuggestionPendingKeys,
  parseExpertDraftSuggestion,
  partitionExpertDraftSuggestion,
  type ExpertDraftSuggestion,
  type ExpertDraftSuggestionApplyMode,
  type ExpertDraftSuggestionField,
} from "./expert-creation-suggestions";

export type ExpertCreationComposerProps = {
  sessionId: string;
  draft: string;
  placeholder: string;
  busy: boolean;
  disabled?: boolean;
  attachments: ComposerAttachment[];
  onDraftChange: (value: string) => void;
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
};

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestion?: ExpertDraftSuggestion;
  suggestionApplied?: boolean;
};

export type ExpertCreationSuggestionApplyOptions = {
  mode: ExpertDraftSuggestionApplyMode;
};

export type ExpertCreationConversationProps = {
  draft: AgentWizardDraft;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  selectedModel: ModelRef | null;
  title: string;
  avatar: ReactNode;
  initialContent?: ReactNode;
  emptyContent?: ReactNode;
  placeholder: string;
  systemPrompt?: string;
  /** Optional tool policy for this conversation (e.g. coach chat-only). */
  tools?: AgentToolAccessMap;
  knowledgePaths?: readonly string[];
  emptyMessage: string;
  disabled?: boolean;
  hideHeader?: boolean;
  className?: string;
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  onApplyDraftSuggestion?: (
    suggestion: ExpertDraftSuggestion,
    options: ExpertCreationSuggestionApplyOptions,
  ) => void;
};

function createAttachments(files: File[]): ComposerAttachment[] {
  return files.map((file) => ({
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind: file.type.startsWith("image/") ? "image" : "file",
    file,
    previewUrl: file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : undefined,
  }));
}

function revokePreview(attachment: ComposerAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

function suggestionFieldLabel(field: ExpertDraftSuggestionField): string {
  switch (field) {
    case "name":
      return t("agents.expert_creation_suggestion_field_name");
    case "description":
      return t("agents.expert_creation_suggestion_field_description");
    case "userNote":
      return t("agents.expert_creation_suggestion_field_role_prompt");
    case "agentMemory":
      return t("agents.expert_creation_suggestion_field_memory");
  }
}

function formatSuggestionFields(fields: readonly ExpertDraftSuggestionField[]): string {
  return fields.map(suggestionFieldLabel).join(t("agents.expert_creation_suggestion_field_sep"));
}

export function ExpertCreationConversation(
  props: ExpertCreationConversationProps,
) {
  const [composerDraft, setComposerDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draftSessionId] = useState(
    () => `expert-creation-draft-${crypto.randomUUID()}`,
  );
  const [sending, setSending] = useState(false);
  const [dismissedSuggestionKey, setDismissedSuggestionKey] = useState<string | null>(null);
  const [autoFilledSuggestionKey, setAutoFilledSuggestionKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef(attachments);
  const onApplyDraftSuggestionRef = useRef(props.onApplyDraftSuggestion);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    onApplyDraftSuggestionRef.current = props.onApplyDraftSuggestion;
  }, [props.onApplyDraftSuggestion]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      attachmentsRef.current.forEach(revokePreview);
    },
    [],
  );

  const latestSuggestion = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "assistant" && message.suggestion) {
        return {
          messageId: message.id,
          suggestion: message.suggestion,
          suggestionApplied: Boolean(message.suggestionApplied),
        };
      }
    }
    return null;
  }, [messages]);

  const latestSuggestionKey = latestSuggestion
    ? expertDraftSuggestionFingerprint(
        latestSuggestion.messageId,
        latestSuggestion.suggestion,
      )
    : null;

  const latestPartition = useMemo(() => {
    if (!latestSuggestion) return null;
    return partitionExpertDraftSuggestion(props.draft, latestSuggestion.suggestion);
  }, [latestSuggestion, props.draft]);

  const latestNeedsSync = Boolean(
    latestPartition && expertDraftSuggestionNeedsSync(latestPartition),
  );

  // Auto-fill empty right-panel fields once per proposal after streaming ends.
  // Conflict fields stay pending until the sticky bar force-apply.
  useEffect(() => {
    if (sending || !latestSuggestion || !latestSuggestionKey || !latestPartition) return;
    if (dismissedSuggestionKey === latestSuggestionKey) return;
    if (autoFilledSuggestionKey === latestSuggestionKey) return;
    setAutoFilledSuggestionKey(latestSuggestionKey);
    if (latestPartition.emptyFillKeys.length === 0) return;
    onApplyDraftSuggestionRef.current?.(latestSuggestion.suggestion, {
      mode: "empty-only",
    });
  }, [
    autoFilledSuggestionKey,
    dismissedSuggestionKey,
    latestPartition,
    latestSuggestion,
    latestSuggestionKey,
    sending,
  ]);

  // When draft catches up to the latest proposal, mark that message applied.
  useEffect(() => {
    if (!latestSuggestion || latestSuggestion.suggestionApplied || latestNeedsSync) return;
    setMessages((current) =>
      current.map((item) =>
        item.id === latestSuggestion.messageId
          ? { ...item, suggestionApplied: true }
          : item,
      ),
    );
  }, [latestNeedsSync, latestSuggestion]);

  // Sticky bar only for remaining conflicts after empty-only auto-fill.
  const showSuggestionBar = Boolean(
    !sending &&
      latestSuggestion &&
      latestSuggestionKey &&
      dismissedSuggestionKey !== latestSuggestionKey &&
      autoFilledSuggestionKey === latestSuggestionKey &&
      latestPartition &&
      expertDraftSuggestionPendingKeys(latestPartition).length > 0,
  );

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed) revokePreview(removed);
      return current.filter((attachment) => attachment.id !== id);
    });
  };

  const applySuggestion = (
    messageId: string,
    suggestion: ExpertDraftSuggestion,
    mode: ExpertDraftSuggestionApplyMode,
  ) => {
    props.onApplyDraftSuggestion?.(suggestion, { mode });
    if (mode === "force") {
      setMessages((current) =>
        current.map((item) =>
          item.id === messageId ? { ...item, suggestionApplied: true } : item,
        ),
      );
      if (
        latestSuggestion &&
        messageId === latestSuggestion.messageId &&
        latestSuggestionKey
      ) {
        setAutoFilledSuggestionKey(latestSuggestionKey);
        setDismissedSuggestionKey(null);
      }
    }
  };

  const send = async () => {
    const message = composerDraft.trim();
    if ((!message && attachments.length === 0) || sending || props.disabled) return;
    if (!props.selectedModel || !props.opencodeBaseUrl?.trim()) return;

    const submittedAttachments = attachments;
    const visibleContent =
      message ||
      t("agents.expert_creation_attachment_only", {
        count: submittedAttachments.length,
      });
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: visibleContent },
    ]);
    setComposerDraft("");
    setAttachments([]);

    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    const streamingId = crypto.randomUUID();
    try {
      const result = await runExpertPreviewTurn({
        config: {
          baseUrl: props.opencodeBaseUrl,
          token: props.onmyagentServerToken,
          workspaceRoot: props.workspaceRoot,
        },
        sessionId,
        message,
        attachments: submittedAttachments.map((attachment) => attachment.file),
        draft: props.draft,
        knowledgePaths: props.knowledgePaths,
        model: props.selectedModel,
        ...(props.systemPrompt ? { systemPrompt: props.systemPrompt } : {}),
        ...(props.tools !== undefined ? { tools: props.tools } : {}),
        signal: controller.signal,
        onTextChange: (content) => {
          const parsed = parseExpertDraftSuggestion(content);
          setMessages((current) => {
            const existing = current.findIndex((item) => item.id === streamingId);
            if (existing < 0) {
              return [
                ...current,
                {
                  id: streamingId,
                  role: "assistant",
                  content: parsed.content,
                  ...(parsed.suggestion ? { suggestion: parsed.suggestion } : {}),
                },
              ];
            }
            return current.map((item) =>
              item.id === streamingId
                ? {
                    ...item,
                    content: parsed.content,
                    ...(parsed.suggestion ? { suggestion: parsed.suggestion } : {}),
                  }
                : item,
            );
          });
        },
      });
      setSessionId(result.sessionId);
      if (!result.content.trim()) {
        setMessages((current) => [
          ...current.filter((item) => item.id !== streamingId),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: props.emptyMessage,
          },
        ]);
      }
      submittedAttachments.forEach(revokePreview);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessages((current) => [
          ...current.filter((item) => item.id !== streamingId),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: t("agents.expert_creation_preview_stopped"),
          },
        ]);
      } else {
        setComposerDraft((current) => current || message);
        setAttachments((current) => [...submittedAttachments, ...current]);
        setMessages((current) => [
          ...current.filter((item) => item.id !== streamingId),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: props.emptyMessage,
          },
        ]);
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", props.className)}>
      {!props.hideHeader ? (
        <div className="flex shrink-0 items-center gap-3">
          {props.avatar}
          <h2 className="truncate text-base font-semibold text-dls-text">
            {props.title}
          </h2>
        </div>
      ) : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pt-8">
        <div className="space-y-5 text-sm leading-7 text-dls-text">
          {props.initialContent}
          {messages.length === 0 && !sending ? props.emptyContent : null}
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[94%] rounded-xl px-3 py-2.5 leading-6",
                message.role === "user"
                  ? "ml-auto bg-dls-accent text-white"
                  : "bg-dls-hover text-dls-text",
              )}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.role === "assistant" && message.suggestion && props.onApplyDraftSuggestion ? (
                <button
                  type="button"
                  disabled={message.suggestionApplied}
                  className="mt-3 rounded-lg bg-dls-surface-muted px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-list-selected disabled:cursor-default disabled:opacity-60"
                  onClick={() => {
                    const suggestion = message.suggestion;
                    if (!suggestion) return;
                    applySuggestion(message.id, suggestion, "force");
                  }}
                >
                  {message.suggestionApplied
                    ? t("agents.expert_creation_suggestion_applied")
                    : t("agents.expert_creation_suggestion_reapply")}
                </button>
              ) : null}
            </div>
          ))}
          {sending && messages.at(-1)?.role === "user" ? (
            <div className="max-w-[94%] rounded-xl bg-dls-hover px-3 py-2.5 text-dls-secondary">
              {t("agents.expert_creation_coach_thinking")}
            </div>
          ) : null}
        </div>
      </div>
      {showSuggestionBar && latestSuggestion && latestPartition ? (
        <div className="mt-3 shrink-0 rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-3">
          <p className="text-sm font-medium text-dls-text">
            {latestPartition.confirmationKeys.length > 0
              ? t("agents.expert_creation_suggestion_bar_confirmation")
              : t("agents.expert_creation_suggestion_bar_conflict")}
          </p>
          <p className="mt-1 text-xs leading-5 text-dls-secondary">
            {latestPartition.confirmationKeys.length > 0
              ? t("agents.expert_creation_suggestion_bar_confirmation_detail", {
                  fields: formatSuggestionFields(expertDraftSuggestionPendingKeys(latestPartition)),
                })
              : t("agents.expert_creation_suggestion_bar_conflict_detail", {
                  fields: formatSuggestionFields(latestPartition.conflictKeys),
                })}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (latestSuggestionKey) {
                  setDismissedSuggestionKey(latestSuggestionKey);
                }
              }}
            >
              {t("agents.expert_creation_suggestion_ignore")}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                applySuggestion(
                  latestSuggestion.messageId,
                  latestSuggestion.suggestion,
                  "force",
                );
              }}
            >
              {t("agents.expert_creation_suggestion_apply")}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="shrink-0 pt-4">
        {props.renderComposer({
          sessionId: sessionId ?? draftSessionId,
          draft: composerDraft,
          placeholder: props.placeholder,
          busy: sending,
          disabled: props.disabled,
          attachments,
          onDraftChange: setComposerDraft,
          onAttachFiles: (files) =>
            setAttachments((current) => [...current, ...createAttachments(files)]),
          onRemoveAttachment: removeAttachment,
          onSend: () => void send(),
          onStop: () => abortRef.current?.abort(),
        })}
      </div>
    </div>
  );
}
