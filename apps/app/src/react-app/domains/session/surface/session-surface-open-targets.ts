/**
 * Verify open targets against the workspace artifact resolver and auto-open
 * the highest-confidence target once per session (when not streaming).
 *
 * Session reset must run BEFORE verify (declaration order): on a new session
 * empty targets mark the session initialized with no pre-opened id, so when
 * targets later arrive initialize is skipped and auto-open can fire. Reset
 * after verify would clear the empty init and let the next non-empty verify
 * pre-mark the target, suppressing auto-open.
 */
import { useEffect, useRef, useState } from "react";

import {
  classifyOpenTarget,
  selectAutoOpenTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import { collapseDuplicateFileTargets } from "./message-list/open-targets";

export async function listSessionProductFiles(root: string): Promise<ListedWorkspaceFile[]> {
  const { isElectronRuntime } = await import("../../../../app/utils");
  if (!isElectronRuntime()) return [];
  const { listCodeWorkspaceFiles } = await import("../../../../app/lib/desktop");
  const result = await listCodeWorkspaceFiles({
    workspacePath: root,
    recursive: true,
  });
  return result.items ?? [];
}

export type SessionSurfaceOpenTargetsClient = {
  resolveArtifacts: (
    workspaceId: string,
    targets: OpenTarget[],
    options?: { sessionRoot?: string },
  ) => Promise<{ items: OpenTarget[] }>;
};

export type ListedWorkspaceFile = {
  path: string;
  kind?: string;
  size?: number;
  mtimeMs?: number;
};

export type SessionSurfaceOpenTargetsListFiles = (
  root: string,
) => Promise<ListedWorkspaceFile[]>;

export type UseSessionSurfaceOpenTargetsInput = {
  sessionId: string;
  workspaceId: string;
  sessionRoot: string;
  client: SessionSurfaceOpenTargetsClient;
  openTargets: OpenTarget[];
  /** Stable fingerprint so effect does not re-fire on referential churn. */
  openTargetsFingerprint: string;
  chatStreaming: boolean;
  /**
   * Desktop-only: list files under the product root (space folder) so
   * deliverables written outside the catalog workspace still verify.
   */
  listLocalFiles?: SessionSurfaceOpenTargetsListFiles;
  onOpenTarget?: (target: OpenTarget, options?: { auto?: boolean }) => void;
  onOpenTargetsChange?: (targets: OpenTarget[]) => void;
};

/** Pure auto-open bookkeeping — same semantics as the pre-extract host. */
export type AutoOpenSessionState = {
  initializedSessionId: string | null;
  /** Target id already treated as "opened" for this session (suppress re-open). */
  autoOpenedTargetId: string | null;
};

export function createAutoOpenSessionState(): AutoOpenSessionState {
  return { initializedSessionId: null, autoOpenedTargetId: null };
}

/** Clear bookkeeping on session switch (must run before first verify). */
export function resetAutoOpenSessionState(): AutoOpenSessionState {
  return createAutoOpenSessionState();
}

/**
 * First verify for a session records the current best auto-open candidate
 * so reopening a session does not re-fire auto-open. Empty first verify
 * records null — later targets in the same session can still auto-open.
 * Subsequent verifies for the same session are no-ops for bookkeeping.
 *
 * @param candidateId Best auto-open target id at init time (null when empty
 *   or when product policy disables auto-open selection).
 */
export function initializeAutoOpenSessionState(
  state: AutoOpenSessionState,
  sessionId: string,
  candidateId: string | null,
): AutoOpenSessionState {
  if (state.initializedSessionId === sessionId) return state;
  return {
    initializedSessionId: sessionId,
    autoOpenedTargetId: candidateId,
  };
}

export function shouldFireAutoOpen(
  state: AutoOpenSessionState,
  targetId: string | null | undefined,
  chatStreaming: boolean,
): boolean {
  if (!targetId || chatStreaming) return false;
  if (state.autoOpenedTargetId === targetId) return false;
  return true;
}

export function markAutoOpened(
  state: AutoOpenSessionState,
  targetId: string,
): AutoOpenSessionState {
  return { ...state, autoOpenedTargetId: targetId };
}

function candidateIdFromTargets(targets: OpenTarget[]): string | null {
  return selectAutoOpenTarget(targets)?.id ?? null;
}

/** Keep cards working against older/local servers that returned Office files as external. */
export function normalizeVerifiedOpenTargets(targets: OpenTarget[]): OpenTarget[] {
  return targets.map((target) => {
    if (target.kind !== "file" || target.preview !== "external") return target;
    const preview = classifyOpenTarget(target.value, "file");
    return preview === "external" ? target : { ...target, preview };
  });
}

function listedFileKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function listedFileBasename(path: string): string {
  return listedFileDisplayName(path).toLowerCase();
}

function listedFileDisplayName(path: string): string {
  const posix = path.replace(/\\/g, "/");
  return posix.split("/").filter(Boolean).pop() ?? path;
}

/**
 * Mark file targets as existing when they appear in a local directory listing.
 * Used for space-bound sessions whose folder is outside the catalog workspace
 * (server resolve then returns [] / exists:false).
 */
export function applyListedFilesToOpenTargets(
  targets: OpenTarget[],
  listed: ListedWorkspaceFile[],
): OpenTarget[] {
  if (!targets.length) return targets;
  if (!listed.length) return collapseDuplicateFileTargets(targets);
  const byPath = new Map<string, ListedWorkspaceFile>();
  const byBase = new Map<string, ListedWorkspaceFile[]>();
  for (const item of listed) {
    if (item.kind === "dir") continue;
    const key = listedFileKey(item.path);
    if (!key) continue;
    byPath.set(key, item);
    const base = listedFileBasename(item.path);
    const bucket = byBase.get(base) ?? [];
    bucket.push(item);
    byBase.set(base, bucket);
  }

  const mapped = targets.map((target) => {
    if (target.kind !== "file") return target;
    const exact = byPath.get(listedFileKey(target.value));
    const baseMatches = byBase.get(listedFileBasename(target.value)) ?? [];
    const match = exact ?? (baseMatches.length === 1 ? baseMatches[0] : undefined);
    if (!match) return target;
    const preview =
      target.preview === "external"
        ? classifyOpenTarget(match.path || target.value, "file")
        : target.preview;
    const listedPath = match.path.trim();
    return {
      ...target,
      // Listing path is session-relative (output/a.xlsx). Keep that so
      // Office preview joins fileRoot + value instead of a truncated
      // "Support/com.differential..." leftover from Application Support.
      value: listedPath || target.value,
      name: listedFileDisplayName(listedPath) || target.name,
      exists: true,
      size: typeof match.size === "number" ? match.size : target.size,
      updatedAt: typeof match.mtimeMs === "number" ? match.mtimeMs : target.updatedAt,
      preview,
    };
  });
  return collapseDuplicateFileTargets(mapped);
}

async function applyLocalFileListing(
  targets: OpenTarget[],
  input: Pick<UseSessionSurfaceOpenTargetsInput, "listLocalFiles" | "sessionRoot">,
): Promise<OpenTarget[]> {
  const root = input.sessionRoot?.trim() ?? "";
  if (!root || !input.listLocalFiles) return targets;
  try {
    const listed = await input.listLocalFiles(root);
    return applyListedFilesToOpenTargets(targets, listed);
  } catch {
    return targets;
  }
}

export function useSessionSurfaceOpenTargets(
  input: UseSessionSurfaceOpenTargetsInput,
) {
  const [verifiedOpenTargets, setVerifiedOpenTargets] = useState<OpenTarget[]>(
    [],
  );
  const autoOpenStateRef = useRef<AutoOpenSessionState>(
    createAutoOpenSessionState(),
  );

  const autoOpenTarget = selectAutoOpenTarget(verifiedOpenTargets);

  // 1) Session reset FIRST — same order as pre-extract session-surface.tsx.
  useEffect(() => {
    autoOpenStateRef.current = resetAutoOpenSessionState();
    setVerifiedOpenTargets([]);
  }, [input.sessionId]);

  // 2) Verify artifacts; first init for session may pre-mark auto-open id.
  useEffect(() => {
    let cancelled = false;
    const sessionId = input.sessionId;

    async function verifyTargets() {
      if (!input.openTargets.length) {
        autoOpenStateRef.current = initializeAutoOpenSessionState(
          autoOpenStateRef.current,
          sessionId,
          null,
        );
        setVerifiedOpenTargets([]);
        return;
      }
      try {
        const response = await input.client.resolveArtifacts(
          input.workspaceId,
          input.openTargets,
          { sessionRoot: input.sessionRoot },
        );
        if (cancelled) return;
        const serverTargets = normalizeVerifiedOpenTargets(
          response.items as OpenTarget[],
        );
        const nextTargets = await applyLocalFileListing(
          serverTargets.length ? serverTargets : input.openTargets,
          {
            sessionRoot: input.sessionRoot,
            listLocalFiles: input.listLocalFiles ?? listSessionProductFiles,
          },
        );
        if (cancelled) return;
        autoOpenStateRef.current = initializeAutoOpenSessionState(
          autoOpenStateRef.current,
          sessionId,
          candidateIdFromTargets(nextTargets),
        );
        setVerifiedOpenTargets(nextTargets);
      } catch {
        if (cancelled) return;
        const fallback = input.openTargets.map((target) => ({
          ...target,
          exists: target.kind === "url",
        }));
        const nextTargets = await applyLocalFileListing(fallback, {
          sessionRoot: input.sessionRoot,
          listLocalFiles: input.listLocalFiles ?? listSessionProductFiles,
        });
        if (cancelled) return;
        autoOpenStateRef.current = initializeAutoOpenSessionState(
          autoOpenStateRef.current,
          sessionId,
          candidateIdFromTargets(nextTargets),
        );
        setVerifiedOpenTargets(nextTargets);
      }
    }
    void verifyTargets();
    return () => {
      cancelled = true;
    };
  }, [
    input.openTargetsFingerprint,
    input.client,
    input.sessionId,
    input.workspaceId,
    input.sessionRoot,
    input.openTargets,
    input.listLocalFiles,
  ]);

  // 3) Auto-open newly verified high-confidence targets when not streaming.
  useEffect(() => {
    const targetId = autoOpenTarget?.id ?? null;
    if (
      !shouldFireAutoOpen(
        autoOpenStateRef.current,
        targetId,
        input.chatStreaming,
      )
    ) {
      return;
    }
    if (!autoOpenTarget || !targetId) return;
    autoOpenStateRef.current = markAutoOpened(
      autoOpenStateRef.current,
      targetId,
    );
    input.onOpenTarget?.(autoOpenTarget, { auto: true });
  }, [autoOpenTarget, input.chatStreaming, input.onOpenTarget]);

  // 4) Publish verified list to the host.
  useEffect(() => {
    input.onOpenTargetsChange?.(verifiedOpenTargets);
  }, [input.onOpenTargetsChange, verifiedOpenTargets]);

  return {
    verifiedOpenTargets,
    autoOpenTarget,
  };
}
