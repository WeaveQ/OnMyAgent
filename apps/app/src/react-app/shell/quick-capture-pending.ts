/**
 * In-memory queue for global quick-capture submits.
 *
 * The desktop mini panel always delivers to the main renderer via CustomEvent,
 * but SessionRoute is unmounted on settings / welcome / etc. Shell enqueues
 * here, navigates to assistant, and SessionRoute takes the payload when ready.
 */

export type PendingQuickCaptureModel = {
  providerID: string;
  modelID: string;
};

export type PendingQuickCapture = {
  text: string;
  model?: PendingQuickCaptureModel;
  enqueuedAt: number;
};

let pending: PendingQuickCapture | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore subscriber failures
    }
  }
}

export function enqueuePendingQuickCapture(input: {
  text: string;
  model?: PendingQuickCaptureModel | null;
}): PendingQuickCapture | null {
  const text = input.text.trim();
  if (!text) return null;
  const providerID = input.model?.providerID?.trim() ?? "";
  const modelID = input.model?.modelID?.trim() ?? "";
  const next: PendingQuickCapture = {
    text,
    enqueuedAt: Date.now(),
    ...(providerID && modelID
      ? { model: { providerID, modelID } }
      : {}),
  };
  pending = next;
  notify();
  return next;
}

export function peekPendingQuickCapture(): PendingQuickCapture | null {
  return pending;
}

/** Atomically read and clear the pending payload (or null if empty). */
export function takePendingQuickCapture(): PendingQuickCapture | null {
  const current = pending;
  pending = null;
  if (current) notify();
  return current;
}

export function clearPendingQuickCapture(): void {
  if (!pending) return;
  pending = null;
  notify();
}

export function subscribePendingQuickCapture(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when the SPA path is a SessionRoute-mounted page. */
export function isSessionRoutePath(pathname: string): boolean {
  const path = pathname.trim() || "/";
  if (path === "/assistant" || path === "/session") return true;
  if (path.startsWith("/assistant/") || path.startsWith("/session/")) return true;
  // /workspace/:id/assistant[/:sessionId] or /session[/:sessionId]
  return /\/workspace\/[^/]+\/(assistant|session)(\/|$)/.test(path);
}

export function resolveQuickCaptureAssistantRoute(workspaceId: string | null | undefined): string {
  const id = workspaceId?.trim() ?? "";
  if (!id) return "/assistant";
  return `/workspace/${encodeURIComponent(id)}/assistant`;
}
