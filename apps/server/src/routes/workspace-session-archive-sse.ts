/**
 * Session-archive SSE helpers (watch/events streams + one-shot event batches).
 * Extracted from workspace-session-archive-routes composition root.
 */

import type { SessionArchiveStore } from "../services/session-archive.js";
import {
  archiveSessionWatchVersion,
  archiveStatsVersion,
} from "../services/archive-sse-version.js";
import { subscribeArchiveDbChanges } from "../services/archive-change-bus.js";
import { defaultSessionArchiveStorePool } from "../services/session-archive-store-pool.js";

export function sseEvent(event: string, data: unknown): string {
  const value = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${value}\n\n`;
}

export function sseResponse(events: string[]): Response {
  return new Response(events.join(""), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export function persistentSessionArchiveWatchResponse(input: {
  store: SessionArchiveStore;
  dbPath: string;
  sessionId: string;
  session: unknown;
  timing: unknown;
  pollMs: number;
  maxEvents: number;
  signal: AbortSignal;
}): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  let lastVersion = archiveSessionWatchVersion(input.session, input.timing);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let timer: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseEvent(event, data)));
        sent += 1;
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        unsubscribe?.();
        defaultSessionArchiveStorePool.release({ dbPath: input.dbPath });
        controller.close();
      };
      const closeIfDone = () => {
        if (input.maxEvents > 0 && sent >= input.maxEvents) {
          close();
          return true;
        }
        return false;
      };
      send("session.timing", input.timing);
      send("heartbeat", new Date().toISOString());
      if (closeIfDone()) return;

      const pushIfChanged = () => {
        if (closed || input.signal.aborted) {
          close();
          return;
        }
        const session = input.store.getSession(input.sessionId);
        const timing = input.store.getTiming(input.sessionId);
        const version = archiveSessionWatchVersion(session, timing);
        if (session && timing && version !== lastVersion) {
          lastVersion = version;
          send("session.timing", timing);
          send("session_updated", { session_id: input.sessionId, session });
        } else {
          send("heartbeat", new Date().toISOString());
        }
        closeIfDone();
      };

      // Change-driven push (sync/notify) + long-interval poll fallback.
      // Store is connection-scoped — never open/close SQLite inside the timer.
      // Version tokens use archiveSessionWatchVersion (not full-object JSON.stringify).
      unsubscribe = subscribeArchiveDbChanges(input.dbPath, pushIfChanged);
      timer = setInterval(pushIfChanged, input.pollMs);

      input.signal.addEventListener("abort", () => {
        close();
      }, { once: true });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export function persistentSessionArchiveEventsResponse(input: {
  store: SessionArchiveStore;
  dbPath: string;
  workspaceId: string;
  stats: unknown;
  pollMs: number;
  maxEvents: number;
  signal: AbortSignal;
}): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  let lastVersion = archiveStatsVersion(input.stats);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let timer: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseEvent(event, data)));
        sent += 1;
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        unsubscribe?.();
        defaultSessionArchiveStorePool.release({ dbPath: input.dbPath });
        controller.close();
      };
      const closeIfDone = () => {
        if (input.maxEvents > 0 && sent >= input.maxEvents) {
          close();
          return true;
        }
        return false;
      };
      send("data_changed", { scope: "session-archive.archive", workspace_id: input.workspaceId, stats: input.stats });
      send("heartbeat", new Date().toISOString());
      if (closeIfDone()) return;

      const pushIfChanged = () => {
        if (closed || input.signal.aborted) {
          close();
          return;
        }
        const stats = input.store.stats();
        const version = archiveStatsVersion(stats);
        if (version !== lastVersion) {
          lastVersion = version;
          send("data_changed", { scope: "session-archive.archive", workspace_id: input.workspaceId, stats });
        } else {
          send("heartbeat", new Date().toISOString());
        }
        closeIfDone();
      };

      unsubscribe = subscribeArchiveDbChanges(input.dbPath, pushIfChanged);
      timer = setInterval(pushIfChanged, input.pollMs);

      input.signal.addEventListener("abort", () => {
        close();
      }, { once: true });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
