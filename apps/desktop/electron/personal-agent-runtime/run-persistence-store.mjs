import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { appendConversationEvents, writeConversationEvents } from "./conversation-store.mjs";
import { runEventsToConversationMessages } from "./contract.mjs";

/**
 * Durable run writer. Run logs append after the first checkpoint; conversation
 * transcripts use the same append/checkpoint pattern so streaming is O(delta).
 */
export function createPersonalRunPersistence({ options, visibleArtifacts, metaBuilder }) {
  async function persistRun(state) {
    if (typeof options.persistRun === "function") {
      await options.persistRun(state);
      return;
    }
    if (!state.logPath) return;
    await mkdir(path.dirname(state.logPath), { recursive: true });
    const eventStart = Number.isSafeInteger(state.persistedEventCount) ? state.persistedEventCount : 0;
    const newEvents = state.events.slice(eventStart);
    const entries = [];
    if (eventStart === 0) entries.push(metaBuilder(state, { visibleArtifacts }));
    entries.push(...newEvents);
    const shouldPersistTerminalMeta = state.status !== "running" && !state.persistedTerminalMeta;
    if (shouldPersistTerminalMeta) entries.push(metaBuilder(state, { visibleArtifacts }));
    if (entries.length > 0) {
      const serialized = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
      if (eventStart === 0) await writeFile(state.logPath, serialized, "utf8");
      else await appendFile(state.logPath, serialized, "utf8");
    }
    state.persistedEventCount = state.events.length;
    if (shouldPersistTerminalMeta) state.persistedTerminalMeta = true;
    if (state.workspaceRoot && state.agentProvider && state.agentId && state.conversationId) {
      const conversationStart = Number.isSafeInteger(state.conversationPersistedEventCount)
        ? state.conversationPersistedEventCount
        : 0;
      const newConversationEvents = state.events.slice(conversationStart);
      let conversationEventsPersisted = false;
      if (conversationStart === 0) {
        try {
          await writeConversationEvents(
            state.workspaceRoot,
            state.agentProvider,
            state.agentId,
            state.conversationId,
            state.events,
            runEventsToConversationMessages(state.events),
          );
          conversationEventsPersisted = true;
        } catch {
          // Keep the checkpoint cursor unchanged so the next flush retries.
        }
      } else if (newConversationEvents.length > 0) {
        try {
          await appendConversationEvents(
            state.workspaceRoot,
            state.agentProvider,
            state.agentId,
            state.conversationId,
            newConversationEvents,
          );
          conversationEventsPersisted = true;
        } catch {
          // Keep the checkpoint cursor unchanged so the next flush retries.
        }
      }
      if (conversationEventsPersisted) state.conversationPersistedEventCount = state.events.length;
      if (conversationEventsPersisted && (state.status !== "running" || state.events.length % 64 === 0)) {
        try {
          await writeConversationEvents(
            state.workspaceRoot,
            state.agentProvider,
            state.agentId,
            state.conversationId,
            state.events,
            runEventsToConversationMessages(state.events),
          );
        } catch {
          // The append log remains authoritative until a later checkpoint.
        }
      }
    }
  }

  return persistRun;
}
