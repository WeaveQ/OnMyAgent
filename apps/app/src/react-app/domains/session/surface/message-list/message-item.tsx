/** @jsxImportSource react */
/** Single message / turn row rendering for the session transcript. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { UIMessage } from "ai";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  File as FileIcon,
  GitFork,
  Globe,
  MessageSquareWarning,
  MoreHorizontal,
  RotateCcw,
  Share2,
  Square,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MenuRowButton } from "@/components/ui/action-row";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoticeBox } from "@/components/ui/notice-box";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { buildFeedbackUrl } from "../../../../../app/lib/feedback";
import {
  SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX,
} from "../../../../../app/types";
import { isDesktopRuntime } from "../../../../../app/utils";
import { usePlatform } from "../../../../kernel/platform";
import { readTranscriptMessageMetadata } from "../../sync/message-metadata";
import { isOutputLimitContinuationMessageId } from "../../sync/output-limit-recovery";
import { MarkdownBlock, type MarkdownVerifiedCodePath } from "../markdown";
import { TranscriptResourceChip } from "../transcript-resource-chip";
import { applyTextHighlights } from "../text-highlights";
import {
  formatTranscriptDuration,
  formatTranscriptMessageTime,
} from "../transcript-presentation";
import {
  formatCompactTokenCount,
} from "../transcript/turn-presentation";
import {
  type TurnContentSegment,
  type TurnContentPresentation,
  type TurnFoldSegment,
  type TurnProcessItem,
} from "../transcript/turn-content";
import { InlineVisual } from "../transcript/inline-visual";
import type { OpenTarget } from "../../artifacts/open-target";
import type { TranscriptTurnPresentation } from "../transcript/turn-presentation";
import type {
  ConversationBlockItem,
  SessionTranscriptDividerVariant,
  TranscriptBlockTurnPresentation,
  TranscriptFeedbackValue,
} from "./types";
import {
  AVATAR_PALETTES,
  messageBlockStyle,
  messageStateClass,
  messageTextClass,
} from "./styles";
import {
  humanMediaType,
  isImageAttachment,
  messageGroupKey,
  messageToText,
  openFileWithOS,
  partToText,
  resolveDisplayedPastedText,
  revealFileInFinder,
  toggleTranscriptFeedback,
} from "./shared";
import { StepsContainer, WorkBuddyProcessFold } from "./tool-block";

export function AssistantAvatar(props: { name: string; avatarUrl: string | null; avatarBackground?: string | null }) {
  if (props.avatarUrl) {
    return (
      <div
        className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full"
        style={props.avatarBackground ? { background: props.avatarBackground } : undefined}
      >
        <img
          src={props.avatarUrl}
          alt={props.name}
          className="size-full rounded-full object-cover"
        />
      </div>
    );
  }
  const index =
    Math.abs(
      Array.from(props.name).reduce(
        (acc, ch) => acc * 31 + ch.charCodeAt(0),
        0,
      ),
    ) % AVATAR_PALETTES.length;
  const palette = AVATAR_PALETTES[index]!;
  return (
    <div
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
      style={{ background: palette.background, color: palette.foreground }}
    >
      {props.name.slice(0, 1) || t("session.agent_initial")}
    </div>
  );
}


export function CopyButton(props: { getText: () => string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={t("session.copy_message")}
      aria-label={t("session.copy_message")}
      onClick={async () => {
        await navigator.clipboard.writeText(props.getText());
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2_000);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  );
}

export function TranscriptSpeechButton(props: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const speechAvailable = typeof window !== "undefined" && "speechSynthesis" in window;
  if (!speechAvailable || !props.text.trim()) return null;

  const toggleSpeech = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(props.text);
    utterance.lang = currentLocale();
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title={speaking
        ? t("session.transcript_stop_reading")
        : t("session.transcript_read_aloud")}
      aria-label={speaking
        ? t("session.transcript_stop_reading")
        : t("session.transcript_read_aloud")}
      aria-pressed={speaking}
      onClick={toggleSpeech}
    >
      {speaking ? <Square size={16} /> : <Volume2 size={16} />}
    </Button>
  );
}

export function TranscriptShareButton(props: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!props.text.trim()) return null;

  const share = async () => {
    if (navigator.share) {
      await navigator.share({ text: props.text }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(props.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title={t("session.transcript_share")}
      aria-label={t("session.transcript_share")}
      onClick={() => void share()}
    >
      {copied ? <Check size={16} /> : <Share2 size={16} />}
    </Button>
  );
}

const TRANSCRIPT_FEEDBACK_STORAGE_KEY = "onmyagent.transcriptFeedbackState.v1";

const TRANSCRIPT_DISLIKE_REASONS = [
  "misunderstanding",
  "context_error",
  "answer_obscure",
  "code_error",
  "unprofessional_answer",
  "code_format_error",
  "other",
] as const;

type TranscriptDislikeReason = (typeof TRANSCRIPT_DISLIKE_REASONS)[number];

function transcriptDislikeReasonLabel(reason: TranscriptDislikeReason): string {
  switch (reason) {
    case "misunderstanding":
      return t("session.transcript_dislike_misunderstanding");
    case "context_error":
      return t("session.transcript_dislike_context_error");
    case "answer_obscure":
      return t("session.transcript_dislike_answer_obscure");
    case "code_error":
      return t("session.transcript_dislike_code_error");
    case "unprofessional_answer":
      return t("session.transcript_dislike_unprofessional_answer");
    case "code_format_error":
      return t("session.transcript_dislike_code_format_error");
    case "other":
      return t("session.transcript_dislike_other");
  }
}

function isTranscriptFeedbackValue(value: unknown): value is TranscriptFeedbackValue {
  return value === "like" || value === "dislike";
}

function readTranscriptFeedbackState(): Record<string, TranscriptFeedbackValue> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TRANSCRIPT_FEEDBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, TranscriptFeedbackValue] =>
        isTranscriptFeedbackValue(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function persistTranscriptFeedbackState(state: Record<string, TranscriptFeedbackValue>) {
  try {
    window.localStorage.setItem(TRANSCRIPT_FEEDBACK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Feedback remains usable for this render when storage is unavailable.
  }
}

export function TranscriptFeedbackControls(props: { messageId: string }) {
  const [feedback, setFeedback] = useState(readTranscriptFeedbackState);
  const [dislikeOpen, setDislikeOpen] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<Set<string>>(() => new Set());
  const [otherReason, setOtherReason] = useState("");
  const current = feedback[props.messageId];

  const commit = (value: TranscriptFeedbackValue) => {
    setFeedback((state) => {
      const next = toggleTranscriptFeedback(state, props.messageId, value);
      persistTranscriptFeedbackState(next);
      return next;
    });
  };

  const toggleReason = (reason: string, checked: boolean) => {
    setSelectedReasons((currentReasons) => {
      const next = new Set(currentReasons);
      if (checked) next.add(reason);
      else next.delete(reason);
      return next;
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn(current === "like" && "bg-dls-accent/10 text-dls-accent")}
        aria-pressed={current === "like"}
        title={t("session.transcript_like")}
        aria-label={t("session.transcript_like")}
        onClick={() => commit("like")}
      >
        <ThumbsUp size={14} />
      </Button>
      <Popover open={dislikeOpen} onOpenChange={setDislikeOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(current === "dislike" && "bg-dls-accent/10 text-dls-accent")}
              aria-pressed={current === "dislike"}
              title={t("session.transcript_dislike")}
              aria-label={t("session.transcript_dislike")}
            >
              <ThumbsDown size={14} />
            </Button>
          }
        />
        <PopoverContent align="start" side="bottom" className="w-80 gap-3 p-3">
          <div className="text-sm font-medium text-dls-text">
            {t("session.transcript_dislike_title")}
          </div>
          <div className="grid gap-2">
            {TRANSCRIPT_DISLIKE_REASONS.map((reason) => (
              <label key={reason} className="flex cursor-pointer items-center gap-2 text-xs text-dls-text">
                <Checkbox
                  checked={selectedReasons.has(reason)}
                  onCheckedChange={(checked) => toggleReason(reason, checked === true)}
                />
                <span>{transcriptDislikeReasonLabel(reason)}</span>
              </label>
            ))}
          </div>
          {selectedReasons.has("other") ? (
            <div className="space-y-1">
              <Textarea
                value={otherReason}
                maxLength={200}
                rows={3}
                className="min-h-20 text-sm"
                placeholder={t("session.transcript_dislike_other_placeholder")}
                onChange={(event) => setOtherReason(event.currentTarget.value)}
              />
              <div className="text-right text-xs text-dls-secondary">
                {otherReason.length}/200
              </div>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="xs" onClick={() => setDislikeOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={selectedReasons.size === 0}
              onClick={() => {
                commit("dislike");
                setDislikeOpen(false);
              }}
            >
              {t("session.transcript_feedback_submit")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export function TranscriptMoreMenu(props: {
  requestId: string;
  actionMessageId: string | null;
  onForkAtMessage?: (messageId: string) => void;
}) {
  const platform = usePlatform();
  const onForkAtMessage = props.onForkAtMessage;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={t("session.transcript_more")}
            aria-label={t("session.transcript_more")}
          >
            <MoreHorizontal size={14} />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-52">
        {props.actionMessageId && onForkAtMessage ? (
          <DropdownMenuItem onClick={() => onForkAtMessage(props.actionMessageId ?? "")}>
            <GitFork />
            {t("session.fork_message")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => platform.openLink(buildFeedbackUrl({ entrypoint: "transcript-message" }))}
        >
          <MessageSquareWarning />
          {t("session.support_feedback")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(props.requestId)}>
          <Copy />
          {t("session.transcript_copy_request_id")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function transcriptTurnStatusLabel(state: TranscriptTurnPresentation["state"]) {
  switch (state) {
    case "pending":
      return null;
    case "streaming":
      return t("session.status_running");
    case "awaiting-approval":
      return t("session.status_awaiting_approval");
    case "completed":
      return t("session.status_completed");
    case "cancelled":
      return t("session.user_cancelled");
    case "failed":
      return t("session.status_failed");
  }
}

export function TranscriptTurnStatus(props: {
  presentation: TranscriptBlockTurnPresentation;
  detailsExpanded: boolean;
  onDetailsExpandedChange: (expanded: boolean) => void;
}) {
  if (
    props.presentation.state !== "completed" ||
    !props.presentation.hasExecutionDetails
  ) return null;
  const status = transcriptTurnStatusLabel(props.presentation.state);
  if (!status) return null;
  const duration = props.presentation.durationMs === null
    ? null
    : formatTranscriptDuration(props.presentation.durationMs);
  const content = (
    <>
      <span>
        {status}{duration ? ` ${duration}` : ""}
      </span>
      <ChevronDown
        size={12}
        className={cn(
          "transition-transform",
          !props.detailsExpanded && "-rotate-90",
        )}
      />
    </>
  );

  return (
    <button
      type="button"
      className="session-transcript-turn-status session-transcript-turn-status-button"
      aria-expanded={props.detailsExpanded}
      onClick={() => props.onDetailsExpandedChange(!props.detailsExpanded)}
    >
      {content}
    </button>
  );
}

export function TranscriptAssistantHeader(props: {
  assistantAvatar?: { name: string; avatarUrl: string | null; avatarBackground?: string | null };
  showAssistantAvatar: boolean;
  presentation?: TranscriptBlockTurnPresentation;
  detailsExpanded: boolean;
  onDetailsExpandedChange: (expanded: boolean) => void;
}) {
  const showStatus =
    props.presentation?.isFirstAssistantBlock === true &&
    props.presentation.state === "completed" &&
    props.presentation.hasExecutionDetails &&
    props.presentation.copyText.trim().length > 0;
  if (!props.showAssistantAvatar && !showStatus) return null;

  return (
    <div className="session-transcript-assistant-header">
      {props.showAssistantAvatar && props.assistantAvatar ? (
        <div className="session-transcript-assistant-identity">
          <AssistantAvatar
            name={props.assistantAvatar.name}
            avatarUrl={props.assistantAvatar.avatarUrl}
            avatarBackground={props.assistantAvatar.avatarBackground}
          />
          <span className={messageTextClass.avatarLabel}>
            {props.assistantAvatar.name}
          </span>
        </div>
      ) : null}
      {showStatus && props.presentation ? (
        <TranscriptTurnStatus
          presentation={props.presentation}
          detailsExpanded={props.detailsExpanded}
          onDetailsExpandedChange={props.onDetailsExpandedChange}
        />
      ) : null}
    </div>
  );
}

export function TranscriptCancelledIndicator(props: {
  presentation?: TranscriptBlockTurnPresentation;
}) {
  if (
    props.presentation?.state !== "cancelled" ||
    !props.presentation.isActionBlock
  ) {
    return null;
  }
  return (
    <div
      data-cancelled-indicator="true"
      className="max-w-[760px] text-sm leading-6 text-dls-secondary"
    >
      {t("session.user_cancelled")}
    </div>
  );
}

export function TranscriptTurnActions(props: {
  presentation: TranscriptBlockTurnPresentation;
  onForkAtMessage?: (messageId: string) => void;
}) {
  if (
    !props.presentation.isActionBlock ||
    props.presentation.state === "pending" ||
    props.presentation.state === "streaming" ||
    props.presentation.state === "awaiting-approval"
  ) {
    return null;
  }

  const actionMessageId = props.presentation.actionMessageId;
  const inputTokens = formatCompactTokenCount(props.presentation.inputTokens);
  const cacheTokens = formatCompactTokenCount(props.presentation.cacheTokens);
  const outputTokens = formatCompactTokenCount(props.presentation.outputTokens);
  const timestamp = formatTranscriptMessageTime(props.presentation.timestamp, {
    locale: currentLocale(),
    now: new Date(),
    yesterdayLabel: t("session.transcript_yesterday"),
  });
  const model = props.presentation.modelId;

  return (
    <div className="session-transcript-turn-actions">
      {props.presentation.copyText ? (
        <CopyButton getText={() => props.presentation.copyText} />
      ) : null}
      {actionMessageId ? <TranscriptFeedbackControls messageId={actionMessageId} /> : null}
      {props.presentation.copyText ? (
        <TranscriptSpeechButton text={props.presentation.copyText} />
      ) : null}
      {props.presentation.copyText ? (
        <TranscriptShareButton text={props.presentation.copyText} />
      ) : null}
      <TranscriptMoreMenu
        requestId={props.presentation.requestId}
        actionMessageId={actionMessageId}
        onForkAtMessage={props.onForkAtMessage}
      />
      {inputTokens && cacheTokens && outputTokens ? (
        <span
          aria-label={t("session.transcript_token_usage_label", {
            input: inputTokens,
            cache: cacheTokens,
            output: outputTokens,
          })}
        >
          {t("session.transcript_token_usage", {
            input: inputTokens,
            cache: cacheTokens,
            output: outputTokens,
          })}
        </span>
      ) : null}
      {model ? <span>{model}</span> : null}
      {timestamp ? <span>{timestamp}</span> : null}
    </div>
  );
}

export function TranscriptUserToolbar(props: {
  message: UIMessage;
  onRevertToMessage?: (messageId: string) => void;
}) {
  const metadata = readTranscriptMessageMetadata(props.message.metadata);
  const timestamp = formatTranscriptMessageTime(metadata.created, {
    locale: currentLocale(),
    now: new Date(),
    yesterdayLabel: t("session.transcript_yesterday"),
  });
  const onRevertToMessage = props.onRevertToMessage;

  return (
    <div className="session-transcript-user-toolbar">
      <CopyButton getText={() => messageToText(props.message)} />
      {onRevertToMessage ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t("session.transcript_revert_here")}
          aria-label={t("session.transcript_revert_here")}
          onClick={() => onRevertToMessage(props.message.id)}
        >
          <RotateCcw size={14} />
        </Button>
      ) : null}
      {timestamp ? <span>{timestamp}</span> : null}
    </div>
  );
}


export function HighlightedPlainText(props: {
  text: string;
  className: string;
  highlightQuery?: string;
  /** Map of paste label -> full text for expandable chips */
  pastedTextMap?: Map<string, string>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const displayText = resolveDisplayedPastedText(
    props.text,
    props.pastedTextMap,
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    queueMicrotask(() => {
      if (!rootRef.current || rootRef.current !== root) return;
      applyTextHighlights(root, props.highlightQuery ?? "");
    });
  }, [displayText, props.highlightQuery]);

  return (
    <div ref={rootRef} className={props.className}>
      {displayText}
    </div>
  );
}

function parseExpandedSkillReference(text: string): { name: string; arguments: string } | null {
  const frontmatter = text.match(/^---\s*\r?\n[\s\S]*?\bname:\s*["']?([A-Za-z0-9][\w.-]*)["']?\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/);
  const name = frontmatter?.[1];
  if (!name) return null;

  const lines = text.trimEnd().split(/\r?\n/);
  const trailing: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      if (trailing.length > 0) break;
      continue;
    }
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith(">") ||
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      trimmed.startsWith("```") ||
      trimmed.startsWith("|") ||
      /^\d+\.\s/.test(trimmed)
    ) {
      break;
    }
    trailing.unshift(line);
  }

  const args = trailing.join("\n").trim();
  if (!args || args === text.trim()) return null;
  return { name, arguments: args };
}

function parseSkillReference(text: string): { name: string; arguments: string } | null {
  const markerMatch = text.match(/^\[\[skill:([A-Za-z0-9][\w.-]*)\]\]\s*([\s\S]*)$/);
  if (markerMatch?.[1]) {
    return { name: markerMatch[1], arguments: markerMatch[2] ?? "" };
  }

  const slashMatch = text.match(/^\/([A-Za-z0-9][\w.-]*)\s+([\s\S]*)$/);
  if (slashMatch?.[1]) {
    return { name: slashMatch[1], arguments: slashMatch[2] ?? "" };
  }

  return parseExpandedSkillReference(text);
}

export function SkillReferenceText(props: { text: string; highlightQuery?: string }) {
  const skillReference = parseSkillReference(props.text);
  if (!skillReference) {
    return (
      <HighlightedPlainText
        text={props.text}
        className="whitespace-pre-wrap wrap-break-word text-dls-text"
        highlightQuery={props.highlightQuery}
      />
    );
  }

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-pre-wrap wrap-break-word text-dls-text">
      <span className={messageStateClass.skillReferenceChip}>
        <Terminal size={12} aria-hidden="true" />
        /{skillReference.name}
      </span>
      <HighlightedPlainText
        text={skillReference.arguments}
        className="min-w-0 wrap-break-word"
        highlightQuery={props.highlightQuery}
      />
    </div>
  );
}

export function FileCard(props: {
  part: { filename?: string; url: string; mediaType: string };
  tone: "assistant" | "user";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isDataUrl = props.part.url?.startsWith("data:");
  const title =
    props.part.filename ||
    (isDataUrl ? t("session.attached_file") : props.part.url) ||
    t("session.file");
  const ext = props.part.filename?.split(".").pop()?.toLowerCase();
  const badge = humanMediaType(props.part.mediaType) ?? (ext ? ext.toUpperCase() : null);
  const isImage = isImageAttachment(props.part.mediaType ?? "");
  const isDesktop = isDesktopRuntime();
  const hasPath = !isDataUrl && props.part.url && !props.part.url.startsWith("http");

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
        props.tone === "user"
          ? "border-dls-mist bg-dls-surface-muted hover:bg-dls-surface-muted"
          : "border-dls-mist bg-dls-surface hover:bg-dls-surface-muted",
      )}
    >
      {isImage && props.part.url ? (
        <div className="size-11 shrink-0 overflow-hidden rounded-xl border border-dls-mist bg-dls-surface">
          <img src={props.part.url} alt={title} loading="lazy" decoding="async" className="size-full object-cover" />
        </div>
      ) : (
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            props.tone === "user" ? "bg-dls-surface-muted text-dls-text" : "bg-dls-surface-muted text-dls-secondary",
          )}
        >
          <FileIcon size={20} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-snug text-dls-text">{title}</div>
        {badge ? (
          <StatusBadge className="mt-1" shape="soft" size="tiny">
            {badge}
          </StatusBadge>
        ) : null}
      </div>

      {isDesktop && hasPath ? (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="text-dls-secondary opacity-0 hover:bg-dls-surface-muted hover:text-dls-text group-hover:opacity-100"
            onClick={() => setMenuOpen((value) => !value)}
            title={t("message.file_actions")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </Button>
          {menuOpen ? (
            <>
              <button type="button" className="fixed inset-0 z-30 cursor-default border-0 bg-transparent p-0" aria-label={t("message.close_file_actions")} onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-xl border border-dls-border bg-dls-surface p-1.5">
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void openFileWithOS(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.open_with_default_app")}
                </MenuRowButton>
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void revealFileInFinder(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.reveal_in_finder")}
                </MenuRowButton>
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void navigator.clipboard.writeText(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.copy_path")}
                </MenuRowButton>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


export function OpenTargetIcon(props: { target: OpenTarget }) {
  if (props.target.kind === "url") {
    return <Globe size={12} className="shrink-0 text-dls-secondary" />;
  }

  if (props.target.preview === "sheet") {
    return (
      <StatusBadge size="fileType" className={messageStateClass.sheetBadge}>
        XLS
      </StatusBadge>
    );
  }
  if (props.target.preview === "markdown") {
    return (
      <StatusBadge size="fileType" className="border border-dls-border bg-dls-surface-muted text-dls-text">
        MD
      </StatusBadge>
    );
  }

  return <FileIcon size={12} className="shrink-0 text-dls-secondary" />;
}

export function OpenableTargetsStrip(props: { targets: OpenTarget[]; onOpenTarget: (target: OpenTarget) => void }) {
  if (!props.targets.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs leading-none">
      <span className="mr-0.5 text-dls-secondary">{t("session.openable_items")}</span>
      {props.targets.map((target) => (
          <Button
            key={target.id}
            type="button"
            variant="outline"
            size="xs"
            className="session-generated-artifact-card max-w-[220px] rounded-lg text-dls-text hover:text-dls-text"
            title={target.value}
            onClick={() => props.onOpenTarget(target)}
          >
            <OpenTargetIcon target={target} />
            <span className="truncate">{target.name || target.value}</span>
            <span className="text-dls-secondary">
              {target.kind === "url"
                ? t("session.open_browser")
                : t("session.open_artifact")}
            </span>
          </Button>
        ))}
    </div>
  );
}

export function TranscriptDividerRow(props: {
  label: string;
  variant?: SessionTranscriptDividerVariant;
}) {
  return (
    <div
      className={cn(
        "session-transcript-divider mx-auto flex items-center justify-center gap-3 px-3 py-3 text-xs text-dls-secondary sm:px-5",
        props.variant && `session-transcript-divider-${props.variant}`,
      )}
      data-divider-variant={props.variant}
    >
      <div className="session-transcript-divider-line min-w-10 flex-1" />
      <span className="session-transcript-divider-label shrink-0">{props.label}</span>
      <div className="session-transcript-divider-line min-w-10 flex-1" />
    </div>
  );
}

export function WorkBuddyTurnContent(props: {
  presentation: TurnContentPresentation;
  detailsExpanded: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  onOpenCodePath?: (path: string) => void;
  highlightQuery?: string;
  verifiedCodePaths?: readonly MarkdownVerifiedCodePath[];
}) {
  const running = props.presentation.state === "streaming" ||
    props.presentation.state === "awaiting-approval";
  const showExpandedProcess = running || props.detailsExpanded ||
    props.presentation.state === "cancelled" || props.presentation.state === "failed";
  const lastBodyId = props.presentation.segments.findLast(
    (segment) => segment.kind === "body",
  )?.id;

  const renderProcess = (id: string, items: TurnProcessItem[]) => (
    <WorkBuddyProcessFold
      key={id}
      id={id}
      items={items}
      running={running}
      expandedStepIds={props.expandedStepIds}
      onExpandedStepIdsChange={props.onExpandedStepIdsChange}
      onOpenCodePath={props.onOpenCodePath}
    />
  );

  const renderExpandedSegment = (segment: TurnContentSegment) => {
    if (segment.kind === "process") return renderProcess(segment.id, segment.items);
    if (segment.kind === "file" && segment.item.part.type === "file") {
      return (
        <FileCard
          key={segment.id}
          part={{
            filename: segment.item.part.filename,
            url: segment.item.part.url,
            mediaType: segment.item.part.mediaType,
          }}
          tone="assistant"
        />
      );
    }
    if (segment.kind !== "body") return null;
    return (
      <div key={segment.id} className="session-workbuddy-turn-body">
        <MarkdownBlock
          text={segment.text}
          streaming={running && segment.id === lastBodyId}
          showStreamingCursor={false}
          highlightQuery={props.highlightQuery}
          locale={currentLocale()}
          onOpenCodePath={props.onOpenCodePath}
          verifiedCodePaths={props.verifiedCodePaths}
        />
      </div>
    );
  };

  const renderCollapsedSegment = (segment: TurnFoldSegment) => {
    if (segment.kind === "hidden") return null;
    if (segment.kind === "process") return renderProcess(segment.id, segment.items);
    return (
      <div key={segment.id} className="session-workbuddy-turn-body">
        <MarkdownBlock
          text={segment.text}
          highlightQuery={props.highlightQuery}
          locale={currentLocale()}
          onOpenCodePath={props.onOpenCodePath}
          verifiedCodePaths={props.verifiedCodePaths}
        />
      </div>
    );
  };

  return (
    <div className="session-workbuddy-turn-content" data-workbuddy-turn-content="true">
      {showExpandedProcess
        ? props.presentation.segments.map(renderExpandedSegment)
        : props.presentation.collapsedSegments.map(renderCollapsedSegment)}
      {props.presentation.hoistedItems.map((visual) => (
        <InlineVisual
          key={`${visual.messageId}:${visual.partIndex}:${visual.toolName}`}
          visual={visual}
        />
      ))}
    </div>
  );
}

export function MessageBlockRow(props: {
  block: ConversationBlockItem;
  blockIndex: number;
  totalBlocks: number;
  isNestedVariant: boolean;
  shouldUseContentVisibility: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  searchMatchMessageIds?: ReadonlySet<string>;
  activeSearchMessageId?: string | null;
  searchHighlightQuery?: string;
  isStreaming: boolean;
  latestAssistantMessageId: string;
  onRevertToMessage?: (messageId: string) => void;
  onForkAtMessage?: (messageId: string) => void;
  turnOpenTargets?: OpenTarget[];
  verifiedCodePaths?: readonly MarkdownVerifiedCodePath[];
  onOpenCodePath?: (path: string) => void;
  onOpenTarget?: (target: OpenTarget) => void;
  assistantAvatar?: { name: string; avatarUrl: string | null; avatarBackground?: string | null };
  showAssistantIdentity: boolean;
  turnPresentation?: TranscriptBlockTurnPresentation;
  turnDetailsExpanded: boolean;
  onTurnDetailsExpandedChange: (turnId: string, expanded: boolean) => void;

}) {
  const block = props.block;
  const turnPresentation = props.turnPresentation;
  const onTurnDetailsExpandedChange = (expanded: boolean) => {
    if (turnPresentation) {
      props.onTurnDetailsExpandedChange(turnPresentation.turnId, expanded);
    }
  };
  const controlledTurnDetailsChange = turnPresentation
    ? onTurnDetailsExpandedChange
    : undefined;
  const blockMessageIds = block.kind === "steps-cluster"
    ? block.messageIds
    : [...(block.leadingStepMessageIds ?? []), block.messageId];
  const hasSearchMatch = blockMessageIds.some((id) => props.searchMatchMessageIds?.has(id));
  const hasActiveSearchMatch = blockMessageIds.some((id) => id === props.activeSearchMessageId);
  const searchOutlineClass = hasActiveSearchMatch
    ? messageStateClass.activeSearchOutline
    : hasSearchMatch
      ? messageStateClass.searchOutline
      : "";
  const perfStyle = props.shouldUseContentVisibility && props.blockIndex < props.totalBlocks - 12
    ? { contentVisibility: "auto", containIntrinsicSize: "180px" } satisfies CSSProperties
    : undefined;
  const blockStyle = messageBlockStyle(perfStyle);
  const assistantAvatar = props.assistantAvatar;
  const showAssistantAvatar =
    props.showAssistantIdentity && !block.isUser && assistantAvatar && !props.isNestedVariant;
  const turnOpenTargets =
    !block.isUser && turnPresentation?.isActionBlock && props.onOpenTarget
      ? props.turnOpenTargets ?? []
      : [];

  if (
    !block.isUser &&
    !props.isNestedVariant &&
    turnPresentation?.turnContent &&
    turnPresentation.isTurnContentAnchor
  ) {
    const turnContent = turnPresentation.turnContent;
    return (
      <div
        className="session-transcript-assistant-row session-transcript-assistant-turn group relative flex flex-col items-start"
        data-message-role="assistant"
        data-message-id={turnContent.anchorMessageId}
        data-workbuddy-turn-anchor="true"
        style={blockStyle}
      >
        <TranscriptAssistantHeader
          assistantAvatar={assistantAvatar}
          showAssistantAvatar={Boolean(showAssistantAvatar)}
          presentation={turnPresentation}
          detailsExpanded={props.turnDetailsExpanded}
          onDetailsExpandedChange={onTurnDetailsExpandedChange}
        />
        <div
          className={cn(
            messageTextClass.baseMessageBubble,
            messageTextClass.assistantMessageBubble,
            messageTextClass.rootAssistantMessageBubble,
            searchOutlineClass,
          )}
        >
          <WorkBuddyTurnContent
            presentation={turnContent}
            detailsExpanded={props.turnDetailsExpanded}
            expandedStepIds={props.expandedStepIds}
            onExpandedStepIdsChange={props.onExpandedStepIdsChange}
            onOpenCodePath={props.onOpenCodePath}
            highlightQuery={hasSearchMatch ? props.searchHighlightQuery : undefined}
            verifiedCodePaths={props.verifiedCodePaths}
          />
          {props.onOpenTarget ? (
            <OpenableTargetsStrip
              targets={turnOpenTargets}
              onOpenTarget={props.onOpenTarget}
            />
          ) : null}
        </div>
        <TranscriptCancelledIndicator presentation={turnPresentation} />
        <TranscriptTurnActions
          presentation={turnPresentation}
          onForkAtMessage={props.onForkAtMessage}
        />
      </div>
    );
  }

  if (block.kind === "steps-cluster") {
    return (
      <div
        className={cn(
          "flex group justify-start pb-4",
          block.isUser && "justify-end",
          !props.isNestedVariant && block.isUser && "session-transcript-user-row",
          !props.isNestedVariant && !block.isUser && "session-transcript-assistant-row",
          !props.isNestedVariant && !block.isUser && "flex-col items-start",
        )}
        data-message-role={block.isUser ? "user" : "assistant"}
        data-message-id={block.messageIds[0] ?? ""}
        style={blockStyle}
      >
        <TranscriptAssistantHeader
          assistantAvatar={assistantAvatar}
          showAssistantAvatar={Boolean(showAssistantAvatar)}
          presentation={turnPresentation}
          detailsExpanded={props.turnDetailsExpanded}
          onDetailsExpandedChange={onTurnDetailsExpandedChange}
        />
        <div
          className={cn(
            block.isUser
              ? cn(
                "relative",
                messageTextClass.baseMessageBubble,
                messageTextClass.userMessageBubble,
                props.isNestedVariant
                  ? messageTextClass.nestedUserMessageBubble
                  : messageTextClass.rootUserMessageBubble,
              )
              : props.isNestedVariant
                ? messageTextClass.nestedAssistantBubble
                : messageTextClass.assistantBubble,
            searchOutlineClass,
          )}
        >
          <StepsContainer
            stepGroups={block.stepGroups}
            isUser={block.isUser}
            isNestedVariant={props.isNestedVariant}
            isActive={props.isStreaming && block.messageIds.includes(props.latestAssistantMessageId)}
            isTrailingMessageContent={true}
            expandedStepIds={props.expandedStepIds}
            onExpandedStepIdsChange={props.onExpandedStepIdsChange}
            turnDetailsExpanded={props.turnDetailsExpanded}
            onTurnDetailsExpandedChange={controlledTurnDetailsChange}
            onOpenCodePath={props.onOpenCodePath}
          />
        </div>
        <TranscriptCancelledIndicator presentation={turnPresentation} />
        {turnPresentation ? (
          <TranscriptTurnActions
            presentation={turnPresentation}
            onForkAtMessage={props.onForkAtMessage}
          />
        ) : null}
      </div>
    );
  }

  const groupSpacing = block.isUser ? "mb-3" : "mb-4";
  const isSyntheticSessionError =
    !block.isUser && block.messageId.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX);
  const isOutputLimitContinuation =
    block.isUser &&
    !props.isNestedVariant &&
    isOutputLimitContinuationMessageId(block.messageId);

  if (isOutputLimitContinuation) {
    const continuationText = block.renderableParts
      .map((part) => partToText(part))
      .join(" ")
      .trim();
    return (
      <div
        className="pb-4"
        data-message-role="user"
        data-message-id={block.messageId}
        data-output-limit-continuation="true"
        style={blockStyle}
      >
        <div className="flex items-center gap-3 text-xs text-dls-secondary">
          <span className="h-px flex-1 bg-dls-border" aria-hidden="true" />
          <span>{continuationText}</span>
          <span className="h-px flex-1 bg-dls-border" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (isSyntheticSessionError) {
    const messageText = block.renderableParts
      .map((part) => partToText(part))
      .join(" ")
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    return (
      <div
        className={cn(
          "flex group justify-start pb-4",
          !props.isNestedVariant && "session-transcript-assistant-row",
          !props.isNestedVariant && "flex-col items-start",
        )}
        data-message-role="assistant"
        data-message-id={block.messageId}
        style={blockStyle}
      >
        <TranscriptAssistantHeader
          assistantAvatar={assistantAvatar}
          showAssistantAvatar={Boolean(showAssistantAvatar)}
          presentation={turnPresentation}
          detailsExpanded={props.turnDetailsExpanded}
          onDetailsExpandedChange={onTurnDetailsExpandedChange}
        />
        <div className={cn("w-full relative", !props.isNestedVariant && "max-w-[650px]", searchOutlineClass)}>
          <NoticeBox className="inline-flex max-w-full items-start gap-2 text-sm leading-5" role="alert" tone="error">
            <CircleAlert size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0 wrap-break-word">{messageText}</div>
          </NoticeBox>
        </div>
        <TranscriptCancelledIndicator presentation={turnPresentation} />
        {turnPresentation ? (
          <TranscriptTurnActions
            presentation={turnPresentation}
            onForkAtMessage={props.onForkAtMessage}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex group justify-start relative pb-4",
        block.isUser && "justify-end",
        !props.isNestedVariant && !block.isUser && "session-transcript-assistant-message-row",
        !props.isNestedVariant && block.isUser && "session-transcript-user-row",
        !props.isNestedVariant && !block.isUser && "session-transcript-assistant-row",
        !props.isNestedVariant && !block.isUser && "flex-col items-start",
      )}
      data-message-role={block.isUser ? "user" : "assistant"}
      data-message-id={block.messageId}
      style={blockStyle}
    >
      <TranscriptAssistantHeader
        assistantAvatar={assistantAvatar}
        showAssistantAvatar={Boolean(showAssistantAvatar)}
        presentation={turnPresentation}
        detailsExpanded={props.turnDetailsExpanded}
        onDetailsExpandedChange={onTurnDetailsExpandedChange}
      />
      <div
        className={cn(
          messageTextClass.baseMessageBubble,
          block.isUser && messageTextClass.userMessageBubble,
          block.isUser && props.isNestedVariant && messageTextClass.nestedUserMessageBubble,
          block.isUser && !props.isNestedVariant && messageTextClass.rootUserMessageBubble,
          !block.isUser && messageTextClass.assistantMessageBubble,
          !block.isUser && !props.isNestedVariant && messageTextClass.rootAssistantMessageBubble,
          searchOutlineClass,
        )}
      >
        {block.leadingStepGroups?.length ? (
          <div className="mb-4">
            <StepsContainer
              stepGroups={block.leadingStepGroups}
              isUser={block.isUser}
              isNestedVariant={props.isNestedVariant}
              isActive={props.isStreaming && (block.leadingStepMessageIds ?? []).includes(props.latestAssistantMessageId)}
              isTrailingMessageContent={false}
              expandedStepIds={props.expandedStepIds}
              onExpandedStepIdsChange={props.onExpandedStepIdsChange}
              turnDetailsExpanded={props.turnDetailsExpanded}
              onTurnDetailsExpandedChange={controlledTurnDetailsChange}
              onOpenCodePath={props.onOpenCodePath}
            />
          </div>
        ) : null}

        {block.attachments.length > 0 ? (
          <div className={cn("flex flex-wrap gap-2", block.isUser ? "mb-3" : "mb-4")}>
            {block.attachments.map((attachment) => block.isUser ? (
              <TranscriptResourceChip
                key={`${block.messageId}:${attachment.url}`}
                filename={attachment.filename}
                url={attachment.url}
                mediaType={attachment.mime}
              />
            ) : (
              <FileCard
                key={`${block.messageId}:${attachment.url}`}
                part={{
                  filename: attachment.filename,
                  url: attachment.url,
                  mediaType: attachment.mime,
                }}
                tone="assistant"
              />
            ))}
          </div>
        ) : null}

        {block.groups.map((group, groupIndex) => {
          const highlightQuery = hasSearchMatch ? props.searchHighlightQuery : undefined;
          const isStreamingLatestAssistant =
            !block.isUser && props.isStreaming && block.messageId === props.latestAssistantMessageId;

          return (
            <div key={messageGroupKey(block.messageId, group)} className={cn(group !== block.groups.at(-1) && groupSpacing)}>
              {group.kind === "text" ? (() => {
                if (group.part.type === "file") {
                  const filePart = group.part as {
                    filename?: string;
                    url?: string;
                    mime?: string;
                  };
                  return block.isUser ? (
                    <TranscriptResourceChip
                      filename={filePart.filename}
                      url={filePart.url ?? ""}
                      mediaType={filePart.mime ?? "application/octet-stream"}
                    />
                  ) : (
                    <FileCard
                      part={{
                        filename: filePart.filename,
                        url: filePart.url ?? "",
                        mediaType: filePart.mime ?? "application/octet-stream",
                      }}
                      tone="assistant"
                    />
                  );
                }

                const text = partToText(group.part);
                if (block.isUser) {
                  return (
                    <SkillReferenceText
                      text={text}
                      highlightQuery={highlightQuery}
                    />
                  );
                }

                return (
                  <MarkdownBlock
                    text={text}
                    streaming={isStreamingLatestAssistant}
                    showStreamingCursor={false}
                    highlightQuery={highlightQuery}
                    locale={currentLocale()}
                    onOpenCodePath={props.onOpenCodePath}
                    verifiedCodePaths={props.verifiedCodePaths}
                  />
                );
              })() : null}

              {group.kind === "steps" ? (
                <StepsContainer
                  stepGroups={[{
                    id: group.id,
                    parts: group.parts,
                    mode: group.mode,
                  }]}
                  isUser={block.isUser}
                  isInline={true}
                  isNestedVariant={props.isNestedVariant}
                  isActive={isStreamingLatestAssistant}
                  isTrailingMessageContent={groupIndex === block.groups.length - 1}
                  expandedStepIds={props.expandedStepIds}
                  onExpandedStepIdsChange={props.onExpandedStepIdsChange}
                  turnDetailsExpanded={props.turnDetailsExpanded}
                  onTurnDetailsExpandedChange={controlledTurnDetailsChange}
                  onOpenCodePath={props.onOpenCodePath}
                />
              ) : null}
            </div>
          );
        })}

        {props.onOpenTarget ? (
          <OpenableTargetsStrip
            targets={turnOpenTargets}
            onOpenTarget={props.onOpenTarget}
          />
        ) : null}
      </div>
      {!props.isNestedVariant && block.isUser ? (
        <TranscriptUserToolbar
          message={block.message}
          onRevertToMessage={props.onRevertToMessage}
        />
      ) : null}
      <TranscriptCancelledIndicator presentation={turnPresentation} />
      {turnPresentation ? (
        <TranscriptTurnActions
          presentation={turnPresentation}
          onForkAtMessage={props.onForkAtMessage}
        />
      ) : null}
    </div>
  );
}

