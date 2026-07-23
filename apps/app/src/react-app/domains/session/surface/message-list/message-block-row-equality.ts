import type { OpenTarget } from "../../artifacts/open-target";
import type { MarkdownCodePathOpenMode, MarkdownVerifiedCodePath } from "../markdown";
import { messageIdsForBlock } from "./block-model";
import type {
  ConversationBlockItem,
  MessageBlockItem,
  TranscriptBlockTurnPresentation,
} from "./types";

/**
 * Whether this block is the live streaming tail. Non-tail rows must receive
 * `isStreaming: false` so React.memo can skip them while tokens arrive.
 */
export function blockIsActivelyStreaming(
  block: MessageBlockItem,
  isStreaming: boolean,
  latestAssistantMessageId: string,
): boolean {
  if (!isStreaming || !latestAssistantMessageId) return false;
  if (block.kind === "divider") return false;
  return messageIdsForBlock(block).includes(latestAssistantMessageId);
}

/** Props compared by MessageBlockRow's memo boundary (callbacks by identity). */
export type MessageBlockRowMemoProps = {
  block: ConversationBlockItem;
  blockIndex: number;
  totalBlocks: number;
  isNestedVariant: boolean;
  shouldUseContentVisibility: boolean;
  expandedStepIds: Set<string>;
  searchMatchMessageIds?: ReadonlySet<string>;
  activeSearchMessageId?: string | null;
  searchHighlightQuery?: string;
  isStreaming: boolean;
  latestAssistantMessageId: string;
  turnOpenTargets?: OpenTarget[];
  verifiedCodePaths?: readonly MarkdownVerifiedCodePath[];
  workspaceRoot?: string;
  assistantAvatar?: { name: string; avatarUrl: string | null; avatarBackground?: string | null };
  showAssistantIdentity: boolean;
  turnPresentation?: TranscriptBlockTurnPresentation;
  turnDetailsExpanded: boolean;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  onRevertToMessage?: (messageId: string) => void;
  onForkAtMessage?: (messageId: string) => void;
  onOpenCodePath?: (path: string, mode?: MarkdownCodePathOpenMode) => void;
  onDownloadCodePath?: (path: string) => Promise<void>;
  onOpenTarget?: (target: OpenTarget) => void;
  onTurnDetailsExpandedChange: (turnId: string, expanded: boolean) => void;
};

/**
 * Custom equality for memo(MessageBlockRow). Relies on stabilizeMessageBlocks
 * keeping `block` pointer-equal when content is unchanged.
 */
export function messageBlockRowPropsEqual(
  prev: MessageBlockRowMemoProps,
  next: MessageBlockRowMemoProps,
): boolean {
  return (
    prev.block === next.block &&
    prev.blockIndex === next.blockIndex &&
    prev.totalBlocks === next.totalBlocks &&
    prev.isNestedVariant === next.isNestedVariant &&
    prev.shouldUseContentVisibility === next.shouldUseContentVisibility &&
    prev.expandedStepIds === next.expandedStepIds &&
    prev.searchMatchMessageIds === next.searchMatchMessageIds &&
    prev.activeSearchMessageId === next.activeSearchMessageId &&
    prev.searchHighlightQuery === next.searchHighlightQuery &&
    prev.isStreaming === next.isStreaming &&
    prev.latestAssistantMessageId === next.latestAssistantMessageId &&
    prev.turnOpenTargets === next.turnOpenTargets &&
    prev.verifiedCodePaths === next.verifiedCodePaths &&
    prev.workspaceRoot === next.workspaceRoot &&
    prev.assistantAvatar === next.assistantAvatar &&
    prev.showAssistantIdentity === next.showAssistantIdentity &&
    prev.turnPresentation === next.turnPresentation &&
    prev.turnDetailsExpanded === next.turnDetailsExpanded &&
    prev.onExpandedStepIdsChange === next.onExpandedStepIdsChange &&
    prev.onRevertToMessage === next.onRevertToMessage &&
    prev.onForkAtMessage === next.onForkAtMessage &&
    prev.onOpenCodePath === next.onOpenCodePath &&
    prev.onDownloadCodePath === next.onDownloadCodePath &&
    prev.onOpenTarget === next.onOpenTarget &&
    prev.onTurnDetailsExpandedChange === next.onTurnDetailsExpandedChange
  );
}
