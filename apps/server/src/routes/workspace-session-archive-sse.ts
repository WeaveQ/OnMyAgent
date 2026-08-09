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

/**
 * Safe SSE pump helpers. Client disconnect cancels the stream without going
 * through our close() first — enqueue after that throws ERR_INVALID_STATE and
 * was taking down the whole desktop process via uncaughtException.
 */
function createSsePump(input: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  dbPath: string;
  encoder: TextEncoder;
  maxEvents: number;
  signal: AbortSignal;
}) {
  let sent = 0;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    try {
      unsubscribe?.();
    } catch {
      // ignore unsubscribe races
    }
    unsubscribe = null;
    try {
      defaultSessionArchiveStorePool.release({ dbPath: input.dbPath });
    } catch {
      // ignore pool release races
    }
    try {
      input.controller.close();
    } catch {
      // already closed by cancel / peer
    }
  };

  const send = (event: string, data: unknown): boolean => {
    if (closed || input.signal.aborted) {
      close();
      return false;
    }
    try {
      input.controller.enqueue(input.encoder.encode(sseEvent(event, data)));
      sent += 1;
      return true;
    } catch {
      // Controller already closed (client gone) — tear down cleanly.
      close();
      return false;
    }
  };

  const closeIfDone = (): boolean => {
    if (input.maxEvents > 0 && sent >= input.maxEvents) {
      close();
      return true;
    }
    return false;
  };

  return {
    close,
    send,
    closeIfDone,
    setTimer: (fn: () => void, ms: number) => {
      timer = setInterval(fn, ms);
    },
    setUnsubscribe: (fn: () => void) => {
      unsubscribe = fn;
    },
    get closed() {
      return closed;
    },
  };
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
  let lastVersion = archiveSessionWatchVersion(input.session, input.timing);
  let tearDown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = createSsePump({
        controller,
        dbPath: input.dbPath,
        encoder,
        maxEvents: input.maxEvents,
        signal: input.signal,
      });
      tearDown = () => pump.close();

      if (!pump.send("session.timing", input.timing)) return;
      if (!pump.send("heartbeat", new Date().toISOString())) return;
      if (pump.closeIfDone()) return;

      const pushIfChanged = () => {
        if (pump.closed || input.signal.aborted) {
          pump.close();
          return;
        }
        const session = input.store.getSession(input.sessionId);
        const timing = input.store.getTiming(input.sessionId);
        const version = archiveSessionWatchVersion(session, timing);
        if (session && timing && version !== lastVersion) {
          lastVersion = version;
          if (!pump.send("session.timing", timing)) return;
          if (!pump.send("session_updated", { session_id: input.sessionId, session })) return;
        } else if (!pump.send("heartbeat", new Date().toISOString())) {
          return;
        }
        pump.closeIfDone();
      };

      // Change-driven push (sync/notify) + long-interval poll fallback.
      // Store is connection-scoped — never open/close SQLite inside the timer.
      pump.setUnsubscribe(subscribeArchiveDbChanges(input.dbPath, pushIfChanged));
      pump.setTimer(pushIfChanged, input.pollMs);

      input.signal.addEventListener(
        "abort",
        () => {
          pump.close();
        },
        { once: true },
      );
    },
    cancel() {
      tearDown?.();
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
  let lastVersion = archiveStatsVersion(input.stats);
  let tearDown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = createSsePump({
        controller,
        dbPath: input.dbPath,
        encoder,
        maxEvents: input.maxEvents,
        signal: input.signal,
      });
      tearDown = () => pump.close();

      if (
        !pump.send("data_changed", {
          scope: "session-archive.archive",
          workspace_id: input.workspaceId,
          stats: input.stats,
        })
      ) {
        return;
      }
      if (!pump.send("heartbeat", new Date().toISOString())) return;
      if (pump.closeIfDone()) return;

      const pushIfChanged = () => {
        if (pump.closed || input.signal.aborted) {
          pump.close();
          return;
        }
        const stats = input.store.stats();
        const version = archiveStatsVersion(stats);
        if (version !== lastVersion) {
          lastVersion = version;
          if (
            !pump.send("data_changed", {
              scope: "session-archive.archive",
              workspace_id: input.workspaceId,
              stats,
            })
          ) {
            return;
          }
        } else if (!pump.send("heartbeat", new Date().toISOString())) {
          return;
        }
        pump.closeIfDone();
      };

      pump.setUnsubscribe(subscribeArchiveDbChanges(input.dbPath, pushIfChanged));
      pump.setTimer(pushIfChanged, input.pollMs);

      input.signal.addEventListener(
        "abort",
        () => {
          pump.close();
        },
        { once: true },
      );
    },
    cancel() {
      tearDown?.();
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
