/** @jsxImportSource react */
/** Transcript action chrome: avatar, copy/share/feedback/more menus, turn actions. */
import { useState } from "react";
import type { UIMessage } from "ai";
import {
  Check,
  ChevronDown,
  Copy,
  GitFork,
  MessageSquareWarning,
  MoreHorizontal,
  RotateCcw,
  Share2,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { buildFeedbackUrl } from "../../../../../app/lib/feedback";
import { usePlatform } from "../../../../kernel/platform";
import { readTranscriptMessageMetadata } from "../../sync/message-metadata";
import {
  formatTranscriptDuration,
  formatTranscriptMessageTime,
} from "../transcript-presentation";
import {
  formatCompactTokenCount,
} from "../transcript/turn-presentation";
import type { TranscriptTurnPresentation } from "../transcript/turn-presentation";
import type {
  TranscriptBlockTurnPresentation,
  TranscriptFeedbackValue,
} from "./types";
import {
  AVATAR_PALETTES,
  messageTextClass,
} from "./styles";
import {
  messageToText,
  toggleTranscriptFeedback,
} from "./shared";

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

