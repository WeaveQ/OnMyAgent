import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  appendConversationEvents,
  readConversationEvents,
  writeConversationEvents,
} from "./conversation-store.mjs";
import { runEventsToConversationMessages } from "./contract.mjs";

function conversationEventFingerprint(event) {
  try {
    return JSON.stringify(event);
  } catch {
    return null;
  }
}

async function checkpointConversationEvents(state) {
  const stored = await readConversationEvents(
    state.workspaceRoot,
    state.agentProvider,
    state.agentId,
    state.conversationId,
  );
  const persistedCount = Number.isSafeInteger(state.conversationPersistedEventCount)
    ? state.conversationPersistedEventCount
    : 0;
  const events = [...stored.events];
  const eventFingerprints = new Set(
    stored.events
      .map((event) => conversationEventFingerprint(event))
      .filter(Boolean),
  );
  for (const event of state.events.slice(persistedCount)) {
    const fingerprint = conversationEventFingerprint(event);
    if (fingerprint && eventFingerprints.has(fingerprint)) continue;
    events.push(event);
    if (fingerprint) eventFingerprints.add(fingerprint);
  }
  const derivedMessages = runEventsToConversationMessages(events);
  const derivedMessageIds = new Set(derivedMessages.map((message) => String(message?.id ?? "")).filter(Boolean));
  const preservedMessages = (stored.checkpointMessages ?? stored.messages)
    .filter((message) => !derivedMessageIds.has(String(message?.id ?? "")));
  const messages = [...preservedMessages, ...derivedMessages];
  await writeConversationEvents(
    state.workspaceRoot,
    state.agentProvider,
    state.agentId,
    state.conversationId,
    events,
    messages,
  );
}

/**
 * Durable run writer. Run logs append after the first checkpoint; conversation
 * transcripts use the same append/checkpoint pattern so streaming is O(delta).
 */
export function createPersonalRunPersistence({ options, visibleArtifacts, metaBuilder }) {
  const conversationWriteQueues = new Map();

  async function persistConversation(state) {
    const conversationStart = Number.isSafeInteger(state.conversationPersistedEventCount)
      ? state.conversationPersistedEventCount
      : 0;
    const newConversationEvents = state.events.slice(conversationStart);
    let conversationEventsPersisted = false;
    if (newConversationEvents.length > 0) {
      try {
        // A run-local cursor starts at zero for every turn. Always append the
        // delta first; the terminal/periodic checkpoint compacts every turn.
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
        await checkpointConversationEvents(state);
      } catch {
        // The append log remains authoritative until a later checkpoint.
      }
    }
  }

  async function queueConversationPersist(state) {
    const key = JSON.stringify([
      state.workspaceRoot,
      state.agentProvider,
      state.agentId,
      state.conversationId,
    ]);
    const previous = conversationWriteQueues.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => persistConversation(state));
    conversationWriteQueues.set(key, operation);
    try {
      await operation;
    } finally {
      if (conversationWriteQueues.get(key) === operation) conversationWriteQueues.delete(key);
    }
  }

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
      await queueConversationPersist(state);
    }
  }

  return persistRun;
}
