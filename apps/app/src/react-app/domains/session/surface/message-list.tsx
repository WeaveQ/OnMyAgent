/** @jsxImportSource react */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  Globe,
  Search,
  Terminal,
} from "lucide-react";

import { openDesktopPath, revealDesktopItemInDir } from "../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { DisclosureRowButton, MenuRowButton } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX,
  type MessageGroup,
  type StepGroupMode,
} from "../../../../app/types";
import { groupMessageParts, isDesktopRuntime, summarizeStep } from "../../../../app/utils";
import { DEFAULT_SHOW_THINKING } from "../../../kernel/local-provider";
import { MarkdownBlock } from "./markdown";
import { applyTextHighlights } from "./text-highlights";
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
  bodyMuted: "font-sans text-sm leading-6 text-muted-foreground antialiased",
  toolStatus: "ml-7 mt-2 text-sm leading-6 text-muted-foreground",
  toolLabel: "mb-1 text-xs font-medium text-muted-foreground",
  assistantBubble: "w-full relative max-w-[760px] text-sm leading-6 text-foreground group",
  nestedAssistantBubble: "w-full relative text-sm leading-6 text-foreground group",
  avatarLabel: "max-w-[120px] truncate text-sm font-medium leading-tight text-dls-text",
  baseMessageBubble: "text-sm text-foreground leading-relaxed",
  userMessageBubble: "bg-dls-chat-user-bg text-dls-text",
  nestedUserMessageBubble: "max-w-[92%] rounded-xl px-3.5 py-2",
  rootUserMessageBubble: "max-w-[82%] rounded-xl px-4 py-2.5",
  assistantMessageBubble: "w-full antialiased group",
  rootAssistantMessageBubble: "max-w-[720px]",
};

const messageStateClass = {
  skillReferenceChip: "inline-flex items-center gap-1 rounded-full border border-dls-accent/30 bg-dls-accent/10 px-2 py-0.5 font-mono text-xs font-medium text-dls-accent",
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
        className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full"
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
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium"
      style={{ background: palette.background, color: palette.foreground }}
    >
      {props.name.slice(0, 1) || t("session.agent_initial")}
    </div>
  );
}

function UserAvatar(props: { name: string }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-dls-accent text-sm font-medium text-white">
      {props.name.slice(0, 1) || t("session.user_initial")}
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

export type SessionTranscriptDivider = {
  id: string;
  label: string;
  afterMessageCount: number;
};

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
   * When set, renders this identity (avatar + name) on the leading edge of
   * every assistant message block. Used when the session was started from a
   * custom agent card so the user can see the agent identity in the chat.
   */
  assistantAvatar?: { name: string; avatarUrl: string | null; avatarBackground?: string | null };
  userIdentity?: { name: string };

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
    const state: Record<string, unknown> = {
      input: toolPart.input,
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

function cleanReasoningPreview(value: string) {
  const cleaned = value
    .replace(/\[REDACTED\]/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+\n/g, "\n")
    .trim();

  return cleaned
    .replace(/^(?:thinking|reasoning)\s*(?::|-|–|—)\s*/i, "")
    .replace(/^(?:thinking|reasoning)\s*\r?\n+/i, "")
    .trim();
}

function splitReasoningPreview(value: string) {
  const clean = cleanReasoningPreview(value);
  if (!clean) return { headline: "", body: "" };
  const lines = clean.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
  if (lines.length <= 1) return { headline: "", body: clean };
  return { headline: lines[0] ?? "", body: lines.slice(1).join("\n") };
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

function isRecordStringUnknown(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasStructuredValue(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecordStringUnknown(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function ToolActivityIcon(props: { category?: string }) {
  const className = "size-4 shrink-0 text-muted-foreground";
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
  if (normalized.includes("running") || normalized.includes("progress")) return "In progress";
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
  const counts = {
    read: 0,
    edit: 0,
    terminal: 0,
    search: 0,
    other: 0,
  };
  let editing = false;
  let processing = false;

  for (const group of stepGroups) {
    for (const part of group.parts) {
      const summary = summarizeStep(part);
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
  return summarizeStepCluster(previous.stepGroups).category === summarizeStepCluster(next.stepGroups).category;
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
      size="icon-sm"
      title={t("session.copy_message")}
      aria-label={t("session.copy_message")}
      onClick={async () => {
        await navigator.clipboard.writeText(props.getText());
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
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
        className="whitespace-pre-wrap wrap-break-word text-foreground"
        highlightQuery={props.highlightQuery}
      />
    );
  }

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-pre-wrap wrap-break-word text-foreground">
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
  const title = props.part.filename || (isDataUrl ? "Attached file" : props.part.url) || "File";
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
            props.tone === "user" ? "bg-dls-surface-muted text-foreground" : "bg-dls-surface-muted text-muted-foreground",
          )}
        >
          <FileIcon size={20} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-snug text-foreground">{title}</div>
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
            className="text-muted-foreground opacity-0 hover:bg-dls-surface-muted hover:text-foreground group-hover:opacity-100"
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
                  className="gap-2.5 py-2 text-foreground hover:bg-dls-surface-muted"
                  onClick={() => {
                    void openFileWithOS(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.open_with_default_app")}
                </MenuRowButton>
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-foreground hover:bg-dls-surface-muted"
                  onClick={() => {
                    void revealFileInFinder(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.reveal_in_finder")}
                </MenuRowButton>
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-foreground hover:bg-dls-surface-muted"
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

function StepRow(props: {
  id: string;
  part: TranscriptPart;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = useMemo(() => summarizeStep(props.part), [props.part]);
  const toolState = useMemo<Record<string, unknown>>(() => {
    if (props.part.type !== "tool") return {};
    if (!isRecordStringUnknown(props.part)) return {};
    const state = props.part.state;
    return isRecordStringUnknown(state) ? state : {};
  }, [props.part]);
  const toolInput = isRecordStringUnknown(toolState.input) ? toolState.input : undefined;
  const toolOutput = toolState.output;
  const toolError = typeof toolState.error === "string" ? toolState.error : null;
  const expandable =
    props.part.type === "tool" &&
    (hasStructuredValue(toolInput) || hasStructuredValue(toolOutput) || Boolean(toolError));
  const headline = summary.title?.trim() || "Step updates progress";
  const statusText = toolStatusText(summary.status);

  if (props.part.type === "reasoning" && isRecordStringUnknown(props.part)) {
    const raw = typeof props.part.text === "string" ? props.part.text : "";
    const preview = splitReasoningPreview(raw);
    if (!preview.headline && !preview.body) return null;

    return (
      <div
        data-reasoning="true"
        className={`whitespace-pre-wrap ${messageTextClass.bodyMuted}`}
      >
        <div className="max-w-[760px]">
          {preview.headline ? <div className="mb-2 text-muted-foreground">{preview.headline}</div> : null}
          <div>{preview.body || headline}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={messageTextClass.body}>
      <DisclosureRowButton
        type="button"
        density="flush"
        className="text-muted-foreground hover:bg-transparent hover:text-foreground disabled:cursor-default"
        aria-expanded={expandable ? props.expanded : undefined}
        disabled={!expandable}
        onClick={() => {
          if (!expandable) return;
          props.onToggle();
        }}
      >
        <span className="inline-flex max-w-[760px] items-center gap-3">
          <ToolActivityIcon category={summary.toolCategory} />
          <span className="min-w-0 wrap-break-word">{headline}</span>
          {expandable ? (
            <ChevronDown
              size={14}
              className={cn(
                "shrink-0 text-muted-foreground transition-transform",
                !props.expanded && "-rotate-90",
              )}
            />
          ) : null}
        </span>
      </DisclosureRowButton>
      {statusText ? <div className={messageTextClass.toolStatus}>{statusText}</div> : null}
      {props.expanded ? (
        <div className="mt-3 ml-7 space-y-3">
          {hasStructuredValue(toolInput) ? (
            <div>
              <div className={messageTextClass.toolLabel}>Request</div>
              <pre className="overflow-x-auto rounded-xl border border-dls-mist bg-dls-surface px-4 py-3 text-xs leading-6 text-muted-foreground">
                {formatStructuredValue(toolInput)}
              </pre>
            </div>
          ) : null}
          {hasStructuredValue(toolOutput) ? (
            <div>
              <div className={messageTextClass.toolLabel}>Result</div>
              <pre className="overflow-x-auto rounded-xl border border-dls-mist bg-dls-surface px-4 py-3 text-xs leading-6 text-muted-foreground">
                {formatStructuredValue(toolOutput)}
              </pre>
            </div>
          ) : null}
          {toolError ? (
            <div>
              <div className={messageTextClass.toolLabel}>Error</div>
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

function StepsContainer(props: {
  stepGroups: StepTimelineGroup[];
  isUser: boolean;
  isInline?: boolean;
  isNestedVariant: boolean;
  isActive: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
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
  const [containerExpanded, setContainerExpanded] = useState(props.isActive);
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

  return (
    <div className="max-w-[760px] rounded-xl border border-dls-mist bg-dls-surface-muted">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-dls-secondary transition-colors hover:bg-dls-surface-muted hover:text-dls-text"
        aria-expanded={containerExpanded}
        onClick={() => setContainerExpanded((value) => !value)}
      >
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            !containerExpanded && "-rotate-90",
          )}
        />
        <ToolActivityIcon category={clusterSummary.category} />
        <span className="font-medium text-dls-text">{clusterSummary.label}</span>
        {props.isActive ? (
          <StatusBadge tone="accent" size="tiny">
            {t("session.status_running")}
          </StatusBadge>
        ) : null}
      </button>
      {!containerExpanded && previewItems.length > 0 ? (
        <div className="border-t border-dls-mist px-3 py-2 text-xs leading-5 text-dls-secondary">
          {previewItems.map((item) => (
            <div key={item} className="truncate">
              {item}
            </div>
          ))}
        </div>
      ) : null}
      {containerExpanded ? (
        <div
          data-scrollable={!props.isNestedVariant ? "true" : undefined}
          className={cn(
            "border-t border-dls-mist px-3 py-3",
            !props.isNestedVariant && "max-h-[520px] overflow-y-auto pr-3",
          )}
        >
          <div className="flex flex-col gap-5">
            {props.stepGroups.map((group) => (
              <div key={group.id} className="flex flex-col gap-5">
                {group.parts.map((part, index) => {
                  const rowId = `${group.id}:${index}`;
                  return (
                    <StepRow
                      key={rowId}
                      id={rowId}
                      part={part}
                      expanded={props.expandedStepIds.has(rowId)}
                      onToggle={() => toggleSteps(rowId)}
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

function inlineOpenTargetsForMessage(message: UIMessage, verifiedTargets: OpenTarget[] | undefined) {
  const verifiedById = new Map((verifiedTargets ?? []).map((target) => [target.id, target] as const));
  const inlineTargets = new Map<string, OpenTarget>();
  for (const candidate of deriveOpenTargets([message], { includeFileMentions: true })) {
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
    return <Globe size={12} className="shrink-0 text-muted-foreground" />;
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
      <StatusBadge size="fileType" className="border border-primary/25 bg-primary/10 text-primary">
        MD
      </StatusBadge>
    );
  }

  return <FileIcon size={12} className="shrink-0 text-primary" />;
}

function OpenableTargetsStrip(props: { targets: OpenTarget[]; onOpenTarget: (target: OpenTarget) => void }) {
  if (!props.targets.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs leading-none">
      <span className="mr-0.5 text-muted-foreground">Openable items</span>
      {props.targets.map((target) => (
          <Button
            key={target.id}
            type="button"
            variant="outline"
            size="xs"
            className="max-w-[220px] rounded-lg text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
            title={target.value}
            onClick={() => props.onOpenTarget(target)}
          >
            <OpenTargetIcon target={target} />
            <span className="truncate">{target.name || target.value}</span>
            <span className="text-muted-foreground">{target.kind === "url" ? "Open browser" : "Open artifact"}</span>
          </Button>
        ))}
    </div>
  );
}

function TranscriptDividerRow(props: { label: string }) {
  return (
    <div className="mx-auto flex max-w-[760px] items-center justify-center gap-3 px-3 py-3 text-xs text-dls-secondary sm:px-5">
      <div className="h-px min-w-10 flex-1 bg-dls-mist" />
      <span className="shrink-0">{props.label}</span>
      <div className="h-px min-w-10 flex-1 bg-dls-mist" />
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
  openTargets?: OpenTarget[];
  onOpenTarget?: (target: OpenTarget) => void;
  assistantAvatar?: { name: string; avatarUrl: string | null; avatarBackground?: string | null };
  userIdentity?: { name: string };

}) {
  const block = props.block;
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

  if (block.kind === "steps-cluster") {
    const assistantAvatar = props.assistantAvatar;
    const showAssistantAvatar =
      !block.isUser && assistantAvatar && !props.isNestedVariant;
    return (
      <div
        className={cn(
          "flex group justify-start pb-4",
          block.isUser && "justify-end",
          showAssistantAvatar && "flex-col items-start gap-2",
        )}
        data-message-role={block.isUser ? "user" : "assistant"}
        data-message-id={block.messageIds[0] ?? ""}
        style={blockStyle}
      >
        {showAssistantAvatar && assistantAvatar ? (
          <div className="flex items-center gap-2">
            <AssistantAvatar
              name={assistantAvatar.name}
              avatarUrl={assistantAvatar.avatarUrl}
              avatarBackground={assistantAvatar.avatarBackground}
            />
            <span className={messageTextClass.avatarLabel}>
              {assistantAvatar.name}
            </span>
          </div>
        ) : null}
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
            expandedStepIds={props.expandedStepIds}
            onExpandedStepIdsChange={props.onExpandedStepIdsChange}
          />
        </div>
      </div>
    );
  }

  const groupSpacing = block.isUser ? "mb-3" : "mb-4";
  const isSyntheticSessionError =
    !block.isUser && block.messageId.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX);
  const inlineOpenTargets = block.kind === "message" && !block.isUser && props.onOpenTarget
    ? inlineOpenTargetsForMessage(block.message, props.openTargets)
    : [];

  if (isSyntheticSessionError) {
    const messageText = block.renderableParts
      .map((part) => partToText(part))
      .join(" ")
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    return (
      <div
        className="flex group justify-start pb-4"
        data-message-role="assistant"
        data-message-id={block.messageId}
        style={blockStyle}
      >
        <div className={cn("w-full relative", !props.isNestedVariant && "max-w-[650px]", searchOutlineClass)}>
          <NoticeBox className="inline-flex max-w-full items-start gap-2 text-sm leading-5" role="alert" tone="error">
            <CircleAlert size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0 wrap-break-word">{messageText}</div>
          </NoticeBox>
        </div>
      </div>
    );
  }

  const assistantAvatar = props.assistantAvatar;
  const showAssistantAvatar =
    !block.isUser && assistantAvatar && !props.isNestedVariant;
  const showUserIdentity =
    block.isUser && props.userIdentity && !props.isNestedVariant;

  return (
    <div
      className={cn(
        "flex group justify-start relative pb-4",
        block.isUser && "justify-end",
        !props.isNestedVariant && "pb-8",
        showAssistantAvatar && "flex-col items-start gap-2",
        showUserIdentity && "flex-col items-end gap-2",
      )}
      data-message-role={block.isUser ? "user" : "assistant"}
      data-message-id={block.messageId}
      style={blockStyle}
    >
      {showAssistantAvatar && assistantAvatar ? (
        <div className="flex items-center gap-2">
          <AssistantAvatar
            name={assistantAvatar.name}
            avatarUrl={assistantAvatar.avatarUrl}
            avatarBackground={assistantAvatar.avatarBackground}
          />
          <span className={messageTextClass.avatarLabel}>
            {assistantAvatar.name}
          </span>
        </div>
      ) : null}
      {showUserIdentity && props.userIdentity ? (
        <div className="flex max-w-[52%] items-center justify-end gap-2">
          <span className={messageTextClass.avatarLabel}>
            {props.userIdentity.name}
          </span>
          <UserAvatar name={props.userIdentity.name} />
        </div>
      ) : null}
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
              expandedStepIds={props.expandedStepIds}
              onExpandedStepIdsChange={props.onExpandedStepIdsChange}
            />
          </div>
        ) : null}

        {block.attachments.length > 0 ? (
          <div className={cn("flex flex-wrap gap-2", block.isUser ? "mb-3" : "mb-4")}>
            {block.attachments.map((attachment) => (
              <FileCard
                key={`${block.messageId}:${attachment.url}`}
                part={{
                  filename: attachment.filename,
                  url: attachment.url,
                  mediaType: attachment.mime,
                }}
                tone={block.isUser ? "user" : "assistant"}
              />
            ))}
          </div>
        ) : null}

        {block.groups.map((group) => {
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
                  return (
                    <FileCard
                      part={{
                        filename: filePart.filename,
                        url: filePart.url ?? "",
                        mediaType: filePart.mime ?? "application/octet-stream",
                      }}
                      tone={block.isUser ? "user" : "assistant"}
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
                    highlightQuery={highlightQuery}
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
                  expandedStepIds={props.expandedStepIds}
                  onExpandedStepIdsChange={props.onExpandedStepIdsChange}
                />
              ) : null}
            </div>
          );
        })}

        {props.onOpenTarget ? <OpenableTargetsStrip targets={inlineOpenTargets} onOpenTarget={props.onOpenTarget} /> : null}

        {!props.isNestedVariant ? (
          <div
            className={cn(
              "absolute bottom-2 flex items-center gap-0.5 opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto md:group-focus-within:opacity-100 md:group-focus-within:pointer-events-auto transition-opacity select-none",
              block.isUser ? "right-0" : "left-0",
            )}
          >
            <CopyButton getText={() => messageToText(block.message)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SessionTranscriptInner(props: SessionTranscriptProps) {
  const showThinking = props.showThinking ?? DEFAULT_SHOW_THINKING;
  const isNestedVariant = props.variant === "nested";
  const [internalExpandedStepIds, setInternalExpandedStepIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expandedStepIds = props.expandedStepIds ?? internalExpandedStepIds;
  const onExpandedStepIdsChange =
    props.onExpandedStepIdsChange ??
    ((updater: (current: Set<string>) => Set<string>) => {
      setInternalExpandedStepIds((current) => updater(current));
    });

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
        dividers[nextDividerIndex]?.afterMessageCount === afterMessageCount
      ) {
        const divider = dividers[nextDividerIndex];
        if (divider) {
          blocks.push({
            kind: "divider",
            id: divider.id,
            label: divider.label,
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
        ? groups.filter((group): group is { kind: "steps"; id: string; parts: TranscriptPart[]; segment: "execution"; mode: StepGroupMode } => group.kind === "steps").map((group) => ({
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

  const latestAssistantMessageId = useMemo(() => {
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const message = props.messages[index];
      if (message?.role === "assistant") {
        return message.id;
      }
    }
    return "";
  }, [props.messages]);

  const blockIndexByMessageId = useMemo(() => {
    const next = new Map<string, number>();
    messageBlocks.forEach((block, index) => {
      if (block.kind === "steps-cluster") {
        block.messageIds.forEach((id) => {
          if (id) next.set(id, index);
        });
        return;
      }
      if (block.kind === "divider") return;

      if (block.messageId) {
        next.set(block.messageId, index);
      }
    });
    return next;
  }, [messageBlocks]);

  // Decide to virtualize based only on block count. Do NOT gate on whether
  // the scrollElement ref has already attached — that's false on the first
  // render of a session, which used to make us render every message
  // eagerly (freezing the UI on large sessions) for one tick before
  // switching to virtualization.
  const shouldVirtualize = messageBlocks.length >= VIRTUALIZATION_THRESHOLD;

  const estimateVirtualItemSize = useCallback(
    (index: number) => estimateBlockSize(messageBlocks[index]),
    [messageBlocks],
  );

  const getVirtualItemKey = useCallback((index: number) => {
    const block = messageBlocks[index];
    if (!block) return `block-${index}`;
    if (block.kind === "steps-cluster") {
      return `steps-${block.messageIds.join(",")}`;
    }
    if (block.kind === "divider") {
      return `divider-${block.id}`;
    }
    return `message-${block.messageId}`;
  }, [messageBlocks]);

  const virtualizer = useVirtualizer({
    count: messageBlocks.length,
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
        virtualizer.scrollToIndex(index, { align: "center" });
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
  }, [blockIndexByMessageId, props.scrollElement, props.setScrollToMessageById, shouldVirtualize, virtualizer]);

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

  return (
    <div className="pb-0" style={MESSAGE_LIST_CONTAIN_STYLE}>
      {shouldVirtualize ? (
        // Always render the virtualized container once we've decided to
        // virtualize — even if virtualRows is empty on the very first tick
        // (e.g. scrollElement ref hasn't attached yet). A fallback to
        // rendering every message would re-introduce the eager-render
        // freeze on huge sessions.
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
                const block = messageBlocks[virtualRow.index];
                if (!block) return null;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="w-full"
                  >
                    {block.kind === "divider" ? (
                      <TranscriptDividerRow label={block.label} />
                    ) : (
                      <MessageBlockRow
                        block={block}
                        blockIndex={virtualRow.index}
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
                        openTargets={props.openTargets}
                        onOpenTarget={props.onOpenTarget}
                        assistantAvatar={props.assistantAvatar}
                        userIdentity={props.userIdentity}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div>
          {messageBlocks.map((block, index) => (
            block.kind === "divider" ? (
              <TranscriptDividerRow key={blockIdentityKey(block)} label={block.label} />
            ) : (
              <MessageBlockRow
                key={blockIdentityKey(block)}
                block={block}
                blockIndex={index}
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
                openTargets={props.openTargets}
                onOpenTarget={props.onOpenTarget}
                assistantAvatar={props.assistantAvatar}
                userIdentity={props.userIdentity}
              />
            )
          ))}
        </div>
      )}

      {!isNestedVariant && props.footer ? props.footer : null}
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
