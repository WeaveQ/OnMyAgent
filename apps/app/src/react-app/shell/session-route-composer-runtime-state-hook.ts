/**
 * Per-session composer runtime: access/collab modes, plan/goal, model overrides,
 * permission/question busy flags, pending agent.
 */
import { useEffect, useRef, useState } from "react";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerDraft,
  ModelRef,
} from "../../app/types";
import { usePendingAgentStore } from "../domains/agents";
import {
  readSessionAccessModes,
  readSessionCollaborationModes,
  readSessionGoalRuntimes,
  readSessionModelOverrides,
  writeSessionAccessModes,
  writeSessionCollaborationModes,
  writeSessionGoalRuntimes,
  writeSessionModelOverrides,
} from "./session-memory";

export function useSessionRouteComposerRuntimeState(input: {
  selectedWorkspaceId: string;
}) {
  const [permissionReplyBusy, setPermissionReplyBusy] = useState(false);
  const permissionReplyBusyRef = useRef(false);
  const [sessionAccessModeById, setSessionAccessModeById] = useState<
    Record<string, NonNullable<ComposerDraft["accessMode"]>>
  >(() => readSessionAccessModes());
  const [sessionCollaborationModeById, setSessionCollaborationModeById] =
    useState<Record<string, ComposerDraft["collaborationMode"]>>(
      () => readSessionCollaborationModes(),
    );
  const [sessionModelOverrideById, setSessionModelOverrideById] = useState<
    Record<string, ModelRef>
  >(() => readSessionModelOverrides());
  const [sessionPlanRuntimeById, setSessionPlanRuntimeById] = useState<
    Record<string, CollaborationPlanRuntime>
  >({});
  const [sessionGoalRuntimeById, setSessionGoalRuntimeById] = useState<
    Record<string, CollaborationGoalRuntime>
  >(() => readSessionGoalRuntimes());
  const [
    autoApprovedPermissionNoticeBySessionId,
    setAutoApprovedPermissionNoticeBySessionId,
  ] = useState<Record<string, string>>({});
  const [questionReplyBusy, setQuestionReplyBusy] = useState(false);
  const questionReplyBusyRef = useRef(false);
  // Subscribe to pending agent so the composer's model selection reflects
  // the agent's configured model when the user clicks "对话" from the agents page.
  const pendingAgent = usePendingAgentStore((state) => state.agent);

  useEffect(() => {
    writeSessionGoalRuntimes(sessionGoalRuntimeById);
  }, [sessionGoalRuntimeById]);

  useEffect(() => {
    writeSessionAccessModes(sessionAccessModeById);
  }, [sessionAccessModeById]);

  useEffect(() => {
    writeSessionCollaborationModes(sessionCollaborationModeById);
  }, [sessionCollaborationModeById]);

  useEffect(() => {
    writeSessionModelOverrides(sessionModelOverrideById);
  }, [sessionModelOverrideById]);

  // A fresh agent-card conversation must begin with the agent's configured
  // model, not a model picked for an earlier draft in the same workspace.
  useEffect(() => {
    const draftSessionId = `draft:${input.selectedWorkspaceId}`;
    setSessionModelOverrideById((current) => {
      if (!(draftSessionId in current)) return current;
      const next = { ...current };
      delete next[draftSessionId];
      return next;
    });
  }, [pendingAgent?.conversationStartId, input.selectedWorkspaceId]);

  return {
    permissionReplyBusy,
    setPermissionReplyBusy,
    permissionReplyBusyRef,
    sessionAccessModeById,
    setSessionAccessModeById,
    sessionCollaborationModeById,
    setSessionCollaborationModeById,
    sessionModelOverrideById,
    setSessionModelOverrideById,
    sessionPlanRuntimeById,
    setSessionPlanRuntimeById,
    sessionGoalRuntimeById,
    setSessionGoalRuntimeById,
    autoApprovedPermissionNoticeBySessionId,
    setAutoApprovedPermissionNoticeBySessionId,
    questionReplyBusy,
    setQuestionReplyBusy,
    questionReplyBusyRef,
    pendingAgent,
  };
}
