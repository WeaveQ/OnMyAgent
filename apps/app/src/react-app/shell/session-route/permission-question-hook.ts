/**
 * Active permission/question + reply handlers for the session route.
 */
import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { unwrap } from "../../../app/lib/opencode";
import type {
  Client,
  ComposerDraft,
  PendingPermission,
  PendingQuestion,
} from "../../../app/types";
import { t } from "../../../i18n";
import { getReactQueryClient } from "../../infra/query-client";
import {
  clearConsumedPermissionNotice,
  resolveAccessModePermissionReply,
} from "./composer";
import { describeRouteError } from "./model";
import {
  requiredPermissionQueryKey,
  requiredQuestionQueryKey,
} from "./state";

type Input = {
  opencodeClient: Client | null;
  pendingPermissions: PendingPermission[];
  pendingQuestions: PendingQuestion[];
  permissionReplyBusy: boolean;
  permissionReplyBusyRef: MutableRefObject<boolean>;
  questionReplyBusyRef: MutableRefObject<boolean>;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  sessionAccessModeById: Record<string, NonNullable<ComposerDraft["accessMode"]>>;
  sessionWorkspaceRoot: string;
  setAutoApprovedPermissionNoticeBySessionId: Dispatch<
    SetStateAction<Record<string, string>>
  >;
  setPermissionReplyBusy: Dispatch<SetStateAction<boolean>>;
  setQuestionReplyBusy: Dispatch<SetStateAction<boolean>>;
  showToast: (input: {
    title: string;
    description: string;
    tone: "error";
  }) => void;
  autoApprovedPermissionNoticeBySessionId: Record<string, string>;
};

export function useSessionRoutePermissionQuestionHandlers(input: Input) {
  const {
    opencodeClient,
    pendingPermissions,
    pendingQuestions,
    permissionReplyBusy,
    permissionReplyBusyRef,
    questionReplyBusyRef,
    selectedSessionId,
    selectedWorkspaceId,
    sessionAccessModeById,
    sessionWorkspaceRoot,
    setAutoApprovedPermissionNoticeBySessionId,
    setPermissionReplyBusy,
    setQuestionReplyBusy,
    showToast,
    autoApprovedPermissionNoticeBySessionId,
  } = input;

  const activePermission = pendingPermissions[0] ?? null;
  const respondPermission = useCallback(
    async (requestID: string, reply: "once" | "always" | "reject") => {
      if (!opencodeClient || !selectedWorkspaceId || !selectedSessionId) return;
      if (permissionReplyBusyRef.current) return;
      permissionReplyBusyRef.current = true;
      setPermissionReplyBusy(true);
      try {
        unwrap(
          await opencodeClient.permission.reply({
            requestID,
            reply,
            directory: sessionWorkspaceRoot || undefined,
          }),
        );
        getReactQueryClient().setQueryData<PendingPermission[]>(
          requiredPermissionQueryKey(selectedWorkspaceId, selectedSessionId),
          (current = []) =>
            current.filter((permission) => permission.id !== requestID),
        );
      } catch (error) {
        showToast({
          title: t("app.error_request_failed"),
          description: describeRouteError(error),
          tone: "error",
        });
      } finally {
        permissionReplyBusyRef.current = false;
        setPermissionReplyBusy(false);
      }
    },
    [
      opencodeClient,
      selectedSessionId,
      selectedWorkspaceId,
      sessionWorkspaceRoot,
      showToast,
    ],
  );
  useEffect(() => {
    if (!activePermission || !selectedSessionId) return;
    const permissionReply = resolveAccessModePermissionReply(
      sessionAccessModeById[selectedSessionId],
      activePermission.permission,
    );
    if (!permissionReply) return;
    if (permissionReplyBusy) return;
    setAutoApprovedPermissionNoticeBySessionId((current) => ({
      ...current,
      [selectedSessionId]: activePermission.id,
    }));
    void respondPermission(activePermission.id, permissionReply);
  }, [
    activePermission,
    permissionReplyBusy,
    respondPermission,
    selectedSessionId,
    sessionAccessModeById,
  ]);
  useEffect(() => {
    if (!selectedSessionId) return;
    setAutoApprovedPermissionNoticeBySessionId((current) => {
      return clearConsumedPermissionNotice(
        current,
        selectedSessionId,
        activePermission?.id,
      );
    });
  }, [
    activePermission?.id,
    autoApprovedPermissionNoticeBySessionId,
    selectedSessionId,
  ]);
  const activeQuestion = pendingQuestions[0] ?? null;
  const respondQuestion = useCallback(
    async (requestID: string, answers: string[][]) => {
      if (!opencodeClient || !selectedWorkspaceId || !selectedSessionId) return;
      if (questionReplyBusyRef.current) return;
      questionReplyBusyRef.current = true;
      setQuestionReplyBusy(true);
      try {
        unwrap(
          await opencodeClient.question.reply({
            requestID,
            answers,
            directory: sessionWorkspaceRoot || undefined,
          }),
        );
        getReactQueryClient().setQueryData<PendingQuestion[]>(
          requiredQuestionQueryKey(selectedWorkspaceId, selectedSessionId),
          (current = []) =>
            current.filter((question) => question.id !== requestID),
        );
      } catch (error) {
        showToast({
          title: t("app.error_request_failed"),
          description: describeRouteError(error),
          tone: "error",
        });
      } finally {
        questionReplyBusyRef.current = false;
        setQuestionReplyBusy(false);
      }
    },
    [
      opencodeClient,
      selectedSessionId,
      selectedWorkspaceId,
      sessionWorkspaceRoot,
      showToast,
    ],
  );

  return {
    activePermission,
    respondPermission,
    activeQuestion,
    respondQuestion,
  };
}
