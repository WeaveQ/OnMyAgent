import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
  personalLocalAgentStatus,
  type PersonalLocalAgent,
  type PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";
import { isDocumentHidden } from "../../../infra/visibility-poll";
import { welcomeMessageForAgent } from "../local-agent-page-model";
import type { ChatMessage } from "../messages/message-types";
import {
  hasOptimisticUserMessageForRun,
  messageTextForRun,
} from "./personal-local-agent-page-helpers";
import {
  applyPersonalLocalAgentRuntimeDelta,
  createRunRefreshGate,
  deltaNeedsAuthoritativeSnapshot,
  LOCAL_AGENT_STREAM_SILENCE_MS,
  shouldApplyRunSnapshot,
  shouldPollSilentRun,
} from "./personal-local-agent-stream-coordinator";

type StreamInput = {
  activeRunIdByAgent: Record<string, string | null>;
  agents: PersonalLocalAgent[];
  effectiveWorkspaceRoot: string;
  selectedAgent: PersonalLocalAgent | null;
  selectedMessages: ChatMessage[];
  turnFinishedRef: MutableRefObject<Record<string, boolean>>;
  setActiveRunIdByAgent: Dispatch<SetStateAction<Record<string, string | null>>>;
  setMessagesByAgent: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setErrorsByAgent: Dispatch<SetStateAction<Record<string, string | null>>>;
  rememberRunResult: (agentId: string, run: PersonalLocalAgentRunResult) => void;
};

export function usePersonalLocalAgentStream(input: StreamInput) {
  const {
    activeRunIdByAgent,
    agents,
    effectiveWorkspaceRoot,
    selectedAgent,
    selectedMessages,
    turnFinishedRef,
    setActiveRunIdByAgent,
    setMessagesByAgent,
    setErrorsByAgent,
    rememberRunResult,
  } = input;
  const runSnapshotsRef = useRef(new Map<string, PersonalLocalAgentRunResult>());
  const refreshGateRef = useRef(createRunRefreshGate());
  const lastPresentationAtRef = useRef(new Map<string, number>());
  const activeRunIdByAgentRef = useRef(activeRunIdByAgent);
  useLayoutEffect(() => {
    activeRunIdByAgentRef.current = activeRunIdByAgent;
  }, [activeRunIdByAgent]);
  const pollRunRef = useRef<(chatKey: string, runId: string, options?: { terminal?: boolean }) => void>(() => undefined);

  useEffect(() => {
    for (const message of selectedMessages) {
      if (message.run?.runId && message.run.status === "running") {
        runSnapshotsRef.current.set(message.run.runId, message.run);
      }
    }
  }, [selectedMessages]);

  useEffect(() => {
    const activeRunIds = new Set(Object.values(activeRunIdByAgent).filter((runId): runId is string => Boolean(runId)));
    for (const runId of runSnapshotsRef.current.keys()) {
      if (activeRunIds.has(runId)) continue;
      runSnapshotsRef.current.delete(runId);
      lastPresentationAtRef.current.delete(runId);
    }
  }, [activeRunIdByAgent]);

  useEffect(() => {
    const activeEntries = Object.entries(activeRunIdByAgent).filter((entry): entry is [string, string] => Boolean(entry[1]));
    if (!activeEntries.length) return;
    let disposed = false;

    const applySnapshot = (
      chatKey: string,
      snapshot: PersonalLocalAgentRunResult,
      options: { authoritative?: boolean; remember?: boolean } = {},
    ) => {
      const agentId = chatKey.split("::")[0] ?? chatKey;
      const current = runSnapshotsRef.current.get(snapshot.runId);
      if (!shouldApplyRunSnapshot(current, snapshot)) return;
      if (snapshot.status === "running") {
        runSnapshotsRef.current.set(snapshot.runId, snapshot);
        lastPresentationAtRef.current.set(snapshot.runId, Date.now());
      } else {
        runSnapshotsRef.current.delete(snapshot.runId);
        lastPresentationAtRef.current.delete(snapshot.runId);
        turnFinishedRef.current[snapshot.runId] = true;
      }
      const fallbackAgent = agents.find((agent) => agent.id === snapshot.agentId)
        ?? agents.find((agent) => agent.id === agentId)
        ?? selectedAgent;
      setMessagesByAgent((state) => {
        const list = state[chatKey] ?? (fallbackAgent ? [welcomeMessageForAgent(fallbackAgent)] : []);
        const userText = snapshot.conversationMessages
          ?.find((message) => message.role === "user" && message.text.trim())
          ?.text.trim() ?? "";
        const userMessageId = `user-${snapshot.runId}`;
        const next = list.map((message) => message.run?.runId === snapshot.runId
          ? { ...message, text: messageTextForRun(snapshot, message.text), run: snapshot }
          : message);
        const assistantIndex = next.findIndex((message) => message.run?.runId === snapshot.runId);
        if (
          !userText
          || assistantIndex < 0
          || next.some((message) => message.id === userMessageId)
          || hasOptimisticUserMessageForRun(next, assistantIndex, userText)
        ) return { ...state, [chatKey]: next };
        const userMessage: ChatMessage = {
          id: userMessageId,
          role: "user",
          text: userText,
          createdAt: snapshot.startedAt,
        };
        return {
          ...state,
          [chatKey]: [...next.slice(0, assistantIndex), userMessage, ...next.slice(assistantIndex)],
        };
      });
      if (options.remember !== false) rememberRunResult(agentId, snapshot);
      if (options.authoritative && snapshot.status !== "running") {
        setActiveRunIdByAgent((state) => ({
          ...state,
          [chatKey]: state[chatKey] === snapshot.runId ? null : state[chatKey] ?? null,
        }));
      }
    };

    const pollRun = (chatKey: string, runId: string, options: { terminal?: boolean } = {}) => {
      if (disposed || activeRunIdByAgentRef.current[chatKey] !== runId) {
        refreshGateRef.current.clear(runId);
        return;
      }
      if (!refreshGateRef.current.begin(runId, options)) return;
      void personalLocalAgentStatus({ runId, workspaceRoot: effectiveWorkspaceRoot })
        .then((snapshot) => {
          if (disposed) return;
          if (!snapshot) {
            runSnapshotsRef.current.delete(runId);
            lastPresentationAtRef.current.delete(runId);
            setActiveRunIdByAgent((state) => ({
              ...state,
              [chatKey]: state[chatKey] === runId ? null : state[chatKey] ?? null,
            }));
            return;
          }
          const current = runSnapshotsRef.current.get(runId);
          const effectiveSnapshot = turnFinishedRef.current[runId] && snapshot.status === "running"
            ? {
                ...snapshot,
                status: current?.status === "failed" || current?.status === "cancelled"
                  ? current.status
                  : "completed" as const,
                finishedAt: current?.finishedAt ?? snapshot.finishedAt ?? Date.now(),
              }
            : snapshot;
          applySnapshot(chatKey, effectiveSnapshot, { authoritative: true });
        })
        .catch((error) => {
          if (disposed) return;
          const agentId = chatKey.split("::")[0] ?? chatKey;
          setErrorsByAgent((state) => ({
            ...state,
            [agentId]: error instanceof Error ? error.message : String(error),
          }));
        })
        .finally(() => {
          const settled = refreshGateRef.current.settle(runId);
          if (settled.retry) {
            queueMicrotask(() => pollRunRef.current(chatKey, runId, { terminal: settled.terminalPending }));
          }
        });
    };
    pollRunRef.current = pollRun;

    for (const [chatKey, runId] of activeEntries) {
      if (!lastPresentationAtRef.current.has(runId)) lastPresentationAtRef.current.set(runId, Date.now());
      pollRun(chatKey, runId);
    }
    const unsubscribe = window.__ONMYAGENT_ELECTRON__?.personalAgentRuntime?.onEvent?.((event) => {
      if (!event.runId || !["run.started", "run.snapshot", "run.delta", "run.finished", "process.changed"].includes(event.type)) return;
      const matching = activeEntries.find(([, runId]) => runId === event.runId);
      if (!matching) return;
      const [chatKey, runId] = matching;
      const current = runSnapshotsRef.current.get(runId);
      const merged = current && event.events?.length
        ? applyPersonalLocalAgentRuntimeDelta(current, event)
        : null;
      if (merged) {
        applySnapshot(chatKey, merged, { remember: event.type === "run.finished" });
      } else if (event.type === "run.finished" && current) {
        const status = event.status === "failed" || event.status === "cancelled" ? event.status : "completed";
        applySnapshot(chatKey, {
          ...current,
          ok: status === "completed",
          status,
          finishedAt: current.finishedAt ?? event.updatedAt,
        });
      }
      if (event.type === "run.finished") {
        turnFinishedRef.current[runId] = true;
        pollRun(chatKey, runId, { terminal: true });
        return;
      }
      if (!merged || event.type !== "run.delta" || deltaNeedsAuthoritativeSnapshot(event)) {
        pollRun(chatKey, runId);
      }
    });
    const timer = window.setInterval(() => {
      const hidden = isDocumentHidden();
      const now = Date.now();
      for (const [chatKey, runId] of activeEntries) {
        if (shouldPollSilentRun({
          hidden,
          now,
          lastPresentationAt: lastPresentationAtRef.current.get(runId) ?? null,
        })) pollRun(chatKey, runId);
      }
    }, LOCAL_AGENT_STREAM_SILENCE_MS);
    const onVisibility = () => {
      if (isDocumentHidden()) return;
      for (const [chatKey, runId] of activeEntries) pollRun(chatKey, runId);
    };
    window.document?.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      unsubscribe?.();
      window.clearInterval(timer);
      window.document?.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    activeRunIdByAgent,
    agents,
    effectiveWorkspaceRoot,
    rememberRunResult,
    selectedAgent,
    setActiveRunIdByAgent,
    setErrorsByAgent,
    setMessagesByAgent,
    turnFinishedRef,
  ]);
}
