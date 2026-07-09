/**
 * Pure prompt assembly for the Local Agent composer.
 *
 * Consumers pass a `LocalAgentComposerSubmit`-shaped payload and get back both
 * a structured section list (useful for previews / tests) and the joined text
 * that ultimately ships to the ACP agent.
 *
 * This module has no React, no IPC, and no side effects.
 */

import type {
  LocalAgentAttachment,
  LocalAgentComposerSubmit,
  LocalAgentQuoteChip,
} from "./local-agent-draft-composer";

export type LocalAgentPromptInput = Pick<LocalAgentComposerSubmit, "text" | "attachments" | "mentions" | "quotes">;

export const PROMPT_PASTED_INLINE_THRESHOLD = 800;
export const PROMPT_PASTED_ATTACH_THRESHOLD = 8000;

export type PromptSection =
  | { kind: "text"; body: string }
  | { kind: "references"; entries: Array<{ token: string; absolutePath: string }> }
  | { kind: "attachments"; entries: LocalAgentAttachment[] }
  | { kind: "paste"; body: string; lines: number; overflowed: boolean };

export type PromptAssemblyResult = {
  sections: PromptSection[];
  text: string;
  unresolvedMentions: string[];
};

const MENTION_TOKEN_RE = /@[^\s@]+/g;

function collectMentionTokensInText(text: string): string[] {
  const matches = text.match(MENTION_TOKEN_RE);
  if (!matches) return [];
  return matches;
}

function dedupeMentionEntries(
  mentions: Record<string, string>,
): Array<{ token: string; absolutePath: string }> {
  const seen = new Set<string>();
  const entries: Array<{ token: string; absolutePath: string }> = [];
  for (const [token, absolutePath] of Object.entries(mentions)) {
    if (!token || !absolutePath) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    entries.push({ token, absolutePath });
  }
  return entries;
}

function formatReferenceLine(entry: { token: string; absolutePath: string }): string {
  return `- ${entry.token} -> ${entry.absolutePath}`;
}

function formatAttachmentLine(attachment: LocalAgentAttachment): string {
  return `- ${attachment.name} (${attachment.kind}) -> ${attachment.absolutePath}`;
}

function truncateQuote(text: string): { body: string; overflowed: boolean } {
  if (text.length <= PROMPT_PASTED_ATTACH_THRESHOLD) return { body: text, overflowed: false };
  const head = text.slice(0, PROMPT_PASTED_ATTACH_THRESHOLD);
  return { body: `${head}\n… (truncated, original length ${text.length})`, overflowed: true };
}

/**
 * Assemble the prompt payload into structured sections plus the joined text.
 *
 * Rules:
 * - Text section: trimmed body, emitted only if non-empty.
 * - References: mentions deduped by token; order preserved as insertion order.
 * - Attachments: emitted as-is (composer already dedupes on add).
 * - Paste: each quote emitted separately; bodies over
 *   PROMPT_PASTED_ATTACH_THRESHOLD are truncated with an overflow marker so
 *   callers can decide whether to spill to attachments.
 * - Unresolved mentions: any `@…` token found in text but missing from the
 *   mentions map is returned in `unresolvedMentions` so the UI can warn.
 */
export function assembleLocalAgentPrompt(
  payload: LocalAgentPromptInput,
): PromptAssemblyResult {
  const sections: PromptSection[] = [];
  const trimmed = payload.text.trim();
  if (trimmed) sections.push({ kind: "text", body: trimmed });

  const mentionEntries = dedupeMentionEntries(payload.mentions);
  if (mentionEntries.length) {
    sections.push({ kind: "references", entries: mentionEntries });
  }

  if (payload.attachments.length) {
    sections.push({ kind: "attachments", entries: payload.attachments });
  }

  for (const quote of payload.quotes) {
    if (!quote.text) continue;
    const { body, overflowed } = truncateQuote(quote.text);
    sections.push({ kind: "paste", body, lines: quote.lines, overflowed });
  }

  const registeredTokens = new Set(mentionEntries.map((entry) => entry.token));
  const tokensInText = collectMentionTokensInText(payload.text);
  const unresolvedSet = new Set<string>();
  for (const token of tokensInText) {
    if (!registeredTokens.has(token)) unresolvedSet.add(token);
  }
  const unresolvedMentions = [...unresolvedSet];

  const text = renderPromptSections(sections);
  return { sections, text, unresolvedMentions };
}

export function renderPromptSections(sections: PromptSection[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    if (section.kind === "text") {
      parts.push(section.body);
    } else if (section.kind === "references") {
      const lines = section.entries.map(formatReferenceLine);
      parts.push(`[Referenced files]\n${lines.join("\n")}`);
    } else if (section.kind === "attachments") {
      const lines = section.entries.map(formatAttachmentLine);
      parts.push(`[Attached files]\n${lines.join("\n")}`);
    } else if (section.kind === "paste") {
      parts.push(`[Pasted content]\n${section.body}`);
    }
  }
  return parts.join("\n\n").trim();
}

export type { LocalAgentAttachment, LocalAgentComposerSubmit, LocalAgentQuoteChip };
