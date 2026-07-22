import type { Part } from "@opencode-ai/sdk/v2/client";
import type { UIMessage } from "ai";
import type { MessageGroup, StepGroupMode } from "../../../../../app/types";
import type { TranscriptTurnPresentation } from "../transcript/turn-presentation";
import type { TurnContentPresentation } from "../transcript/turn-content";

export type TranscriptPart = Part;

export type TranscriptMessage = {
  id: string;
  role: UIMessage["role"];
  source: UIMessage;
  parts: TranscriptPart[];
};

export type StepTimelineGroup = {
  id: string;
  parts: TranscriptPart[];
  mode: StepGroupMode;
};

export type StepClusterBlock = {
  kind: "steps-cluster";
  id: string;
  stepGroups: StepTimelineGroup[];
  messageIds: string[];
  isUser: boolean;
};

export type SessionTranscriptDividerVariant =
  | "cancelled"
  | "stopped"
  | "compacting"
  | "compacted"
  | "stalled"
  | "permission-rejected"
  | "permission-auto-approved";

export type SessionTranscriptDivider = {
  id: string;
  label: string;
  variant?: SessionTranscriptDividerVariant;
  afterMessageCount: number;
};

export type DividerBlock = {
  kind: "divider";
  id: string;
  label: string;
  variant?: SessionTranscriptDividerVariant;
  afterMessageCount: number;
  isUser: false;
};

export type MessageBlock = {
  kind: "message";
  message: UIMessage;
  renderableParts: TranscriptPart[];
  leadingStepGroups?: StepTimelineGroup[];
  leadingStepMessageIds?: string[];
  attachments: Array<{
    url: string;
    filename: string;
    mime: string;
    relativePath?: string;
  }>;
  groups: MessageGroup[];
  isUser: boolean;
  messageId: string;
};

export type MessageBlockItem = MessageBlock | StepClusterBlock | DividerBlock;
export type ConversationBlockItem = MessageBlock | StepClusterBlock;
export type TranscriptBlockTurnPresentation = TranscriptTurnPresentation & {
  isFirstAssistantBlock: boolean;
  isActionBlock: boolean;
  hasExecutionDetails: boolean;
  turnContent: TurnContentPresentation | null;
  isTurnContentAnchor: boolean;
  isHiddenByTurnContent: boolean;
};
