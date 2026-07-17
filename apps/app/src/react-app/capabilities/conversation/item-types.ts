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
  /** Tool display name when kind is "tool". */
  toolName?: string | null;
  /** Tool lifecycle status (running / completed / failed / …). */
  toolStatus?: string | null;
  /** Thinking lifecycle status (thinking / done / completed / …). */
  thinkingStatus?: string | null;
  /** Approval request id when kind is "approval". */
  approvalId?: string | null;
  /** Optional raw fields for host-specific UI. */
  meta?: Record<string, unknown>;
};
