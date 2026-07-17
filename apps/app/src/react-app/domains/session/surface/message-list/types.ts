/** Message-list local types — shared view-models live in capabilities/conversation. */
import type { ReactNode } from "react";
import type { UIMessage } from "ai";

import type {
  ConversationBlockItem,
  SessionTranscriptDivider,
} from "@/react-app/capabilities/conversation";
import type { OpenTarget } from "../../artifacts/open-target";
import type { TranscriptTurnPresentation } from "../transcript/turn-presentation";
import type { TurnContentPresentation } from "../transcript/turn-content";
import type { MarkdownVerifiedCodePath } from "../markdown";

export type {
  ConversationBlockItem,
  DividerBlock,
  MessageBlock,
  MessageBlockItem,
  SessionTranscriptDivider,
  SessionTranscriptDividerVariant,
  StepClusterBlock,
  StepClusterSummary,
  StepTimelineGroup,
  TranscriptFeedbackValue,
  TranscriptMessage,
  TranscriptPart,
} from "@/react-app/capabilities/conversation";

export type TranscriptBlockTurnPresentation = TranscriptTurnPresentation & {
  isFirstAssistantBlock: boolean;
  isActionBlock: boolean;
  hasExecutionDetails: boolean;
  turnContent: TurnContentPresentation | null;
  isTurnContentAnchor: boolean;
  isHiddenByTurnContent: boolean;
};

export type SessionTranscriptProps = {
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

export type MessageBlockRowProps = {
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
};
