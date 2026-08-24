/** @jsxImportSource react */
import type { ReactNode } from "react";

export type AtQueryState = {
  active: boolean;
  query: string;
  start: number;
  end: number;
};

type MentionSpan = { start: number; end: number };

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

export function getNativeFilePath(file: File): string | null {
  type ElectronBridge = { files?: { getPathForFile?: (file: File) => string | null } };
  const globalScope = globalThis as typeof globalThis & { __ONMYAGENT_ELECTRON__?: ElectronBridge };
  const helper = globalScope.__ONMYAGENT_ELECTRON__?.files?.getPathForFile;
  if (typeof helper === "function") {
    try {
      return helper(file) ?? null;
    } catch {
      return null;
    }
  }
  const legacyPath = (file as File & { path?: string }).path;
  return typeof legacyPath === "string" && legacyPath ? legacyPath : null;
}

export function formatAttachmentBytes(value?: number): string {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function findAllMentionSpans(
  value: string,
  mentions: Record<string, string>,
): MentionSpan[] {
  const spans: MentionSpan[] = [];
  const tokens = Object.keys(mentions).sort((left, right) => right.length - left.length);
  if (!tokens.length) return spans;
  let cursor = 0;
  while (cursor < value.length) {
    let matched = false;
    for (const token of tokens) {
      if (!value.startsWith(token, cursor)) continue;
      const before = cursor === 0 ? " " : value[cursor - 1];
      if (before && !/\s/.test(before) && cursor !== 0) continue;
      const end = cursor + token.length;
      const after = value[end];
      if (after !== undefined && !/\s/.test(after) && after !== "") continue;
      spans.push({ start: cursor, end });
      cursor = end;
      matched = true;
      break;
    }
    if (!matched) cursor += 1;
  }
  return spans;
}

export function findAtQuery(value: string, caret: number): AtQueryState {
  if (caret <= 0) return { active: false, query: "", start: -1, end: -1 };
  let index = caret - 1;
  while (index >= 0) {
    if (value[index] === "@") {
      const before = index === 0 ? " " : value[index - 1];
      if (before && !/\s/.test(before) && index !== 0) {
        return { active: false, query: "", start: -1, end: -1 };
      }
      const query = value.slice(index + 1, caret);
      if (/\s/.test(query)) return { active: false, query: "", start: -1, end: -1 };
      return { active: true, query, start: index, end: caret };
    }
    if (/\s/.test(value[index])) break;
    index -= 1;
  }
  return { active: false, query: "", start: -1, end: -1 };
}

export function renderMentionMirror(value: string, mentions: Record<string, string>): ReactNode[] {
  const spans = findAllMentionSpans(value, mentions);
  if (!spans.length) return [value + "\u200b"];
  const nodes: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (cursor < span.start) nodes.push(value.slice(cursor, span.start));
    nodes.push(
      <span key={`m-${index}`} className="text-dls-accent">
        {value.slice(span.start, span.end)}
      </span>,
    );
    cursor = span.end;
  });
  if (cursor < value.length) nodes.push(value.slice(cursor));
  nodes.push("\u200b");
  return nodes;
}

export type LocalAgentComposerTextPresentation = {
  mirrorColor: string;
  textareaColor?: string;
  textareaTextFillColor?: string;
};

export function resolveLocalAgentComposerTextPresentation(
  hasMentions: boolean,
): LocalAgentComposerTextPresentation {
  return hasMentions
    ? {
        mirrorColor: "var(--dls-text, currentColor)",
        textareaColor: "transparent",
        textareaTextFillColor: "transparent",
      }
    : { mirrorColor: "transparent" };
}

export function canSubmitLocalAgentComposer(input: {
  text: string;
  attachmentCount: number;
  quoteCount: number;
  uploading: number;
  disabled: boolean;
  submitting: boolean;
}): boolean {
  return (
    (Boolean(input.text.trim()) || input.attachmentCount > 0 || input.quoteCount > 0) &&
    input.uploading === 0 &&
    !input.disabled &&
    !input.submitting
  );
}

export function shouldCommitLocalAgentAttachment(
  activeDraftKey: string,
  uploadDraftKey: string,
): boolean {
  return activeDraftKey === uploadDraftKey;
}
