/** @jsxImportSource react */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";
import { isToolUIPart, type DynamicToolUIPart, type UIMessage } from "ai";
import type { Part } from "@opencode-ai/sdk/v2/client";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  File as FileIcon,
  Folder,
  GitFork,
  Globe,
  HelpCircle,
  MessageSquareWarning,
  MoreHorizontal,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Square,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";

import {
  openDesktopPath,
  revealDesktopItemInDir,
} from "../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DisclosureRowButton, MenuRowButton } from "@/components/ui/action-row";
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
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { MessageRolePrefix, MessageRoleRow } from "@/components/ui/message-role";
import {
  ToolApprovalCard,
  ToolApprovalCardBody,
  ToolApprovalCardFooter,
  ToolApprovalCardHeader,
} from "@/components/ui/tool-approval-card";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { buildFeedbackUrl } from "../../../../app/lib/feedback";
import {
  SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX,
  type MessageGroup,
  type StepGroupMode,
} from "../../../../app/types";
import { groupMessageParts, isDesktopRuntime, summarizeStep } from "../../../../app/utils";
import { DEFAULT_SHOW_THINKING } from "../../../kernel/local-provider";
import { usePlatform } from "../../../kernel/platform";
import { readTranscriptMessageMetadata } from "../sync/message-metadata";
import { isOutputLimitContinuationMessageId } from "../sync/output-limit-recovery";
import { MarkdownBlock, type MarkdownVerifiedCodePath } from "./markdown";
import {
  ImageGenerationToolCard,
  SpecializedToolDetails,
  specializedToolCanExpand,
  specializedToolHeadline,
} from "./specialized-tool-details";
import { TranscriptResourceChip } from "./transcript-resource-chip";
import { applyTextHighlights } from "./text-highlights";
import {
  computeTranscriptMaxContentWidth,
  DEFAULT_TRANSCRIPT_MAX_CONTENT_WIDTH,
  formatTranscriptDuration,
  formatTranscriptMessageTime,
} from "./transcript-presentation";
import { buildTranscriptTurns } from "./transcript/turn-model";
import { normalizeTranscriptQuestionAnswers } from "./transcript/question-answer";
import {
  buildTranscriptToolPresentation,
  type TranscriptTodoItem,
} from "./transcript/tool-presentation";
import {
  groupTranscriptRenderItems,
  type TranscriptRenderItem,
} from "./transcript/render-items";
import {
  formatCompactTokenCount,
  summarizeTranscriptTurn,
  type TranscriptTurnPresentation,
} from "./transcript/turn-presentation";
import {
  buildTurnContentPresentation,
  type TurnContentSegment,
  type TurnContentPresentation,
  type TurnFoldSegment,
  type TurnProcessItem,
} from "./transcript/turn-content";
import { InlineVisual } from "./transcript/inline-visual";
import {
  deriveOpenTargets,
  isCollectibleArtifactTarget,
  isLocalhostBrowserTarget,
  type OpenTarget,
} from "../artifacts/open-target";

type TranscriptPart = Part;

/**
 * Simple avatar badge rendered at the leading edge of every assistant
 * message when the session was started from a custom agent card. Uses the
 * pre-resolved image URL (local DiceBear data URI or custom upload) directly; falls back
 * to a colored initial badge only if `avatarUrl` is null.
 */
const AVATAR_PALETTES = [
  { background: "#d7ecf8", foreground: "#16324f" },
  { background: "#e1e2f0", foreground: "#42475f" },
  { background: "#ffe1c7", foreground: "#6d3b1f" },
  { background: "#cceaf5", foreground: "#174767" },
  { background: "#ddefc8", foreground: "#355a18" },
] as const;

const messageTextClass = {
  body: "font-sans text-sm leading-6 antialiased",
  bodyMuted: "font-sans text-sm leading-6 text-dls-secondary antialiased",
  toolStatus: "ml-7 mt-2 text-sm leading-6 text-dls-secondary",
  toolLabel: "mb-1 text-xs font-medium text-dls-secondary",
  assistantBubble: "w-full relative text-dls-text group",
  nestedAssistantBubble: "w-full relative text-sm leading-6 text-dls-text group",
  avatarLabel: "text-sm font-medium leading-tight text-dls-text",
  baseMessageBubble: "text-sm text-dls-text leading-relaxed",
  userMessageBubble: "bg-dls-chat-user-bg text-dls-text",
  nestedUserMessageBubble: "max-w-[92%] rounded-xl px-3.5 py-2",
  rootUserMessageBubble: "session-transcript-user-bubble",
  assistantMessageBubble: "w-full antialiased group",
  rootAssistantMessageBubble: "session-transcript-assistant-copy",
};

const messageStateClass = {
  skillReferenceChip: "inline-flex items-center gap-1 rounded-md border border-dls-accent/30 bg-dls-accent/10 px-2 py-0.5 font-mono text-xs font-medium text-dls-accent",
  toolError: "overflow-x-auto rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft px-4 py-3 text-xs leading-6 text-dls-status-danger",
  sheetBadge: "min-w-5 border border-dls-status-success-border bg-dls-status-success-soft text-dls-status-success-fg",
  activeSearchOutline: "outline outline-2 outline-amber-8/70 outline-offset-2 rounded-xl",
  searchOutline: "outline outline-1 outline-amber-7/50 outline-offset-1 rounded-xl",
};

const MESSAGE_BLOCK_CONTAIN_STYLE = { contain: "layout style paint" } satisfies CSSProperties;
const MESSAGE_LIST_CONTAIN_STYLE = { contain: "layout paint style" } satisfies CSSProperties;

function messageBlockStyle(perfStyle: CSSProperties | undefined): CSSProperties {
  return perfStyle ? { ...MESSAGE_BLOCK_CONTAIN_STYLE, ...perfStyle } : MESSAGE_BLOCK_CONTAIN_STYLE;
}

function AssistantAvatar(props: { name: string; avatarUrl: string | null; avatarBackground?: string | null }) {
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

type TranscriptMessage = {
  id: string;
  role: UIMessage["role"];
  source: UIMessage;
  parts: TranscriptPart[];
};

type StepTimelineGroup = {
  id: string;
  parts: TranscriptPart[];
  mode: StepGroupMode;
};

type StepClusterBlock = {
  kind: "steps-cluster";
  id: string;
  stepGroups: StepTimelineGroup[];
  messageIds: string[];
  isUser: boolean;
};

type DividerBlock = {
  kind: "divider";
  id: string;
  label: string;
  variant?: SessionTranscriptDividerVariant;
  afterMessageCount: number;
  isUser: false;
};

type MessageBlock = {
  kind: "message";
  message: UIMessage;
  renderableParts: TranscriptPart[];
  leadingStepGroups?: StepTimelineGroup[];
  leadingStepMessageIds?: string[];
  attachments: Array<{
    url: string;
    filename: string;
    mime: string;
  }>;
  groups: MessageGroup[];
  isUser: boolean;
  messageId: string;
};

type MessageBlockItem = MessageBlock | StepClusterBlock | DividerBlock;
type ConversationBlockItem = MessageBlock | StepClusterBlock;
type TranscriptBlockTurnPresentation = TranscriptTurnPresentation & {
  isFirstAssistantBlock: boolean;
  isActionBlock: boolean;
  hasExecutionDetails: boolean;
  turnContent: TurnContentPresentation | null;
  isTurnContentAnchor: boolean;
  isHiddenByTurnContent: boolean;
};

export type SessionTranscriptDivider = {
  id: string;
  label: string;
  variant?: SessionTranscriptDividerVariant;
  afterMessageCount: number;
};

export type SessionTranscriptDividerVariant =
  | "cancelled"
  | "stopped"
  | "compacting"
  | "compacted"
  | "stalled"
  | "permission-rejected"
  | "permission-auto-approved";

export function isTranscriptDividerReady(
  divider: SessionTranscriptDivider | undefined,
  messageCount: number,
): boolean {
  return Boolean(divider && divider.afterMessageCount <= messageCount);
}

function cancelledAssistantMessageIds(
  messages: UIMessage[],
  dividers: SessionTranscriptDivider[] | undefined,
) {
  const ids = new Set<string>();
  for (const divider of dividers ?? []) {
    if (divider.variant !== "cancelled") continue;
    const precedingMessages = messages.slice(
      0,
      Math.min(messages.length, divider.afterMessageCount),
    );
    const assistantMessage = precedingMessages.findLast(
      (message) => message.role === "assistant",
    );
    if (assistantMessage) ids.add(assistantMessage.id);
  }
  return ids;
}

export function isInternalAssistantNarration(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  return /^(?:the user(?: wants|['’]s| is| said| has| just| seems)|let me|i(?:'ll| will| need to| should| can) |first,? i(?:'ll| will| need to)|now,? i(?:'ll| will| need to)|next,? i(?:'ll| will| need to))/i.test(
    normalized,
  );
}

/**
 * Stable-key used to match a block across renders. For message blocks the
 * messageId is stable. For step clusters we reuse the cluster id (which is
 * derived from its first step group) as the identity anchor.
 */
function blockIdentityKey(block: MessageBlockItem): string {
  if (block.kind === "divider") return `divider:${block.id}`;
  if (block.kind === "steps-cluster") return `cluster:${block.id}`;
  return `msg:${block.messageId}`;
}

function messageIdsForBlock(block: MessageBlockItem) {
  if (block.kind === "divider") return [];
  if (block.kind === "steps-cluster") return block.messageIds;
  return [...(block.leadingStepMessageIds ?? []), block.messageId];
}

/**
 * Returns true when a newly-computed block is content-equivalent to the
 * previous block we rendered under the same identity key. We compare the
 * underlying UIMessage reference (`message.source`) for message blocks and
 * the messageIds array + stepGroups identity for step clusters. If equal,
 * the caller reuses the previous block reference so React.memo'd children
 * downstream can skip work.
 *
 * This is the structural-sharing trick from T3Tools' MessagesTimeline: on
 * every streaming token, `props.messages` is a fresh array, but only the
 * *currently-streaming* message has a new `source` reference — everything
 * else is still pointer-equal to last tick. Rebuilding blocks from the new
 * array gives fresh block objects for every message, so downstream memo
 * checks all fail by default. Reusing the previous block reference when
 * its content hasn't actually changed gives every non-streaming row a free
 * bailout during a streaming burst.
 */
function blocksAreEquivalent(
  previous: MessageBlockItem | undefined,
  next: MessageBlockItem,
): boolean {
  if (!previous) return false;
  if (previous.kind !== next.kind) return false;
  if (previous.isUser !== next.isUser) return false;

  if (previous.kind === "divider" && next.kind === "divider") {
    return (
      previous.id === next.id &&
      previous.label === next.label &&
      previous.variant === next.variant &&
      previous.afterMessageCount === next.afterMessageCount
    );
  }

  if (previous.kind === "steps-cluster" && next.kind === "steps-cluster") {
    if (previous.id !== next.id) return false;
    if (previous.messageIds.length !== next.messageIds.length) return false;
    for (let i = 0; i < previous.messageIds.length; i += 1) {
      if (previous.messageIds[i] !== next.messageIds[i]) return false;
    }
    if (previous.stepGroups.length !== next.stepGroups.length) return false;
    for (let i = 0; i < previous.stepGroups.length; i += 1) {
      const prevGroup = previous.stepGroups[i];
      const nextGroup = next.stepGroups[i];
      if (!prevGroup || !nextGroup) return false;
      if (prevGroup.id !== nextGroup.id) return false;
      if (prevGroup.mode !== nextGroup.mode) return false;
      if (prevGroup.parts.length !== nextGroup.parts.length) return false;
      for (let p = 0; p < prevGroup.parts.length; p += 1) {
        if (prevGroup.parts[p] !== nextGroup.parts[p]) return false;
      }
    }
    return true;
  }

  if (previous.kind === "message" && next.kind === "message") {
    if (previous.messageId !== next.messageId) return false;
    const previousLeadingStepGroups = previous.leadingStepGroups ?? [];
    const nextLeadingStepGroups = next.leadingStepGroups ?? [];
    if (previousLeadingStepGroups.length !== nextLeadingStepGroups.length) return false;
    for (let i = 0; i < previousLeadingStepGroups.length; i += 1) {
      const prevGroup = previousLeadingStepGroups[i];
      const nextGroup = nextLeadingStepGroups[i];
      if (!prevGroup || !nextGroup) return false;
      if (prevGroup.id !== nextGroup.id) return false;
      if (prevGroup.mode !== nextGroup.mode) return false;
      if (prevGroup.parts.length !== nextGroup.parts.length) return false;
      for (let p = 0; p < prevGroup.parts.length; p += 1) {
        if (prevGroup.parts[p] !== nextGroup.parts[p]) return false;
      }
    }
    const previousLeadingMessageIds = previous.leadingStepMessageIds ?? [];
    const nextLeadingMessageIds = next.leadingStepMessageIds ?? [];
    if (previousLeadingMessageIds.length !== nextLeadingMessageIds.length) return false;
    for (let i = 0; i < previousLeadingMessageIds.length; i += 1) {
      if (previousLeadingMessageIds[i] !== nextLeadingMessageIds[i]) return false;
    }
    // The single most important check. The session sync layer keeps
    // UIMessage references stable for every non-streaming message across
    // rerenders; only the actively-streaming message gets a fresh
    // `source` reference per token. If the source is pointer-equal, the
    // block hasn't changed and we can reuse the previous object.
    if (previous.message !== next.message) return false;
    if (previous.attachments.length !== next.attachments.length) return false;
    if (previous.renderableParts.length !== next.renderableParts.length) return false;
    if (previous.groups.length !== next.groups.length) return false;
    return true;
  }

  return false;
}

type SessionTranscriptProps = {
  messages: UIMessage[];
  isStreaming: boolean;
  developerMode: boolean;
  showThinking?: boolean;
  expandedStepIds?: Set<string>;
  onExpandedStepIdsChange?: (updater: (current: Set<string>) => Set<string>) => void;
  searchMatchMessageIds?: ReadonlySet<string>;
  activeSearchMessageId?: string | null;
  searchHighlightQuery?: string;
  scrollElement?: () => HTMLElement | null | undefined;
  setScrollToMessageById?: (
    handler: ((messageId: string, behavior?: ScrollBehavior) => boolean) | null,
  ) => void;
  footer?: ReactNode;
  dividers?: SessionTranscriptDivider[];
  variant?: "default" | "nested";
  /** Revert to this message (undo everything after it). */
  onRevertToMessage?: (messageId: string) => void;
  /** Fork the conversation at this message into a new session. */
  onForkAtMessage?: (messageId: string) => void;
  openTargets?: OpenTarget[];
  onOpenTarget?: (target: OpenTarget) => void;
  /**
   * When set, renders this identity once at the start of each visible
   * assistant turn. The root transcript always supplies the active identity.
   */
  assistantAvatar?: { name: string; avatarUrl: string | null; avatarBackground?: string | null };
};

// 500 was too high for real-world OnMyAgent sessions: a handful of giant
// messages (emails, legal docs, pasted transcripts) can still produce a
// massive DOM even when the block count is low. Lowering the threshold means
// we switch to react-virtual much earlier and keep the main thread lighter
// during workspace/session switches.
// Virtualize aggressively. A session with 20+ message blocks already pays
// more to render eagerly than to run the virtualizer, so there's no reason
// to defer. The only reason the threshold exists at all is to avoid the
// virtualizer's baseline overhead for tiny sessions.
const VIRTUALIZATION_THRESHOLD = 20;
const VIRTUAL_OVERSCAN = 4;

function clampVirtualEstimate(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function estimateTextBlockSize(text: string, isUser: boolean) {
  const explicitLines = text.split("\n").length;
  const wrappedLines = Math.ceil(text.length / (isUser ? 68 : 86));
  const markdownStructureLines = text
    .split("\n")
    .filter((line) => /^\s*([-*+]\s+|\d+\.\s+|>\s+|#{1,6}\s+|\|)/.test(line)).length;
  const fencedCodeBlocks = Math.floor((text.match(/```/g) ?? []).length / 2);
  const estimatedLines = Math.max(explicitLines, wrappedLines) + markdownStructureLines * 0.5;
  const base = isUser ? 76 : 160;
  return base + estimatedLines * 22 + fencedCodeBlocks * 72;
}

function estimateBlockSize(block: MessageBlockItem | undefined) {
  if (!block) return 360;

  if (block.kind === "divider") {
    return 56;
  }

  if (block.kind === "steps-cluster") {
    const partCount = block.stepGroups.reduce((total, group) => total + group.parts.length, 0);
    return clampVirtualEstimate(64 + partCount * 58, 96, 900);
  }

  const leadingStepSize = (block.leadingStepGroups ?? []).reduce(
    (total, group) => total + 72 + group.parts.length * 58,
    0,
  );
  const textSize = block.groups.reduce((total, group) => {
    if (group.kind === "steps") {
      return total + 72 + group.parts.length * 58;
    }
    return total + estimateTextBlockSize(partToText(group.part), block.isUser);
  }, 0);
  const attachmentSize = block.attachments.length > 0 ? 76 : 0;
  const openTargetsSize = !block.isUser ? 44 : 0;
  const actionsSize = block.isUser ? 24 : 36;

  return clampVirtualEstimate(
    leadingStepSize + textSize + attachmentSize + openTargetsSize + actionsSize,
    block.isUser ? 112 : 260,
    block.isUser ? 720 : 1800,
  );
}

function estimateRenderItemSize(item: TranscriptRenderItem<MessageBlockItem> | undefined) {
  if (!item) return 360;
  if (item.kind === "divider") return estimateBlockSize(item.block);
  return item.blocks.reduce((total, block) => total + estimateBlockSize(block), 0);
}

function partIdFromUiPart(part: UIMessage["parts"][number], fallbackId: string) {
  const metadata = (part as { providerMetadata?: { opencode?: { partId?: unknown } } })
    .providerMetadata?.opencode;
  if (typeof metadata?.partId === "string" && metadata.partId.trim()) {
    return metadata.partId;
  }
  return fallbackId;
}

function toDynamicToolPart(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") {
    return part;
  }
  if (!isToolUIPart(part)) return null;
  return {
    ...part,
    toolName: part.type.replace(/^tool-/, ""),
    type: "dynamic-tool",
  } as DynamicToolUIPart;
}

function toLegacyPart(
  part: UIMessage["parts"][number],
  fallbackId: string,
): TranscriptPart | null {
  const id = partIdFromUiPart(part, fallbackId);

  if (part.type === "text") {
    return { id, type: "text", text: part.text } as TranscriptPart;
  }

  if (part.type === "reasoning") {
    return { id, type: "reasoning", text: part.text } as TranscriptPart;
  }

  if (part.type === "file") {
    return {
      id,
      type: "file",
      url: part.url,
      filename: part.filename,
      mime: part.mediaType,
    } as TranscriptPart;
  }

  if (part.type === "step-start") {
    return { id, type: "step-start" } as TranscriptPart;
  }

  const toolPart = toDynamicToolPart(part);
  if (toolPart) {
    const opencodeMetadata = isRecordValue(toolPart.callProviderMetadata?.opencode)
      ? toolPart.callProviderMetadata.opencode
      : null;
    const toolMetadata = isRecordValue(opencodeMetadata?.toolMetadata)
      ? opencodeMetadata.toolMetadata
      : null;
    const state: Record<string, unknown> = {
      input: toolPart.input,
      ...(toolMetadata ? { metadata: toolMetadata } : {}),
    };

    if (toolPart.state === "output-available") {
      state.output = toolPart.output;
    }

    if (toolPart.state === "output-error") {
      state.error = toolPart.errorText;
    }

    return {
      id: toolPart.toolCallId || id,
      type: "tool",
      tool: toolPart.toolName,
      state,
    } as TranscriptPart;
  }

  return null;
}

function isAttachmentPart(part: TranscriptPart) {
  if (part.type !== "file") return false;
  const url = (part as { url?: string }).url;
  return typeof url === "string" && !url.startsWith("file://");
}

function attachmentsForParts(parts: TranscriptPart[]) {
  return parts.flatMap((part) => {
      if (!isAttachmentPart(part)) return [];
      const record = part as {
        url?: string;
        filename?: string;
        mime?: string;
      };
      const attachment = {
        url: record.url ?? "",
        filename: record.filename ?? "attachment",
        mime: record.mime ?? "application/octet-stream",
      };
      return attachment.url ? [attachment] : [];
    });
}

function partToText(part: TranscriptPart) {
  if (part.type === "text") {
    return String((part as { text?: string }).text ?? "");
  }
  if (part.type === "reasoning") {
    return String((part as { text?: string }).text ?? "");
  }
  if (part.type === "agent") {
    const name = (part as { name?: string }).name ?? "";
    return name ? `@${name}` : "@agent";
  }
  if (part.type === "file") {
    const record = part as {
      label?: string;
      path?: string;
      filename?: string;
      url?: string;
    };
    const label = record.label ?? record.path ?? record.filename ?? record.url ?? "";
    return label ? `@${label}` : "@file";
  }
  if (part.type === "tool") {
    return summarizeStep(part).title;
  }
  return "";
}

function messageToText(message: UIMessage) {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "reasoning") return [part.text];
      if (part.type === "file") return [part.filename ?? part.url];
      const toolPart = toDynamicToolPart(part);
      if (toolPart) {
        if (toolPart.state === "output-error") {
          return [`[tool:${toolPart.toolName}] ${toolPart.errorText}`];
        }
        if (toolPart.state === "output-available") {
          return [`[tool:${toolPart.toolName}] ${JSON.stringify(toolPart.output)}`];
        }
        return [`[tool:${toolPart.toolName}] ${JSON.stringify(toolPart.input)}`];
      }
      return [];
    })
    .join("\n\n")
    .trim();
}

function isImageAttachment(mime: string) {
  return mime.startsWith("image/");
}

function humanMediaType(raw: string) {
  if (!raw || raw === "application/octet-stream") return null;
  const short = raw.replace(/^application\//, "").replace(/^text\//, "");
  return short.toUpperCase();
}

function formatStructuredValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStructuredValue(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecordValue(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function ToolActivityIcon(props: { category?: string }) {
  const className = "size-4 shrink-0 text-dls-secondary";
  switch (props.category) {
    case "terminal":
      return <Terminal className={className} strokeWidth={1.9} />;
    case "read":
    case "edit":
    case "write":
      return <FileIcon className={className} strokeWidth={1.9} />;
    case "glob":
      return <Folder className={className} strokeWidth={1.9} />;
    case "search":
      return <Search className={className} strokeWidth={1.9} />;
    default:
      return <Box className={className} strokeWidth={1.9} />;
  }
}

function toolStatusText(status?: string) {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized.includes("approval") || normalized.includes("pending")) return t("session.status_awaiting_approval");
  if (normalized.includes("running") || normalized.includes("progress")) return t("session.status_in_progress");
  if (normalized.includes("error") || normalized.includes("failed")) return t("session.status_failed");
  return null;
}

type StepClusterSummary = {
  category: "read" | "edit" | "terminal" | "search" | "tool";
  label: string;
};

function isRunningStepStatus(status?: string) {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized.includes("running") || normalized.includes("progress") || normalized.includes("pending");
}

export function summarizeStepCluster(stepGroups: StepTimelineGroup[]): StepClusterSummary {
  const toolParts = stepGroups.flatMap((group) =>
    group.parts.filter((part) => part.type === "tool"),
  );
  if (toolParts.length === 1) {
    const toolPart = toolParts[0];
    const summary = summarizeStep(toolPart);
    const toolState = recordValue(toolPart.state);
    const presentation = buildTranscriptToolPresentation({
      toolName: toolPart.tool,
      toolInput: recordValue(toolState?.input) ?? undefined,
      toolOutput: toolState?.output,
      toolMetadata: recordValue(toolState?.metadata) ?? undefined,
    });
    const category = summary.toolCategory === "terminal"
      ? "terminal"
      : summary.toolCategory === "search"
        ? "search"
        : summary.toolCategory === "edit" || summary.toolCategory === "write"
          ? "edit"
          : summary.toolCategory === "read" || summary.toolCategory === "glob"
            ? "read"
            : "tool";
    return {
      category,
      label: presentation.details
        ? specializedToolHeadline(
            presentation.details,
            isRunningStepStatus(summary.status),
          )
        : summary.title,
    };
  }
  const counts = {
    read: 0,
    edit: 0,
    terminal: 0,
    search: 0,
    other: 0,
  };
  let editing = false;
  let processing = false;
  let running = false;

  for (const group of stepGroups) {
    for (const part of group.parts) {
      const summary = summarizeStep(part);
      running = running || isRunningStepStatus(summary.status);
      if (summary.toolCategory === "edit" || summary.toolCategory === "write") {
        counts.edit += 1;
        editing = editing || isRunningStepStatus(summary.status);
      } else if (summary.toolCategory === "terminal") {
        counts.terminal += 1;
      } else if (summary.toolCategory === "search") {
        counts.search += 1;
      } else if (summary.toolCategory === "read" || summary.toolCategory === "glob") {
        counts.read += 1;
      } else {
        counts.other += 1;
        processing = processing || isRunningStepStatus(summary.status);
      }
    }
  }

  const populatedCategoryCount = [
    counts.read,
    counts.edit,
    counts.terminal,
    counts.search,
    counts.other,
  ].filter((count) => count > 0).length;
  const totalCount =
    counts.read + counts.edit + counts.terminal + counts.search + counts.other;
  if (populatedCategoryCount > 1) {
    return {
      category: "tool",
      label: t(
        running
          ? "session.process_summary_processing_items"
          : "session.process_summary_processed_items",
        { count: totalCount },
      ),
    };
  }

  if (counts.edit > 0) {
    return {
      category: "edit",
      label: t(editing ? "session.process_summary_editing" : "session.process_summary_edited", { count: counts.edit }),
    };
  }
  if (counts.terminal > 0) {
    return {
      category: "terminal",
      label: t("session.process_summary_ran_commands", { count: counts.terminal }),
    };
  }
  if (counts.search > 0) {
    return {
      category: "search",
      label: t("session.process_summary_searched_items", { count: counts.search }),
    };
  }
  if (counts.read > 0) {
    return {
      category: "read",
      label: t("session.process_summary_reviewed_files", { count: counts.read }),
    };
  }
  return {
    category: "tool",
    label: t(processing ? "session.process_summary_processing_items" : "session.process_summary_processed_items", { count: counts.other }),
  };
}

export function canMergeStepClusters(previous: MessageBlockItem | undefined, next: StepClusterBlock) {
  if (!previous || previous.kind !== "steps-cluster") return false;
  if (previous.isUser !== next.isUser) return false;
  return true;
}

export function shouldFoldStepGroups(stepGroups: StepTimelineGroup[]) {
  return stepGroups.some((group) => group.parts.length > 0);
}

export function mergeLeadingAssistantStepClusters(blocks: MessageBlockItem[]) {
  const merged: MessageBlockItem[] = [];
  for (const block of blocks) {
    const previousBlock = merged.at(-1);
    if (
      block.kind === "message" &&
      !block.isUser &&
      previousBlock?.kind === "steps-cluster" &&
      !previousBlock.isUser
    ) {
      merged.pop();
      merged.push({
        ...block,
        leadingStepGroups: previousBlock.stepGroups,
        leadingStepMessageIds: previousBlock.messageIds,
      });
      continue;
    }
    merged.push(block);
  }
  return merged;
}

async function openFileWithOS(path: string) {
  try {
    await openDesktopPath(path);
  } catch {
    // silently fail on web
  }
}

async function revealFileInFinder(path: string) {
  try {
    await revealDesktopItemInDir(path);
  } catch {
    // silently fail on web
  }
}

function CopyButton(props: { getText: () => string }) {
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

function TranscriptSpeechButton(props: { text: string }) {
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

function TranscriptShareButton(props: { text: string }) {
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

export type TranscriptFeedbackValue = "like" | "dislike";

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

export function toggleTranscriptFeedback(
  state: Record<string, TranscriptFeedbackValue>,
  messageId: string,
  value: TranscriptFeedbackValue,
) {
  if (state[messageId] === value) {
    const next = { ...state };
    delete next[messageId];
    return next;
  }
  return { ...state, [messageId]: value };
}

function TranscriptFeedbackControls(props: { messageId: string }) {
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

function TranscriptMoreMenu(props: {
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

function TranscriptTurnStatus(props: {
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

function TranscriptAssistantHeader(props: {
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

function TranscriptCancelledIndicator(props: {
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

function TranscriptTurnActions(props: {
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

function TranscriptUserToolbar(props: {
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

const PASTE_TOKEN_RE = /(\[pasted text [^\]]+\])/;
const PASTE_TOKEN_EXACT_RE = /^\[pasted text (.+)\]$/;

export function resolveDisplayedPastedText(
  text: string,
  pastedTextMap?: Map<string, string>,
) {
  if (!pastedTextMap?.size || !PASTE_TOKEN_RE.test(text)) return text;
  return text
    .split(PASTE_TOKEN_RE)
    .map((segment) => {
      const match = segment.match(PASTE_TOKEN_EXACT_RE);
      if (!match?.[1]) return segment;
      return pastedTextMap.get(match[1]) ?? segment;
    })
    .join("");
}

function HighlightedPlainText(props: {
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

function SkillReferenceText(props: { text: string; highlightQuery?: string }) {
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

function FileCard(props: {
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

function TranscriptReasoning(props: {
  text: string;
  complete: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const trustedScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || collapsed || props.complete || !autoScrollRef.current) return;
    const nextScrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
    if (Math.abs(content.scrollTop - nextScrollTop) <= 1) {
      trustedScrollRef.current = false;
      lastScrollTopRef.current = content.scrollTop;
      return;
    }
    trustedScrollRef.current = true;
    content.scrollTo({ top: nextScrollTop, behavior: "auto" });
  }, [collapsed, props.complete, props.text]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const currentScrollTop = target.scrollTop;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (trustedScrollRef.current) {
      trustedScrollRef.current = false;
      lastScrollTopRef.current = currentScrollTop;
      return;
    }
    const scrollingUp = currentScrollTop < lastScrollTopRef.current;
    if (!scrollingUp && Math.abs(distanceFromBottom) < 10) {
      autoScrollRef.current = true;
    } else if (scrollingUp && distanceFromBottom > 20) {
      autoScrollRef.current = false;
    }
    lastScrollTopRef.current = currentScrollTop;
  };

  return (
    <section
      data-reasoning="true"
      data-reasoning-state={props.complete ? "complete" : "streaming"}
      className="flex max-w-[760px] flex-col gap-0.5 py-0.5 text-dls-secondary"
    >
      <DisclosureRowButton
        type="button"
        density="flush"
        aria-expanded={!collapsed}
        className="gap-1 text-sm leading-6 text-dls-secondary hover:bg-transparent hover:text-dls-text"
        onClick={() => setCollapsed((current) => !current)}
      >
        <MessageRolePrefix role="thinking" />
        <span className={cn(!props.complete && "session-transcript-loading-shimmer")}>
          {t("session.reasoning")}
        </span>
        {props.complete ? (
          <ChevronDown
            size={12}
            className={cn(
              "transition-transform",
              collapsed && "-rotate-90 opacity-0 group-hover:opacity-100",
            )}
          />
        ) : null}
      </DisclosureRowButton>
      <MessageRoleRow
        role="thinking"
        ref={contentRef}
        hidden={collapsed}
        data-scrollable="true"
        onScroll={handleScroll}
        className="max-h-[200px] overflow-x-hidden overflow-y-auto rounded-none bg-transparent py-0.5 pl-3 pr-1 text-dls-text not-italic"
      >
        <MarkdownBlock
          text={props.text}
          streaming={!props.complete}
          showStreamingCursor={false}
          locale={currentLocale()}
        />
      </MessageRoleRow>
    </section>
  );
}

function StepRow(props: {
  id: string;
  part: TranscriptPart;
  expanded: boolean;
  onToggle: () => void;
  onOpenCodePath?: (path: string) => void;
  isStreamingReasoning: boolean;
}) {
  const platform = usePlatform();
  const summary = useMemo(() => summarizeStep(props.part), [props.part]);
  const toolState = useMemo<Record<string, unknown>>(() => {
    if (props.part.type !== "tool" || !("state" in props.part)) return {};
    return isRecordValue(props.part.state) ? props.part.state : {};
  }, [props.part]);
  const toolInput = isRecordValue(toolState.input) ? toolState.input : undefined;
  const toolOutput = toolState.output;
  const toolMetadata = isRecordValue(toolState.metadata) ? toolState.metadata : undefined;
  const toolError = typeof toolState.error === "string" ? toolState.error : null;
  const toolPresentation = props.part.type === "tool"
    ? buildTranscriptToolPresentation({
        toolName: props.part.tool,
        toolInput,
        toolOutput,
        toolMetadata,
      })
    : null;
  const specializedDetails = toolPresentation?.details ?? null;
  const expandable =
    props.part.type === "tool" &&
    toolPresentation?.family !== "read" &&
    (specializedDetails
      ? specializedToolCanExpand(specializedDetails) || Boolean(toolError)
      : hasStructuredValue(toolInput) || hasStructuredValue(toolOutput) || Boolean(toolError));
  const headline = specializedDetails
    ? specializedToolHeadline(specializedDetails, isRunningStepStatus(summary.status))
    : summary.title?.trim() || t("session.step_progress");
  const statusText = toolStatusText(summary.status);
  const questionAnswers =
    props.part.type === "tool" && props.part.tool.toLowerCase() === "question"
      ? normalizeTranscriptQuestionAnswers(toolInput, toolOutput)
      : [];

  if (questionAnswers.length > 0) {
    return (
      <div className="rounded-lg border border-dls-border bg-dls-surface p-3 text-sm">
        <div className="mb-3 flex items-center gap-2 font-medium text-dls-text">
          <HelpCircle className="size-4 text-dls-accent" />
          <span>{t("session.question_answered")}</span>
        </div>
        <div className="space-y-3">
          {questionAnswers.map((item, index) => (
            <div key={`${item.question}:${index}`} className="space-y-1">
              <div className="text-xs text-dls-secondary">
                {item.header || t("common.question")}
              </div>
              <div className="leading-5 text-dls-text">{item.question}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm leading-5">
                <span className="text-dls-secondary">{t("session.question_answer")}</span>
                {item.answers.map((answer) => (
                  <StatusBadge key={answer} size="tiny" shape="soft">
                    {answer}
                  </StatusBadge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (specializedDetails?.kind === "image-gen") {
    return (
      <ImageGenerationToolCard
        details={specializedDetails}
        running={isRunningStepStatus(summary.status)}
        expanded={props.expanded}
        onToggle={props.onToggle}
      />
    );
  }

  if (props.part.type === "reasoning") {
    if (!props.part.text.trim()) return null;
    return (
      <TranscriptReasoning
        text={props.part.text}
        complete={!props.isStreamingReasoning}
      />
    );
  }

  if (
    specializedDetails?.kind === "compact-tool" &&
    specializedDetails.variant === "preview-url" &&
    specializedDetails.summary
  ) {
    return (
      <div className={messageTextClass.body}>
        <div className="inline-flex min-w-0 max-w-[760px] items-center gap-3 text-dls-secondary">
          <ToolActivityIcon category={summary.toolCategory} />
          <span>{headline}</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto min-w-0 justify-start p-0 font-normal"
            title={specializedDetails.summary}
            onClick={() => platform.openLink(specializedDetails.summary ?? "")}
          >
            <span className="truncate">{specializedDetails.summary}</span>
          </Button>
        </div>
      </div>
    );
  }

  if (specializedDetails?.kind === "open-result" && specializedDetails.target) {
    return (
      <div className={messageTextClass.body}>
        <div className="inline-flex min-w-0 max-w-[760px] items-center gap-3 text-dls-secondary">
          <ToolActivityIcon category={summary.toolCategory} />
          <span>{headline}</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto min-w-0 justify-start p-0 font-mono font-normal"
            title={specializedDetails.target}
            onClick={() => {
              if (props.onOpenCodePath) props.onOpenCodePath(specializedDetails.target);
              else void openDesktopPath(specializedDetails.target);
            }}
          >
            <span className="truncate">{specializedDetails.target}</span>
          </Button>
          <StatusBadge size="tiny" shape="soft">{specializedDetails.viewType}</StatusBadge>
        </div>
      </div>
    );
  }

  return (
    <div className={messageTextClass.body}>
      <DisclosureRowButton
        type="button"
        density="flush"
        className="text-dls-secondary hover:bg-transparent hover:text-dls-text disabled:cursor-default"
        aria-expanded={expandable ? props.expanded : undefined}
        disabled={!expandable}
        onClick={() => {
          if (!expandable) return;
          props.onToggle();
        }}
      >
        <span className="inline-flex min-w-0 max-w-[760px] items-center gap-3">
          <ToolActivityIcon category={summary.toolCategory} />
          <span className="min-w-0 flex-1">
            <span className="block wrap-break-word">{headline}</span>
            {toolPresentation?.secondary ? (
              <span
                className="mt-0.5 block truncate font-mono text-xs text-dls-secondary"
                title={toolPresentation.secondary}
              >
                {toolPresentation.secondary}
              </span>
            ) : null}
          </span>
          {toolPresentation?.lineRange ? (
            <StatusBadge size="tiny" shape="soft">
              {toolPresentation.lineRange}
            </StatusBadge>
          ) : null}
          {toolPresentation && toolPresentation.addedLines > 0 ? (
            <span className="text-xs text-dls-status-success-fg">
              +{toolPresentation.addedLines}
            </span>
          ) : null}
          {toolPresentation && toolPresentation.removedLines > 0 ? (
            <span className="text-xs text-dls-status-danger-fg">
              -{toolPresentation.removedLines}
            </span>
          ) : null}
          {expandable ? (
            <ChevronDown
              size={14}
              className={cn(
                "shrink-0 text-dls-secondary transition-transform",
                !props.expanded && "-rotate-90",
              )}
            />
          ) : null}
        </span>
      </DisclosureRowButton>
      {statusText ? <div className={messageTextClass.toolStatus}>{statusText}</div> : null}
      {props.expanded ? (
        <div className="mt-3 ml-7 space-y-3">
          {specializedDetails ? (
            <SpecializedToolDetails
              details={specializedDetails}
              onOpenCodePath={props.onOpenCodePath}
            />
          ) : null}
          {!specializedDetails && hasStructuredValue(toolInput) && (
            toolPresentation?.family === "generic" ||
            toolPresentation?.family === "write"
          ) ? (
            <div>
              <div className={messageTextClass.toolLabel}>{t("session.tool_request")}</div>
              <pre className="overflow-x-auto rounded-xl border border-dls-mist bg-dls-surface px-4 py-3 text-xs leading-6 text-dls-secondary">
                {formatStructuredValue(toolInput)}
              </pre>
            </div>
          ) : null}
          {!specializedDetails && hasStructuredValue(toolOutput) ? (
            <div>
              <div className={messageTextClass.toolLabel}>{t("session.tool_result")}</div>
              <pre className="overflow-x-auto rounded-xl border border-dls-mist bg-dls-surface px-4 py-3 text-xs leading-6 text-dls-secondary">
                {formatStructuredValue(toolOutput)}
              </pre>
            </div>
          ) : null}
          {toolError ? (
            <div>
              <div className={messageTextClass.toolLabel}>{t("session.tool_error")}</div>
              <pre className={messageStateClass.toolError}>
                {toolError}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function processItemToLegacyPart(item: TurnProcessItem) {
  return toLegacyPart(item.part, `${item.messageId}:${item.partIndex}`);
}

function processPlanDetails(items: TurnProcessItem[]) {
  for (const item of items) {
    const part = processItemToLegacyPart(item);
    if (!part || part.type !== "tool") continue;
    const state = recordValue(part.state);
    const presentation = buildTranscriptToolPresentation({
      toolName: part.tool,
      toolInput: recordValue(state?.input) ?? undefined,
      toolOutput: state?.output,
      toolMetadata: recordValue(state?.metadata) ?? undefined,
    });
    if (presentation.details?.kind === "plan") return presentation.details;
  }
  return null;
}

function processFoldChipMeta(items: TurnProcessItem[]): {
  label: string;
  category?: string;
  variant: "thinking" | "tool-chip" | "summary";
} {
  if (processPlanDetails(items)) {
    return { label: t("session.workbuddy_task_list"), category: "terminal", variant: "summary" };
  }
  const legacyParts = items.flatMap((item) => {
    const part = processItemToLegacyPart(item);
    return part ? [part] : [];
  });
  if (legacyParts.length > 0 && legacyParts.every((part) => part.type === "reasoning")) {
    return {
      label: t("session.process_summary_deep_thinking"),
      variant: "thinking",
    };
  }

  // Single concrete op → WorkBuddy chip label (加载技能 / 运行命令 / …)
  if (legacyParts.length === 1 && legacyParts[0]?.type === "tool") {
    const part = legacyParts[0];
    const summary = summarizeStep(part);
    const tool = part.tool.toLowerCase();
    const toolState = "state" in part && isRecordValue(part.state) ? part.state : null;
    const toolInput = toolState && isRecordValue(toolState.input) ? toolState.input : null;
    const skillNameRaw = toolInput
      ? (typeof toolInput.name === "string" && toolInput.name.trim()
        ? toolInput.name.trim()
        : typeof toolInput.command === "string" && toolInput.command.trim()
          ? toolInput.command.trim()
          : "")
      : "";
    const skillName = skillNameRaw || summary.skillName?.trim() || "";

    if (tool === "skill" || tool === "useskill" || tool.includes("skill")) {
      return {
        label: skillName
          ? t("session.tool_chip_load_skill", { skill: skillName })
          : t("session.tool_chip_load_skill_generic"),
        category: "tool",
        variant: "tool-chip",
      };
    }
    if (
      tool === "bash" ||
      tool === "shell" ||
      tool.includes("command") ||
      tool.includes("terminal")
    ) {
      return {
        label: t("session.tool_chip_run_command"),
        category: "terminal",
        variant: "tool-chip",
      };
    }
    if (
      tool.includes("browser") ||
      tool.includes("playwright") ||
      tool.includes("web") ||
      tool.includes("fetch")
    ) {
      return {
        label: t("session.tool_chip_browser"),
        category: "search",
        variant: "tool-chip",
      };
    }
    return {
      label: summary.title?.trim() || t("session.process_summary_continue_processing"),
      category: summary.toolCategory,
      variant: "tool-chip",
    };
  }

  const toolNames = legacyParts.flatMap((part) => (
    part.type === "tool" ? [part.tool.toLowerCase()] : []
  ));
  if (toolNames.some((name) => (
    name.includes("search") || name.includes("fetch") || name.includes("browser") || name.includes("web")
  ))) {
    return {
      label: t("session.process_summary_collecting_sources"),
      category: "search",
      variant: "summary",
    };
  }
  const terminalCount = toolNames.filter((name) => (
    name === "bash" || name.includes("command") || name.includes("terminal") || name === "shell"
  )).length;
  if (terminalCount > 0) {
    return {
      label: t("session.process_summary_ran_commands", { count: terminalCount }),
      category: "terminal",
      variant: "summary",
    };
  }
  const editCount = toolNames.filter((name) => (
    name.includes("write") || name.includes("edit") || name.includes("patch") || name.includes("replace")
  )).length;
  if (editCount > 0) {
    return {
      label: t("session.process_summary_edited", { count: editCount }),
      category: "edit",
      variant: "summary",
    };
  }
  const readCount = toolNames.filter((name) => (
    name.includes("read") || name.includes("glob") || name.includes("list")
  )).length;
  if (readCount > 0) {
    return {
      label: t("session.process_summary_reviewed_files", { count: readCount }),
      category: "read",
      variant: "summary",
    };
  }
  if (legacyParts.length > 0) {
    const summary = summarizeStepCluster([{
      id: `turn-process:${items[0]?.messageId ?? "unknown"}`,
      parts: legacyParts,
      mode: "standalone",
    }]);
    if (summary.category !== "tool") {
      return { label: summary.label, category: summary.category, variant: "summary" };
    }
  }
  return {
    label: t("session.process_summary_continue_processing"),
    category: "tool",
    variant: "summary",
  };
}

function processFoldLabel(items: TurnProcessItem[]) {
  return processFoldChipMeta(items).label;
}

function WorkBuddyTaskList(props: {
  todos: TranscriptTodoItem[];
  running: boolean;
}) {
  const [displayRunning, setDisplayRunning] = useState(() => props.running);
  const [expanded, setExpanded] = useState(() => props.running);
  const previousRunningRef = useRef(props.running);
  const taskHistoryRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    if (props.running) {
      setDisplayRunning(true);
      return;
    }
    const timeout = window.setTimeout(() => setDisplayRunning(false), 1_000);
    return () => window.clearTimeout(timeout);
  }, [props.running]);
  useEffect(() => {
    const wasRunning = previousRunningRef.current;
    previousRunningRef.current = displayRunning;
    if (!wasRunning && displayRunning) setExpanded(true);
    if (wasRunning && !displayRunning) setExpanded(false);
  }, [displayRunning]);

  const todos = props.todos.map((todo, index) => {
    const content = (
      todo.status === "in_progress" && todo.activeForm
        ? todo.activeForm
        : todo.content
    ).trim();
    if (content) taskHistoryRef.current.set(index, content);
    return { ...todo, content: content || taskHistoryRef.current.get(index) || `Task ${index + 1}` };
  });

  return (
    <div className="session-workbuddy-task-list" data-workbuddy-task-list="true">
      <button
        type="button"
        className="session-workbuddy-task-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Terminal aria-hidden="true" />
        <span>{t("session.workbuddy_task_list")}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("session-workbuddy-task-chevron", expanded && "is-expanded")}
        />
      </button>
      {expanded && todos.length > 0 ? (
        <div className="session-workbuddy-task-detail">
          {todos.map((todo, index) => (
            <div
              key={`task-${index}`}
              className={cn(
                "session-workbuddy-task-item",
                todo.status === "in_progress" && "is-running",
                todo.status === "completed" && "is-completed",
              )}
            >
              <span className="session-workbuddy-task-icon" aria-hidden="true">
                {todo.status === "completed" ? <Check /> : null}
                {todo.status === "in_progress" ? <LoadingSpinner /> : null}
                {todo.status === "cancelled" ? <CircleAlert /> : null}
                {todo.status === "pending" ? <span className="session-workbuddy-task-pending" /> : null}
              </span>
              <span className="session-workbuddy-task-text">{todo.content}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkBuddyProcessFold(props: {
  id: string;
  items: TurnProcessItem[];
  running: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  onOpenCodePath?: (path: string) => void;
}) {
  const plan = processPlanDetails(props.items);
  const [expanded, setExpanded] = useState(false);
  if (plan) return <WorkBuddyTaskList todos={plan.todos} running={props.running} />;

  const chip = processFoldChipMeta(props.items);
  const isThinking = chip.variant === "thinking";
  const isToolChip = chip.variant === "tool-chip";

  const toggleStep = (id: string) => {
    props.onExpandedStepIdsChange((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section
      className={cn(
        "session-workbuddy-process-fold",
        expanded && "is-expanded",
        isToolChip && "is-tool-chip",
        isThinking && "is-thinking",
        chip.variant === "summary" && "is-summary",
      )}
      data-process-variant={chip.variant}
    >
      <button
        type="button"
        className={cn(
          "session-workbuddy-process-head",
          isToolChip && "session-workbuddy-process-head-chip",
          isThinking && "session-workbuddy-process-head-thinking",
          chip.variant === "summary" && "session-workbuddy-process-head-chip",
        )}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {isThinking ? null : chip.category === "tool" && isToolChip ? (
          <Sparkles aria-hidden="true" className="session-workbuddy-process-icon" />
        ) : (
          <span className="session-workbuddy-process-icon-wrap" aria-hidden="true">
            {props.running && chip.variant === "summary" ? (
              <LoadingSpinner size="sm" />
            ) : (
              <ToolActivityIcon category={chip.category} />
            )}
          </span>
        )}
        <span>{chip.label}</span>
        <ChevronDown aria-hidden="true" className="session-workbuddy-process-arrow" />
      </button>
      {expanded ? (
        <div className="session-workbuddy-process-body" data-scrollable="true">
          {props.items.map((item) => {
            const key = `${item.messageId}:${item.partIndex}`;
            if (item.part.type === "reasoning") {
              if (!item.part.text.trim()) return null;
              return (
                <MarkdownBlock
                  key={key}
                  text={item.part.text}
                  streaming={props.running}
                  showStreamingCursor={false}
                  locale={currentLocale()}
                />
              );
            }
            const legacyPart = processItemToLegacyPart(item);
            if (!legacyPart) return null;
            return (
              <StepRow
                key={key}
                id={key}
                part={legacyPart}
                expanded={props.expandedStepIds.has(key)}
                onToggle={() => toggleStep(key)}
                onOpenCodePath={props.onOpenCodePath}
                isStreamingReasoning={props.running}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) record[key] = item;
  return record;
}

function recordText(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

function StepsContainer(props: {
  stepGroups: StepTimelineGroup[];
  isUser: boolean;
  isInline?: boolean;
  isNestedVariant: boolean;
  isActive: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  turnDetailsExpanded?: boolean;
  onTurnDetailsExpandedChange?: (expanded: boolean) => void;
  onOpenCodePath?: (path: string) => void;
  isTrailingMessageContent?: boolean;
}) {
  const toggleSteps = (id: string) => {
    props.onExpandedStepIdsChange((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const shouldFold = shouldFoldStepGroups(props.stepGroups);
  const active = props.isActive;
  const [containerExpanded, setContainerExpanded] = useState(active);
  const detailsExpanded = props.turnDetailsExpanded === true || containerExpanded;
  const toggleContainer = () => {
    if (props.onTurnDetailsExpandedChange) {
      props.onTurnDetailsExpandedChange(!detailsExpanded);
      return;
    }
    setContainerExpanded((value) => !value);
  };
  const stepSummaries = useMemo(
    () =>
      props.stepGroups.flatMap((group) =>
        group.parts.map((part) => summarizeStep(part).title?.trim()).filter(Boolean),
      ),
    [props.stepGroups],
  );
  const clusterSummary = useMemo(
    () => summarizeStepCluster(props.stepGroups),
    [props.stepGroups],
  );
  const previewItems = stepSummaries.slice(0, 2);

  if (!shouldFold) {
    return (
      <div className="max-w-[760px]">
        <div className="flex flex-col gap-5">
          {props.stepGroups.map((group, groupIndex) => (
            <div key={group.id} className="flex flex-col gap-5">
              {group.parts.map((part, index) => {
                const rowId = `${group.id}:${index}`;
                const isLastPartInGroup = index === group.parts.length - 1;
                const isLastStepGroup = groupIndex === props.stepGroups.length - 1;
                return (
                  <StepRow
                    key={rowId}
                    id={rowId}
                    part={part}
                    expanded={props.expandedStepIds.has(rowId)}
                    onToggle={() => toggleSteps(rowId)}
                    onOpenCodePath={props.onOpenCodePath}
                    isStreamingReasoning={
                      props.isActive &&
                      props.isTrailingMessageContent !== false &&
                      isLastStepGroup &&
                      isLastPartInGroup
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[760px] rounded-xl border border-dls-mist bg-dls-surface-muted">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-dls-secondary transition-colors hover:bg-dls-surface-muted hover:text-dls-text"
        aria-expanded={detailsExpanded}
        onClick={toggleContainer}
      >
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-dls-secondary transition-transform",
            !detailsExpanded && "-rotate-90",
          )}
        />
        <ToolActivityIcon category={clusterSummary.category} />
        <span className="font-medium text-dls-text">{clusterSummary.label}</span>
        {active ? (
          <StatusBadge tone="accent" size="tiny">
            {t("session.status_running")}
          </StatusBadge>
        ) : null}
      </button>
      {!detailsExpanded && previewItems.length > 0 ? (
        <div className="border-t border-dls-mist px-3 py-2 text-xs leading-5 text-dls-secondary">
          {previewItems.map((item) => (
            <div key={item} className="truncate">
              {item}
            </div>
          ))}
        </div>
      ) : null}
      {detailsExpanded ? (
        <div
          data-scrollable={!props.isNestedVariant ? "true" : undefined}
          className={cn(
            "border-t border-dls-mist px-3 py-3",
            !props.isNestedVariant && "max-h-[520px] overflow-y-auto pr-3",
          )}
        >
          <div className="flex flex-col gap-5">
            {props.stepGroups.map((group, groupIndex) => (
              <div key={group.id} className="flex flex-col gap-5">
                {group.parts.map((part, index) => {
                  const rowId = `${group.id}:${index}`;
                  const isLastPartInGroup = index === group.parts.length - 1;
                  const isLastStepGroup = groupIndex === props.stepGroups.length - 1;
                  return (
                    <StepRow
                      key={rowId}
                      id={rowId}
                      part={part}
                      expanded={props.expandedStepIds.has(rowId)}
                      onToggle={() => toggleSteps(rowId)}
                      onOpenCodePath={props.onOpenCodePath}
                      isStreamingReasoning={
                        props.isActive &&
                        props.isTrailingMessageContent !== false &&
                        isLastStepGroup &&
                        isLastPartInGroup
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function messageGroupKey(messageId: string, group: MessageGroup) {
  if (group.kind === "steps") return `${messageId}:steps:${group.id}`;
  const partId = "id" in group.part && typeof group.part.id === "string" ? group.part.id : partToText(group.part);
  return `${messageId}:text:${group.segment}:${partId}`;
}

export function selectTurnOpenTargets(
  messages: UIMessage[],
  verifiedTargets: OpenTarget[] | undefined,
) {
  const verifiedById = new Map((verifiedTargets ?? []).map((target) => [target.id, target] as const));
  const inlineTargets = new Map<string, OpenTarget>();
  for (const candidate of deriveOpenTargets(messages, { includeFileMentions: true })) {
    const verified = verifiedById.get(candidate.id);
    if (candidate.kind === "url" && isLocalhostBrowserTarget(candidate)) {
      inlineTargets.set(candidate.id, verified ?? candidate);
      continue;
    }
    if (verified && isCollectibleArtifactTarget(verified)) {
      inlineTargets.set(verified.id, verified);
    }
  }
  return Array.from(inlineTargets.values()).slice(0, 4);
}

function OpenTargetIcon(props: { target: OpenTarget }) {
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

function OpenableTargetsStrip(props: { targets: OpenTarget[]; onOpenTarget: (target: OpenTarget) => void }) {
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

function TranscriptDividerRow(props: {
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

function WorkBuddyTurnContent(props: {
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

function MessageBlockRow(props: {
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

function SessionTranscriptInner(props: SessionTranscriptProps) {
  const showThinking = props.showThinking ?? DEFAULT_SHOW_THINKING;
  const isNestedVariant = props.variant === "nested";
  const [rootContentWidth, setRootContentWidth] = useState(
    DEFAULT_TRANSCRIPT_MAX_CONTENT_WIDTH,
  );
  const [rootViewportHeight, setRootViewportHeight] = useState(0);
  const [internalExpandedStepIds, setInternalExpandedStepIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedTurnIds, setExpandedTurnIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expandedStepIds = props.expandedStepIds ?? internalExpandedStepIds;
  const onExpandedStepIdsChange =
    props.onExpandedStepIdsChange ??
    ((updater: (current: Set<string>) => Set<string>) => {
      setInternalExpandedStepIds((current) => updater(current));
    });
  const onTurnDetailsExpandedChange = useCallback((turnId: string, expanded: boolean) => {
    if (!turnId) return;
    setExpandedTurnIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(turnId);
      else next.delete(turnId);
      return next;
    });
  }, []);

  const transcriptMessages = useMemo<TranscriptMessage[]>(() => {
    return props.messages.map((message) => ({
      id: message.id,
      role: message.role,
      source: message,
      parts: message.parts.flatMap((part, index) => {
        const legacyPart = toLegacyPart(part, `${message.id}:${index}`);
        return legacyPart ? [legacyPart] : [];
      }),
    }));
  }, [props.messages]);

  useEffect(() => {
    if (isNestedVariant) return;
    const scrollContainer = props.scrollElement?.();
    if (!scrollContainer) return;

    const updateViewport = () => {
      // Use the same box metric for both the initial read and ResizeObserver
      // delivery. clientHeight/clientWidth include the scroll container's
      // padding; contentRect does not. Mixing them made the active turn's
      // reserved height alternate by exactly 40px on every streaming render.
      setRootContentWidth(computeTranscriptMaxContentWidth(scrollContainer.clientWidth));
      setRootViewportHeight(scrollContainer.clientHeight);
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [isNestedVariant, props.scrollElement]);

  // Cache of the previous messageBlocks array, indexed by identity key.
  // Used by useStableBlocks below so structurally-equivalent blocks keep
  // their previous object reference across renders.
  const previousBlocksRef = useRef<Map<string, MessageBlockItem>>(new Map());

  const rawMessageBlocks = useMemo<MessageBlockItem[]>(() => {
    const blocks: MessageBlockItem[] = [];
    const dividers = [...(props.dividers ?? [])]
      .filter((divider) => divider.label.trim())
      .sort((left, right) => {
        if (left.afterMessageCount !== right.afterMessageCount) {
          return left.afterMessageCount - right.afterMessageCount;
        }
        return left.id.localeCompare(right.id);
      });
    let nextDividerIndex = 0;
    const pushReadyDividers = (afterMessageCount: number) => {
      while (
        nextDividerIndex < dividers.length &&
        isTranscriptDividerReady(dividers[nextDividerIndex], afterMessageCount)
      ) {
        const divider = dividers[nextDividerIndex];
        if (divider) {
          blocks.push({
            kind: "divider",
            id: divider.id,
            label: divider.label,
            variant: divider.variant,
            afterMessageCount: divider.afterMessageCount,
            isUser: false,
          });
        }
        nextDividerIndex += 1;
      }
    };

    pushReadyDividers(0);
    transcriptMessages.forEach((message, messageIndex) => {
      const renderableParts = message.parts.filter((part) => {
        if (
          message.role === "assistant" &&
          (part.type === "text" || part.type === "reasoning") &&
          isInternalAssistantNarration(part.text)
        ) {
          return false;
        }
        if (part.type === "reasoning") {
          return showThinking;
        }

        if (part.type === "step-start" || part.type === "step-finish") {
          return false;
        }

        return (
          part.type === "text" ||
          part.type === "tool" ||
          part.type === "agent" ||
          part.type === "file" ||
          props.developerMode
        );
      });

      if (!renderableParts.length) {
        pushReadyDividers(messageIndex + 1);
        return;
      }

      // Filter out empty assistant messages. A newly-created session can briefly have
      // an empty assistant message with just a text part containing whitespace.
      // User messages always render even if empty because they carry the prompt.
      const isUser = message.role === "user";
      if (!isUser && renderableParts.every((part) => {
        if (part.type === "text") return partToText(part).trim().length === 0;
        if (part.type === "reasoning") return partToText(part).trim().length === 0;
        return false;
      })) {
        pushReadyDividers(messageIndex + 1);
        return;
      }
      const attachments = attachmentsForParts(renderableParts);
      const nonAttachmentParts = renderableParts.filter((part) => !isAttachmentPart(part));
      const groups = groupMessageParts(nonAttachmentParts, message.id);
      const isStepsOnly = groups.length > 0 && groups.every((group) => group.kind === "steps");
      const stepGroups = isStepsOnly
        ? (groups as Array<{
            kind: "steps";
            id: string;
            parts: TranscriptPart[];
            segment: "execution";
            mode: StepGroupMode;
          }>).map((group) => ({
            id: group.id,
            parts: group.parts,
            mode: group.mode,
          }))
        : [];

      if (isStepsOnly && stepGroups.length > 0) {
        const nextBlock: StepClusterBlock = {
          kind: "steps-cluster",
          id: stepGroups[0].id,
          stepGroups,
          messageIds: [message.id],
          isUser,
        };
        const previousBlock = blocks.at(-1);
        if (canMergeStepClusters(previousBlock, nextBlock) && previousBlock?.kind === "steps-cluster") {
          previousBlock.stepGroups = [...previousBlock.stepGroups, ...nextBlock.stepGroups];
          previousBlock.messageIds = [...previousBlock.messageIds, ...nextBlock.messageIds];
        } else {
          blocks.push(nextBlock);
        }
        pushReadyDividers(messageIndex + 1);
        return;
      }

      blocks.push({
        kind: "message",
        message: message.source,
        renderableParts,
        attachments,
        groups,
        isUser,
        messageId: message.id,
      });
      pushReadyDividers(messageIndex + 1);
    });
    while (nextDividerIndex < dividers.length) {
      const divider = dividers[nextDividerIndex];
      if (divider) {
        blocks.push({
          kind: "divider",
          id: divider.id,
          label: divider.label,
          variant: divider.variant,
          afterMessageCount: divider.afterMessageCount,
          isUser: false,
        });
      }
      nextDividerIndex += 1;
    }

    return blocks;
  }, [props.developerMode, props.dividers, showThinking, transcriptMessages]);

  // Structural sharing: reuse the previous block object reference for any
  // block whose content is equivalent. During streaming, only the active
  // assistant message's block is actually new — every other block in the
  // transcript keeps its previous reference, which means every
  // React.memo'd descendant (MarkdownBlock, SessionTranscript itself, and
  // any future per-row components) gets a pointer-equal prop and can bail
  // out of rendering entirely.
  const messageBlocks = useMemo<MessageBlockItem[]>(() => {
    const prev = previousBlocksRef.current;
    const next = new Map<string, MessageBlockItem>();
    const stable: MessageBlockItem[] = rawMessageBlocks.map((block) => {
      const key = blockIdentityKey(block);
      const prevBlock = prev.get(key);
      const reused = blocksAreEquivalent(prevBlock, block) ? (prevBlock as MessageBlockItem) : block;
      next.set(key, reused);
      return reused;
    });
    previousBlocksRef.current = next;
    return stable;
  }, [rawMessageBlocks]);

  const cancelledMessageIds = useMemo(
    () => cancelledAssistantMessageIds(props.messages, props.dividers),
    [props.dividers, props.messages],
  );
  const transcriptTurns = useMemo(
    () => buildTranscriptTurns(props.messages, {
      isStreaming: props.isStreaming,
      cancelledMessageIds,
    }),
    [cancelledMessageIds, props.isStreaming, props.messages],
  );
  const turnIdByMessageId = useMemo(() => {
    const turnIds = new Map<string, string>();
    transcriptTurns.forEach((turn) => {
      turn.messages.forEach((message) => turnIds.set(message.id, turn.id));
    });
    return turnIds;
  }, [transcriptTurns]);
  const renderItems = useMemo(() => {
    if (isNestedVariant) {
      return messageBlocks.map<TranscriptRenderItem<MessageBlockItem>>((block) => {
        const blockKey = blockIdentityKey(block);
        return block.kind === "divider"
          ? { kind: "divider", id: blockKey, block }
          : { kind: "turn", id: `block:${blockKey}`, turnId: null, blocks: [block] };
      });
    }
    return groupTranscriptRenderItems(
      messageBlocks.map((block) => ({
        key: blockIdentityKey(block),
        block,
        messageIds: messageIdsForBlock(block),
        dividerId: block.kind === "divider" ? block.id : null,
      })),
      turnIdByMessageId,
    );
  }, [isNestedVariant, messageBlocks, turnIdByMessageId]);
  const firstAssistantRenderItemId = useMemo(() => (
    renderItems.find((item) => (
      item.kind === "turn" && item.blocks.some((block) => (
        block.kind !== "divider" && !block.isUser
      ))
    ))?.id ?? null
  ), [renderItems]);

  const turnContentByTurnId = useMemo(() => {
    const presentations = new Map<string, TurnContentPresentation>();
    if (isNestedVariant || props.searchHighlightQuery?.trim()) return presentations;
    transcriptTurns.forEach((turn) => {
      const presentation = buildTurnContentPresentation(turn);
      if (presentation) presentations.set(turn.id, presentation);
    });
    return presentations;
  }, [isNestedVariant, props.searchHighlightQuery, transcriptTurns]);

  const turnPresentationByBlockKey = useMemo(() => {
    const presentations = new Map<string, TranscriptBlockTurnPresentation>();
    if (isNestedVariant) return presentations;
    const turnIdByAssistantMessageId = new Map<string, string>();
    transcriptTurns.forEach((turn) => {
      turn.assistantMessages.forEach((message) => {
        turnIdByAssistantMessageId.set(message.id, turn.id);
      });
    });
    const firstAssistantBlockKeys = new Set<string>();
    renderItems.forEach((item) => {
      if (item.kind === "divider") return;
      const firstAssistantBlock = item.blocks.find((block) =>
        messageIdsForBlock(block).some((messageId) =>
          turnIdByAssistantMessageId.has(messageId),
        ),
      );
      if (firstAssistantBlock) {
        firstAssistantBlockKeys.add(blockIdentityKey(firstAssistantBlock));
      }
    });
    const blockKeysByTurnId = new Map<string, string[]>();
    const turnsWithExecutionDetails = new Set<string>();
    messageBlocks.forEach((block) => {
      if (block.kind === "divider" || block.isUser) return;
      const messageIds = block.kind === "steps-cluster"
        ? block.messageIds
        : [...(block.leadingStepMessageIds ?? []), block.messageId];
      const turnId = messageIds
        .map((messageId) => turnIdByAssistantMessageId.get(messageId))
        .find((candidate) => candidate !== undefined);
      if (!turnId) return;
      const blockKeys = blockKeysByTurnId.get(turnId) ?? [];
      blockKeys.push(blockIdentityKey(block));
      blockKeysByTurnId.set(turnId, blockKeys);
      const hasExecutionDetails = block.kind === "steps-cluster"
        ? shouldFoldStepGroups(block.stepGroups)
        : shouldFoldStepGroups([
            ...(block.leadingStepGroups ?? []),
            ...block.groups.flatMap((group) =>
              group.kind === "steps"
                ? [{ id: group.id, parts: group.parts, mode: group.mode }]
                : [],
            ),
          ]);
      if (hasExecutionDetails) turnsWithExecutionDetails.add(turnId);
    });

    transcriptTurns.forEach((turn) => {
      const blockKeys = blockKeysByTurnId.get(turn.id);
      const turnContent = turnContentByTurnId.get(turn.id) ?? null;
      const turnContentAnchorBlockKey = turnContent
        ? blockKeys?.find((blockKey) => {
            const block = messageBlocks.find(
              (candidate) => blockIdentityKey(candidate) === blockKey,
            );
            if (!block || block.kind === "divider") return false;
            return messageIdsForBlock(block).includes(turnContent.anchorMessageId);
          })
        : undefined;
      const actionBlockKey = turnContentAnchorBlockKey ?? blockKeys?.at(-1);
      if (!blockKeys || !actionBlockKey) return;
      const presentation = summarizeTranscriptTurn(turn, messageToText);
      blockKeys.forEach((blockKey) => {
        presentations.set(blockKey, {
          ...presentation,
          copyText: turnContent?.finalText ?? presentation.copyText,
          isFirstAssistantBlock: turnContentAnchorBlockKey
            ? blockKey === turnContentAnchorBlockKey
            : firstAssistantBlockKeys.has(blockKey),
          isActionBlock: blockKey === actionBlockKey,
          hasExecutionDetails: turnContent
            ? turnContent.processItems.length > 0
            : turnsWithExecutionDetails.has(turn.id),
          turnContent,
          isTurnContentAnchor: turnContentAnchorBlockKey === blockKey,
          isHiddenByTurnContent: Boolean(
            turnContentAnchorBlockKey && blockKey !== turnContentAnchorBlockKey,
          ),
        });
      });
    });
    return presentations;
  }, [isNestedVariant, messageBlocks, renderItems, transcriptTurns, turnContentByTurnId]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const message = props.messages[index];
      if (message?.role === "assistant") {
        return message.id;
      }
    }
    return "";
  }, [props.messages]);

  const turnOpenTargetsByTurnId = useMemo(() => {
    const targets = new Map<string, OpenTarget[]>();
    transcriptTurns.forEach((turn) => {
      targets.set(
        turn.id,
        selectTurnOpenTargets(turn.assistantMessages, props.openTargets),
      );
    });
    return targets;
  }, [props.openTargets, transcriptTurns]);
  const verifiedMarkdownCodePaths = useMemo<MarkdownVerifiedCodePath[]>(() => (
    (props.openTargets ?? [])
      .filter((target) => target.kind === "file" && target.exists === true)
      .map((target) => ({
        path: target.value.replace(/[\\]+/g, "/").replace(/^\.\//, ""),
        resolvedPath: target.value,
      }))
  ), [props.openTargets]);
  const verifiedOpenTargetByPath = useMemo(() => new Map(
    (props.openTargets ?? [])
      .filter((target) => target.kind === "file" && target.exists === true)
      .map((target) => [target.value, target]),
  ), [props.openTargets]);
  const onOpenMarkdownCodePath = useCallback((path: string) => {
    const target = verifiedOpenTargetByPath.get(path);
    if (target) props.onOpenTarget?.(target);
  }, [props.onOpenTarget, verifiedOpenTargetByPath]);

  const blockIndexByMessageId = useMemo(() => {
    const next = new Map<string, number>();
    renderItems.forEach((item, index) => {
      if (item.kind === "divider") return;
      item.blocks.forEach((block) => {
        messageIdsForBlock(block).forEach((messageId) => {
          if (messageId) next.set(messageId, index);
        });
      });
    });
    return next;
  }, [renderItems]);
  const blockIndexByKey = useMemo(() => {
    const next = new Map<string, number>();
    messageBlocks.forEach((block, index) => next.set(blockIdentityKey(block), index));
    return next;
  }, [messageBlocks]);
  const activeTurn = transcriptTurns.at(-1);
  const activeTurnHasAssistantBlock = Boolean(
    activeTurn && renderItems.some((item) => (
      item.kind === "turn" &&
      item.turnId === activeTurn.id &&
      item.blocks.some((block) => block.kind !== "divider" && !block.isUser)
    )),
  );
  const footerNeedsAssistantIdentity = Boolean(
    props.footer &&
    props.assistantAvatar &&
    activeTurn &&
    !activeTurnHasAssistantBlock,
  );
  const activeTurnId = activeTurn && (
    activeTurn.state === "streaming" || activeTurn.state === "awaiting-approval"
  ) ? activeTurn.id : null;
  const activeRenderItemId = activeTurnId
    ? renderItems.findLast((item) => item.kind === "turn" && item.turnId === activeTurnId)?.id ?? null
    : null;
  const footerRenderItemId = activeRenderItemId ?? renderItems.at(-1)?.id ?? null;
  const activeTurnMinHeight = Math.max(0, rootViewportHeight - 40);

  // Virtualize by turn once either the turn count or the underlying block
  // count is large. Do NOT gate on whether
  // the scrollElement ref has already attached — that's false on the first
  // render of a session, which used to make us render every message
  // eagerly (freezing the UI on large sessions) for one tick before
  // switching to virtualization.
  const shouldVirtualize =
    renderItems.length >= VIRTUALIZATION_THRESHOLD ||
    messageBlocks.length >= VIRTUALIZATION_THRESHOLD;
  // Keep the newest turn in normal document flow even after streaming ends.
  // Re-inserting a just-grown row into the virtualizer on completion causes a
  // visible measurement correction before sticky-bottom catches up.
  const detachedTailRenderItemIndex = shouldVirtualize ? renderItems.length - 1 : -1;
  const detachedTailRenderItem = detachedTailRenderItemIndex >= 0
    ? renderItems[detachedTailRenderItemIndex]
    : null;
  const virtualRenderItems = detachedTailRenderItem
    ? renderItems.slice(0, detachedTailRenderItemIndex)
    : renderItems;

  const estimateVirtualItemSize = useCallback(
    (index: number) => {
      const item = virtualRenderItems[index];
      const estimate = estimateRenderItemSize(item);
      return item?.id === activeRenderItemId
        ? Math.max(estimate, activeTurnMinHeight)
        : estimate;
    },
    [activeRenderItemId, activeTurnMinHeight, virtualRenderItems],
  );

  const getVirtualItemKey = useCallback((index: number) => {
    return virtualRenderItems[index]?.id ?? `item-${index}`;
  }, [virtualRenderItems]);

  const virtualizer = useVirtualizer({
    count: virtualRenderItems.length,
    getScrollElement: () => props.scrollElement?.() ?? null,
    // TanStack recommends estimating the largest comfortable dynamic size.
    // Content-aware estimates reduce the measurement corrections that cause
    // long transcripts to jitter as previously-unmeasured rows enter view.
    estimateSize: estimateVirtualItemSize,
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: getVirtualItemKey,
  });
  const virtualRows = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const firstVirtualRow = virtualRows[0];

  useEffect(() => {
    const register = props.setScrollToMessageById;
    if (!register) return;

    register((messageId, behavior = "smooth") => {
      const index = blockIndexByMessageId.get(messageId);
      if (index === undefined) return false;

      if (shouldVirtualize) {
        if (index < virtualRenderItems.length) {
          virtualizer.scrollToIndex(index, { align: "center" });
        }
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const container = props.scrollElement?.();
            if (!container) return;
            const escapedId = messageId.replace(/"/g, '\\"');
            const target = container.querySelector(
              `[data-message-id="${escapedId}"]`,
            );
            if (target instanceof HTMLElement) {
              target.scrollIntoView({ behavior, block: "center" });
            }
          });
        });
        return true;
      }

      const container = props.scrollElement?.();
      if (!container) return false;
      const escapedId = messageId.replace(/"/g, '\\"');
      const target = container.querySelector(`[data-message-id="${escapedId}"]`) as HTMLElement | null;
      if (!target) return false;
      target.scrollIntoView({ behavior, block: "center" });
      return true;
    });

    return () => {
      register(null);
    };
  }, [blockIndexByMessageId, props.scrollElement, props.setScrollToMessageById, shouldVirtualize, virtualizer, virtualRenderItems.length]);

  // NOTE: we intentionally do NOT call virtualizer.measure() on every
  // messageBlocks change. react-virtual already invalidates and
  // re-measures rows whose refs remount or whose content changes. Calling
  // measure() explicitly on each streaming token forces a synchronous
  // getBoundingClientRect() pass over every measured row, which made
  // streaming into large sessions feel like the UI was frozen.

  // Apply content-visibility earlier too. Even when the transcript is below
  // the virtualization threshold, hiding distant blocks from layout/paint
  // work reduces the chance that one large session makes the UI feel frozen.
  const shouldUseContentVisibility = !shouldVirtualize && messageBlocks.length > 24;

  const transcriptStyle = isNestedVariant
    ? MESSAGE_LIST_CONTAIN_STYLE
    : {
        ...MESSAGE_LIST_CONTAIN_STYLE,
        maxWidth: `${rootContentWidth}px`,
      } satisfies CSSProperties;
  const renderConversationBlock = (block: MessageBlockItem) => {
    const blockKey = blockIdentityKey(block);
    if (block.kind === "divider") {
      return (
        <TranscriptDividerRow
          key={blockKey}
          label={block.label}
          variant={block.variant}
        />
      );
    }
    const blockIndex = blockIndexByKey.get(blockKey);
    if (blockIndex === undefined) return null;
    const turnPresentation = turnPresentationByBlockKey.get(blockKey);
    if (turnPresentation?.isHiddenByTurnContent) return null;
    return (
      <MessageBlockRow
        key={blockKey}
        block={block}
        blockIndex={blockIndex}
        totalBlocks={messageBlocks.length}
        isNestedVariant={isNestedVariant}
        shouldUseContentVisibility={shouldUseContentVisibility}
        expandedStepIds={expandedStepIds}
        onExpandedStepIdsChange={onExpandedStepIdsChange}
        searchMatchMessageIds={props.searchMatchMessageIds}
        activeSearchMessageId={props.activeSearchMessageId}
        searchHighlightQuery={props.searchHighlightQuery}
        isStreaming={props.isStreaming}
        latestAssistantMessageId={latestAssistantMessageId}
        onRevertToMessage={props.onRevertToMessage}
        onForkAtMessage={props.onForkAtMessage}
        turnOpenTargets={turnPresentation
          ? turnOpenTargetsByTurnId.get(turnPresentation.turnId)
          : undefined}
        verifiedCodePaths={verifiedMarkdownCodePaths}
        onOpenCodePath={onOpenMarkdownCodePath}
        onOpenTarget={props.onOpenTarget}
        assistantAvatar={props.assistantAvatar}
        showAssistantIdentity={turnPresentation?.isFirstAssistantBlock === true}
        turnPresentation={turnPresentation}
        turnDetailsExpanded={turnPresentation ? expandedTurnIds.has(turnPresentation.turnId) : false}
        onTurnDetailsExpandedChange={onTurnDetailsExpandedChange}
      />
    );
  };
  const renderTranscriptItem = (item: TranscriptRenderItem<MessageBlockItem>) => {
    if (item.kind === "divider") {
      return item.block.kind === "divider"
        ? (
            <TranscriptDividerRow
              label={item.block.label}
              variant={item.block.variant}
            />
          )
        : null;
    }
    const isActiveTurn = item.id === activeRenderItemId;
    const isInitialAssistantOnly = item.id === firstAssistantRenderItemId && !item.blocks.some(
      (block) => block.kind !== "divider" && block.isUser,
    );
    return (
      <div
        className={cn(
          "session-transcript-turn",
          isInitialAssistantOnly && "session-transcript-turn-assistant-only",
        )}
        data-transcript-turn-id={item.turnId ?? undefined}
        data-transcript-turn-active={isActiveTurn ? "true" : undefined}
        data-transcript-turn-assistant-only={isInitialAssistantOnly ? "true" : undefined}
        style={isActiveTurn && !isNestedVariant
          ? { minHeight: `${activeTurnMinHeight}px` }
          : undefined}
      >
        {item.blocks.map(renderConversationBlock)}
        {!isNestedVariant && props.footer && item.id === footerRenderItemId ? (
          <div className="session-transcript-assistant-row">
            {footerNeedsAssistantIdentity ? (
              <TranscriptAssistantHeader
                assistantAvatar={props.assistantAvatar}
                showAssistantAvatar
                detailsExpanded={false}
                onDetailsExpandedChange={() => undefined}
              />
            ) : null}
            {props.footer}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className={cn("pb-0", !isNestedVariant && "session-transcript-root mx-auto w-full")}
      style={transcriptStyle}
    >
      {shouldVirtualize ? (
        // Always render the virtualized container once we've decided to
        // virtualize — even if virtualRows is empty on the very first tick
        // (e.g. scrollElement ref hasn't attached yet). A fallback to
        // rendering every message would re-introduce the eager-render
        // freeze on huge sessions.
        <>
          <div
            className="relative"
            style={{
            height: `${Math.max(virtualizer.getTotalSize(), 1)}px`,
            width: "100%",
          }}
        >
          {firstVirtualRow ? (
            <div
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${firstVirtualRow.start}px)`,
              }}
            >
              {virtualRows.map((virtualRow) => {
                const item = virtualRenderItems[virtualRow.index];
                if (!item) return null;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="w-full"
                  >
                    {renderTranscriptItem(item)}
                  </div>
                );
              })}
            </div>
          ) : null}
          </div>
          {detachedTailRenderItem
            ? renderTranscriptItem(detachedTailRenderItem)
            : null}
        </>
      ) : (
        <div>
          {renderItems.map((item) => (
            <div key={item.id}>{renderTranscriptItem(item)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Memoize at the transcript boundary so SessionSurface state churn (e.g.
 * sending=true flipping while the assistant streams) doesn't force a full
 * transcript re-render on every parent commit. Re-renders now happen only
 * when the transcript's own props actually change (messages array
 * identity, isStreaming, developerMode, etc.).
 */
export const SessionTranscript = memo(SessionTranscriptInner);
SessionTranscript.displayName = "SessionTranscript";
