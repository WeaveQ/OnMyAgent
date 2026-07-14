/** Per-session composer runtime: permissions, plan/goal, pending agent model. */
import { useEffect, useRef, useState } from "react";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerDraft,
  ModelRef,
} from "../../app/types";
import { usePendingAgentStore } from "../domains/agents";
import {
  readSessionGoalRuntimes,
  writeSessionGoalRuntimes,
} from "./session-memory";

export function useSessionRouteComposerRuntimeState() {
  const [permissionReplyBusy, setPermissionReplyBusy] = useState(false);
  const permissionReplyBusyRef = useRef(false);
  const [sessionAccessModeById, setSessionAccessModeById] = useState<
    Record<string, ComposerDraft["accessMode"]>
  >({});
  const [sessionCollaborationModeById, setSessionCollaborationModeById] =
    useState<Record<string, ComposerDraft["collaborationMode"]>>({});
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
  const pendingAgent = usePendingAgentStore((state) => state.agent);
  const [manualModelOverride, setManualModelOverride] =
    useState<ModelRef | null>(null);

  useEffect(() => {
    writeSessionGoalRuntimes(sessionGoalRuntimeById);
  }, [sessionGoalRuntimeById]);

  useEffect(() => {
    setManualModelOverride(null);
  }, [pendingAgent?.conversationStartId]);

  return {
    permissionReplyBusy,
    setPermissionReplyBusy,
    permissionReplyBusyRef,
    sessionAccessModeById,
    setSessionAccessModeById,
    sessionCollaborationModeById,
    setSessionCollaborationModeById,
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
    manualModelOverride,
    setManualModelOverride,
  };
}
