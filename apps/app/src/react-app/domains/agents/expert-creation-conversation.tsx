/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type { ComposerAttachment, ModelRef } from "../../../app/types";
import { t } from "../../../i18n";
import { cn } from "@/lib/utils";
import type { AgentWizardDraft } from "./agent-registry-types";
import { runExpertPreviewTurn } from "./expert-creation-preview-runtime";
import {
  parseExpertDraftSuggestion,
  type ExpertDraftSuggestion,
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
  knowledgePaths?: readonly string[];
  emptyMessage: string;
  disabled?: boolean;
  hideHeader?: boolean;
  className?: string;
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  onApplyDraftSuggestion?: (suggestion: ExpertDraftSuggestion) => void;
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
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

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

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed) revokePreview(removed);
      return current.filter((attachment) => attachment.id !== id);
    });
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
                    props.onApplyDraftSuggestion?.(suggestion);
                    setMessages((current) => current.map((item) => (
                      item.id === message.id ? { ...item, suggestionApplied: true } : item
                    )));
                  }}
                >
                  {message.suggestionApplied
                    ? t("agents.expert_creation_suggestion_applied")
                    : t("agents.expert_creation_apply_suggestion")}
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
