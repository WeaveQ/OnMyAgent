/** Shared classnames and layout contain styles for transcript rows. */
import type { CSSProperties } from "react";

export const AVATAR_PALETTES = [
  { background: "#d7ecf8", foreground: "#16324f" },
  { background: "#e1e2f0", foreground: "#42475f" },
  { background: "#ffe1c7", foreground: "#6d3b1f" },
  { background: "#cceaf5", foreground: "#174767" },
  { background: "#ddefc8", foreground: "#355a18" },
] as const;

export const messageTextClass = {
  body: "font-sans text-sm leading-6 antialiased",
  bodyMuted: "font-sans text-sm leading-6 text-dls-secondary antialiased",
  toolStatus: "ml-7 mt-2 text-sm leading-6 text-dls-secondary",
  toolLabel: "mb-1 text-xs font-medium text-dls-secondary",
  assistantBubble: "w-full relative text-dls-text group",
  nestedAssistantBubble: "w-full relative text-sm leading-6 text-dls-text group",
  avatarLabel: "max-w-[120px] truncate text-sm font-medium leading-tight text-dls-text",
  baseMessageBubble: "text-sm text-dls-text leading-relaxed",
  userMessageBubble: "bg-dls-chat-user-bg text-dls-text",
  nestedUserMessageBubble: "max-w-[92%] rounded-xl px-3.5 py-2",
  rootUserMessageBubble: "session-transcript-user-bubble",
  assistantMessageBubble: "w-full antialiased group",
  rootAssistantMessageBubble: "session-transcript-assistant-copy",
};

export const messageStateClass = {
  skillReferenceChip: "inline-flex items-center gap-1 rounded-md border border-dls-accent/30 bg-dls-accent/10 px-2 py-0.5 font-mono text-xs font-medium text-dls-accent",
  toolError: "overflow-x-auto rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft px-4 py-3 text-xs leading-6 text-dls-status-danger",
  sheetBadge: "min-w-5 border border-dls-status-success-border bg-dls-status-success-soft text-dls-status-success-fg",
  activeSearchOutline: "outline outline-2 outline-amber-8/70 outline-offset-2 rounded-xl",
  searchOutline: "outline outline-1 outline-amber-7/50 outline-offset-1 rounded-xl",
};

export const MESSAGE_BLOCK_CONTAIN_STYLE = { contain: "layout style paint" } satisfies CSSProperties;
export const MESSAGE_LIST_CONTAIN_STYLE = { contain: "layout paint style" } satisfies CSSProperties;

export function messageBlockStyle(perfStyle: CSSProperties | undefined): CSSProperties {
  return perfStyle ? { ...MESSAGE_BLOCK_CONTAIN_STYLE, ...perfStyle } : MESSAGE_BLOCK_CONTAIN_STYLE;
}
