/**
 * Pure helpers for SessionSurface host wiring.
 *
 * Timeouts, draft composition, load/streaming flags, path utilities, and
 * goal-waiting rules stay here so the host can shrink without losing tests.
 */
import type {
  CollaborationGoalRuntime,
  ComposerAccessMode,
  ComposerAttachment,
  ComposerCollaborationMode,
  ComposerDraft,
  ComposerMentionKind,
  ComposerPart,
  TodoItem,
} from "../../../../app/types";
import type { SessionError } from "./session-surface-support";
import type { ComposerPastePart } from "./composer-state-store";
import {
  decodeComposerMentionValue,
  encodeComposerMentionValue,
} from "./composer/mention-encoding";
import type { SessionActivityStatus } from "../status/session-activity-store";
import type { OpenTarget } from "../artifacts/open-target";

/** Auto-dismiss duration for transient composer notices. */
export const COMPOSER_NOTICE_TIMEOUT_MS = 2400;

/** Folder-required bubble shown when code draft send is blocked. */
export const FOLDER_REQUIRED_BUBBLE_TIMEOUT_MS = 2600;

/** Delay before the cached-switch badge (empty pending load paints immediately). */
export const DELAYED_SESSION_LOADING_MS = 2000;

/** After idle + new assistant turn with no visible text, surface the empty-output card. */
export const NO_VISIBLE_ASSISTANT_OUTPUT_DELAY_MS = 1000;

const WORKSPACE_ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Guess MIME type for a workspace file path (mention → File attach). */
export function workspaceAttachmentContentType(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  return WORKSPACE_ATTACHMENT_CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Strip workspace root prefix so downloadWorkspaceFile gets a relative path.
 */
export function resolveWorkspaceRelativeDownloadPath(
  workspaceRoot: string,
  filePath: string,
): string {
  const normalizedRoot = workspaceRoot.replace(/[\\/]+$/, "");
  const normalizedPath = filePath.trim();
  if (
    normalizedRoot &&
    (normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(`${normalizedRoot}/`) ||
      normalizedPath.startsWith(`${normalizedRoot}\\`))
  ) {
    return normalizedPath.slice(normalizedRoot.length).replace(/^[\\/]+/, "");
  }
  return normalizedPath.replace(/^\.\//, "");
}

/** Stable fingerprint for open-target lists (effect deps). */
export function openTargetsFingerprint(
  targets: ReadonlyArray<Pick<OpenTarget, "kind" | "value" | "confidence">>,
): string {
  return targets
    .map((target) => `${target.kind}:${target.value}:${target.confidence}`)
    .join("|");
}

/** True while snapshot is still loading and transcript is empty. */
export function derivePendingSessionLoad(input: {
  draftOnly?: boolean | null;
  hasSnapshot: boolean;
  isLoading: boolean;
  messageCount: number;
}): boolean {
  return (
    !input.draftOnly &&
    !input.hasSnapshot &&
    input.isLoading &&
    input.messageCount === 0
  );
}

/** Backend reports busy/retry for the live session status. */
export function isRemoteSessionBusy(statusType: string): boolean {
  return statusType === "busy" || statusType === "retry";
}

/**
 * Composer/session "streaming" flag: local send OR remote busy,
 * unless user stop should hide remote busy.
 */
export function deriveChatStreaming(input: {
  sending: boolean;
  remoteBusy: boolean;
  draftOnly?: boolean | null;
  stopRequested: boolean;
}): boolean {
  const stopHidesRemoteBusy = !input.draftOnly && input.stopRequested;
  return input.sending || (input.remoteBusy && !stopHidesRemoteBusy);
}

/**
 * Prefer the first non-dismissed error among local, activity-store, and snapshot errors.
 */
export function pickVisibleSessionError(
  candidates: Array<SessionError | null | undefined>,
  dismissedErrorMessage: string | null,
): SessionError | null {
  return (
    candidates.find(
      (item) => item && item.message !== dismissedErrorMessage,
    ) ?? null
  );
}

/** Map permission / question / compacting into goal waitingReason. */
export function deriveActiveGoalWaitingReason(input: {
  activePermissionNeedsApproval: boolean;
  hasActiveQuestion: boolean;
  effectiveActivityStatus: SessionActivityStatus | string;
}): CollaborationGoalRuntime["waitingReason"] | null {
  if (input.activePermissionNeedsApproval) return "permission";
  if (input.hasActiveQuestion) return "question";
  if (input.effectiveActivityStatus === "compacting") return "compacting";
  return null;
}

/** Incomplete (non-empty, non-completed) todos for accessory visibility. */
export function hasIncompleteTodos(todos: readonly TodoItem[]): boolean {
  return todos.some(
    (todo) => todo.content.trim() && todo.status !== "completed",
  );
}

/** Code toolbar only for an active (non-draft-home) code session. */
export function shouldShowCodeSceneToolbar(input: {
  assistantCodeFeaturesActive: boolean;
  assistantFeatureCategoryId: string;
  draftOnly?: boolean | null;
}): boolean {
  return (
    input.assistantCodeFeaturesActive &&
    input.assistantFeatureCategoryId === "code" &&
    !(input.draftOnly ?? false)
  );
}

/** Office vs legacy collaboration mode chrome. */
export function resolveCollaborationModeVariant(input: {
  assistantOfficeFeaturesActive: boolean;
  assistantFeatureCategoryId: string;
}): "office" | "legacy" {
  return input.assistantOfficeFeaturesActive &&
    input.assistantFeatureCategoryId === "office"
    ? "office"
    : "legacy";
}

/** Snapshot query error message for the load-failure UI. */
export function snapshotQueryErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to load session.";
}

/**
 * Build a ComposerDraft from free-text + attachments, expanding paste
 * placeholders and resolving @mentions into structured parts.
 */
export function buildComposerDraft(input: {
  text: string;
  attachments: ComposerAttachment[];
  pasteParts: readonly ComposerPastePart[];
  mentions: Readonly<Record<string, ComposerMentionKind>>;
  accessMode: ComposerAccessMode;
  collaborationMode: ComposerCollaborationMode;
}): ComposerDraft {
  const { text, attachments, pasteParts, mentions } = input;
  const parts: ComposerPart[] = text
    .split(/(\[\[assistant-scenario:[^\]]+\]\]|\[pasted text [^\]]+\]|@[^\s@]+)/)
    .flatMap((segment) => {
      if (!segment) return [] as ComposerPart[];
      if (/^\[\[assistant-scenario:[^\]]+\]\]$/.test(segment)) {
        return [] as ComposerPart[];
      }
      const pasteMatch = segment.match(/^\[pasted text (.+)\]$/);
      if (pasteMatch) {
        const target = pasteParts.find((item) => item.label === pasteMatch[1]);
        if (target) {
          return [
            {
              type: "paste",
              id: target.id,
              label: target.label,
              text: target.text,
              lines: target.lines,
            } satisfies ComposerPart,
          ];
        }
      }
      if (segment.startsWith("@")) {
        const value = decodeComposerMentionValue(segment.slice(1));
        const kind = mentions[value];
        if (kind === "agent") {
          return [{ type: "agent", name: value } satisfies ComposerPart];
        }
        if (kind === "file") {
          return [
            {
              type: "file",
              path: value,
              label: value,
            } satisfies ComposerPart,
          ];
        }
        if (kind === "directory") {
          return [
            {
              type: "directory",
              path: value,
              label: value,
            } satisfies ComposerPart,
          ];
        }
      }
      return [{ type: "text", text: segment } satisfies ComposerPart];
    });

  // Expand paste placeholders in resolvedText so the model receives
  // the actual pasted content instead of "[pasted text <label>]".
  let resolved = text;
  for (const part of pasteParts) {
    resolved = resolved.replace(`[pasted text ${part.label}]`, part.text);
  }
  for (const value of Object.keys(mentions)) {
    resolved = resolved.replaceAll(
      `@${encodeComposerMentionValue(value)}`,
      `@${value}`,
    );
  }
  const resolvedSlashMatch = resolved.trim().match(/^\/([^\s]+)\s*(.*)$/);
  return {
    mode: "prompt",
    parts,
    attachments,
    accessMode: input.accessMode,
    collaborationMode: input.collaborationMode,
    text,
    resolvedText: resolved,
    command: resolvedSlashMatch
      ? {
          name: resolvedSlashMatch[1] ?? "",
          arguments: resolvedSlashMatch[2] ?? "",
        }
      : undefined,
  };
}
