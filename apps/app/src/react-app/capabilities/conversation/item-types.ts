/** Runtime-agnostic conversation item view-models. */

export type ConversationItemKind =
  | "user_text"
  | "assistant_text"
  | "tool"
  | "thinking"
  | "plan"
  | "approval"
  | "error"
  | "system"
  | "tips";

export type ConversationItemVM = {
  id: string;
  kind: ConversationItemKind;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt: number;
  status?: string | null;
  /** Optional raw fields for host-specific UI. */
  meta?: Record<string, unknown>;
};
