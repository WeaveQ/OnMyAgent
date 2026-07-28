/** Leaf composer payload types — pure assembly imports these, not the React host. */

export type LocalAgentSlashCommand = {
  name: string;
  description: string;
  source: "acp" | "builtin";
  selectionBehavior: "insert" | "execute";
  hint?: string;
  completionBehavior?: "normal" | "neutral_tip_on_empty";
  emptyTurnTipCode?: string;
  emptyTurnTipParams?: Record<string, unknown>;
};

export type LocalAgentAttachment = {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  size?: number;
  kind: "file" | "image";
  previewUrl?: string;
};

export type LocalAgentQuoteChip = {
  id: string;
  text: string;
  lines: number;
};

export type LocalAgentComposerSubmit = {
  text: string;
  attachments: LocalAgentAttachment[];
  mentions: Record<string, string>;
  quotes: LocalAgentQuoteChip[];
  unresolvedMentions: string[];
};
