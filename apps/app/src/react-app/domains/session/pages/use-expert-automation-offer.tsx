/** @jsxImportSource react */
/**
 * Expert-session automation offer: scan proposals after a turn, host questions, create flow.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AutomationTaskInput } from "@onmyagent/types";

import { t } from "../../../../i18n";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type { PendingQuestion, SidebarSessionItem } from "../../../../app/types";
import type { OpenTarget } from "../artifacts/open-target";
import {
  automationProposalsFingerprint,
  createAutomationsFromPayloads,
  loadAutomationProposals,
} from "../artifacts/apply-automation-proposals";
import { AutomationCreateResultCard } from "../artifacts/automation-create-result-card";
import { writeAutomationFocus } from "../artifacts/automation-focus-memory";
import {
  applyAutomationOfferAnswer,
  buildAutomationOfferQuestion,
  buildCreatePayloadsFromDrafts,
  createIdleAutomationOfferFlow,
  finalizeAutomationCreateResult,
  isHostAutomationQuestionId,
  startAutomationOfferFlow,
  toHostPendingQuestion,
  type AutomationOfferFlowState,
  type AutomationOfferLabels,
} from "../artifacts/expert-automation-offer-flow";
import { writeAssistantSelectionMemory } from "../sidebar/session-chrome";
import {
  writeAssistantCategoryMemory,
  writeRailView,
} from "../sidebar/rail-navigation-memory";
import { isStreamingSessionStatus } from "../sidebar/utils";
import { useStatusToasts } from "../../shell-feedback";

export type UseExpertAutomationOfferInput = {
  onmyagentServerClient: OnMyAgentServerClient | null;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  runtimeWorkspaceId: string | null;
  selectedSessionId: string | null;
  selectedModel?: AutomationTaskInput["model"];
  draftSessionActive: boolean;
  draftAgentId: string | null;
  activeDraftSessionId: string | null;
  codeWorkspaceCatalogRoot: string;
  rawWorkspaceSessions: SidebarSessionItem[];
  currentAgentSessions: SidebarSessionItem[];
  openTargets: OpenTarget[];
  activeQuestion?: PendingQuestion | null;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  sessionStatusById: Record<string, string>;
  onNavigateToMode: (mode: "assistant" | "expert") => void;
};

export type UseExpertAutomationOfferResult = {
  automationOfferFlow: AutomationOfferFlowState;
  effectiveActiveQuestion: PendingQuestion | null | undefined;
  effectiveRespondQuestion: (requestID: string, answers: string[][]) => void;
  automationResultAccessory: ReactNode;
  openCreatedAutomation: (row: { id: string; scene: "office" | "code" }) => void;
};

export function useExpertAutomationOffer(
  input: UseExpertAutomationOfferInput,
): UseExpertAutomationOfferResult {
  const { showToast } = useStatusToasts();

  const [automationOfferFlow, setAutomationOfferFlow] =
    useState<AutomationOfferFlowState>(() => createIdleAutomationOfferFlow());
  const offeredAutomationFingerprintRef = useRef("");
  const automationOfferScopeRef = useRef("");
  const wasExpertSessionBusyRef = useRef(false);
  const automationOfferFlowRef = useRef(automationOfferFlow);
  automationOfferFlowRef.current = automationOfferFlow;

  const automationOfferScopeKey =
    input.selectedSessionId?.trim() ||
    (input.draftSessionActive && input.draftAgentId
      ? `draft:${input.draftAgentId}`
      : "");

  const automationOfferLabels = useMemo<AutomationOfferLabels>(
    () => ({
      offerHeader: t("session.automation_offer_header"),
      offerQuestion: (count, titles) =>
        t("session.automation_offer_question", { count, titles }),
      optAutoCreate: t("session.automation_opt_auto_create"),
      optAutoCreateDesc: t("session.automation_opt_auto_create_desc"),
      optSkip: t("session.automation_opt_skip"),
      optSkipDesc: t("session.automation_opt_skip_desc"),
      requiredHeader: t("session.automation_required_header"),
      requiredTitleQuestion: (task) =>
        t("session.automation_required_title_q", { task }),
      requiredPromptQuestion: (task) =>
        t("session.automation_required_prompt_q", { task }),
      requiredTimeQuestion: (task) =>
        t("session.automation_required_time_q", { task }),
      optionalHeader: t("session.automation_optional_header"),
      optionalQuestion: t("session.automation_optional_question"),
      optOptionalYes: t("session.automation_opt_optional_yes"),
      optOptionalYesDesc: t("session.automation_opt_optional_yes_desc"),
      optOptionalNo: t("session.automation_opt_optional_no"),
      optOptionalNoDesc: t("session.automation_opt_optional_no_desc"),
      optionalTimezoneQuestion: t("session.automation_optional_timezone_q"),
      confirmHeader: t("session.automation_confirm_header"),
      confirmQuestion: (count, summary) =>
        t("session.automation_confirm_question", { count, summary }),
      optConfirm: t("session.automation_opt_confirm"),
      optConfirmDesc: t("session.automation_opt_confirm_desc"),
      optCancel: t("session.automation_opt_cancel"),
      optCancelDesc: t("session.automation_opt_cancel_desc"),
      customAnswerLabel: t("question_modal.custom_answer_label"),
    }),
    [],
  );

  const resolveAutomationSessionDirectory = useCallback(() => {
    const selectedSession =
      input.rawWorkspaceSessions.find(
        (session) => session.id === input.selectedSessionId,
      ) ??
      input.currentAgentSessions.find(
        (session) => session.id === input.selectedSessionId,
      ) ??
      null;
    return {
      sessionDirectory: selectedSession?.directory ?? null,
      workspaceId:
        input.runtimeWorkspaceId?.trim() || input.selectedWorkspaceId.trim(),
    };
  }, [
    input.currentAgentSessions,
    input.runtimeWorkspaceId,
    input.selectedSessionId,
    input.selectedWorkspaceId,
    input.rawWorkspaceSessions,
  ]);

  const clearAutomationOffer = useCallback(() => {
    offeredAutomationFingerprintRef.current = "";
    automationOfferScopeRef.current = "";
    wasExpertSessionBusyRef.current = false;
    setAutomationOfferFlow(createIdleAutomationOfferFlow());
  }, []);

  // Isolate offer UI to the session/agent that produced it.
  useEffect(() => {
    if (!automationOfferScopeKey) {
      clearAutomationOffer();
      return;
    }
    if (
      automationOfferScopeRef.current &&
      automationOfferScopeRef.current !== automationOfferScopeKey
    ) {
      clearAutomationOffer();
    }
  }, [automationOfferScopeKey, clearAutomationOffer]);

  const scanAutomationProposals = useCallback(async () => {
    const client = input.onmyagentServerClient;
    const { workspaceId, sessionDirectory } = resolveAutomationSessionDirectory();
    if (!client || !workspaceId) return;
    // Never offer on a different expert's empty home / draft without a real session.
    if (!input.selectedSessionId?.trim() || !sessionDirectory?.trim()) return;
    if (input.activeQuestion) return;
    const scopeKey = input.selectedSessionId.trim();
    const currentPhase = automationOfferFlowRef.current.phase;
    if (
      currentPhase !== "idle" &&
      currentPhase !== "dismissed" &&
      currentPhase !== "result" &&
      automationOfferScopeRef.current === scopeKey
    ) {
      return;
    }
    try {
      const loaded = await loadAutomationProposals({
        client,
        workspaceId,
        catalogRoot: input.codeWorkspaceCatalogRoot,
        sessionRoot: input.selectedWorkspaceRoot,
        sessionDirectory,
        // Session-only: do not pull another expert's workspace-global proposals.
        includeWorkspaceRoot: false,
      });
      if (loaded.proposals.length === 0) return;
      // Scope may have changed while the scan was in flight.
      if (input.selectedSessionId?.trim() !== scopeKey) return;
      const fingerprint = automationProposalsFingerprint(loaded.proposals);
      if (
        fingerprint === offeredAutomationFingerprintRef.current &&
        automationOfferScopeRef.current === scopeKey
      ) {
        return;
      }
      offeredAutomationFingerprintRef.current = fingerprint;
      automationOfferScopeRef.current = scopeKey;
      setAutomationOfferFlow(
        startAutomationOfferFlow({
          proposals: loaded.proposals,
          fingerprint,
        }),
      );
    } catch {
      // Silent: proposal scan is best-effort after a turn.
    }
  }, [
    input.activeQuestion,
    input.codeWorkspaceCatalogRoot,
    input.onmyagentServerClient,
    input.selectedSessionId,
    input.selectedWorkspaceRoot,
    resolveAutomationSessionDirectory,
  ]);

  const activeExpertSessionId = input.draftSessionActive
    ? input.activeDraftSessionId
    : input.selectedSessionId;
  const expertSessionBusy = isStreamingSessionStatus(
    activeExpertSessionId
      ? input.sessionStatusById?.[activeExpertSessionId]
      : undefined,
  );

  useEffect(() => {
    if (expertSessionBusy) {
      wasExpertSessionBusyRef.current = true;
      return;
    }
    if (!wasExpertSessionBusyRef.current) return;
    wasExpertSessionBusyRef.current = false;
    void scanAutomationProposals();
  }, [expertSessionBusy, scanAutomationProposals]);

  // Also offer when files panel discovers proposal paths (export may finish after idle).
  useEffect(() => {
    if (!input.selectedSessionId?.trim()) return;
    const hasProposalTarget = input.openTargets.some((target) =>
      target.value.replace(/\\/g, "/").includes("automations/proposals/"),
    );
    if (!hasProposalTarget || expertSessionBusy) return;
    void scanAutomationProposals();
  }, [
    expertSessionBusy,
    input.openTargets,
    input.selectedSessionId,
    scanAutomationProposals,
  ]);

  const runAutomationCreate = useCallback(
    async (flow: AutomationOfferFlowState) => {
      const client = input.onmyagentServerClient;
      const { workspaceId, sessionDirectory } =
        resolveAutomationSessionDirectory();
      if (!client || !workspaceId) {
        setAutomationOfferFlow((current) => ({
          ...current,
          busy: false,
          phase: "dismissed",
        }));
        return;
      }
      const items = buildCreatePayloadsFromDrafts(flow.drafts);
      if (items.length === 0) {
        showToast({
          tone: "warning",
          title: t("session.automation_configure_empty"),
        });
        setAutomationOfferFlow((current) => ({
          ...current,
          busy: false,
          phase: "dismissed",
        }));
        return;
      }
      try {
        const result = await createAutomationsFromPayloads({
          client,
          workspaceId,
          items,
          defaultModel: input.selectedModel,
          defaultWorkspaceDirectory: sessionDirectory,
          sourceSessionId: input.selectedSessionId,
        });
        if (result.created.length > 0) {
          showToast({
            tone: "success",
            title: t("session.automation_proposals_created", {
              count: result.created.length,
              titles: result.created.map((item) => item.title).join(", "),
            }),
          });
        } else if (result.errors.length > 0) {
          showToast({
            tone: "error",
            title: t("session.automation_proposals_create_failed", {
              message: result.errors[0]?.message ?? "unknown",
            }),
          });
        } else if (result.skipped.length > 0) {
          showToast({
            tone: "info",
            title: t("session.automation_proposals_all_skipped", {
              count: result.skipped.length,
            }),
          });
        }
        setAutomationOfferFlow(
          finalizeAutomationCreateResult({
            state: flow,
            result,
            drafts: flow.drafts,
          }),
        );
      } catch (error) {
        showToast({
          tone: "error",
          title: t("session.automation_proposals_create_failed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        });
        setAutomationOfferFlow((current) => ({
          ...current,
          busy: false,
          phase: "confirm",
        }));
      }
    },
    [
      input.onmyagentServerClient,
      input.selectedModel,
      input.selectedSessionId,
      resolveAutomationSessionDirectory,
      showToast,
    ],
  );

  const handleHostAutomationAnswer = useCallback(
    (answers: string[][]) => {
      const decided = applyAutomationOfferAnswer({
        state: automationOfferFlowRef.current,
        answers,
        labels: automationOfferLabels,
      });
      if (decided.kind === "create") {
        setAutomationOfferFlow(decided.state);
        void runAutomationCreate(decided.state);
        return;
      }
      setAutomationOfferFlow(decided.state);
    },
    [automationOfferLabels, runAutomationCreate],
  );

  const hostAutomationQuestion = useMemo(() => {
    // Only inject the offer into the session that owns it (never another expert's draft home).
    const scope = input.selectedSessionId?.trim() ?? "";
    if (!scope || scope !== automationOfferScopeRef.current) return null;
    if (
      automationOfferFlow.phase === "idle" ||
      automationOfferFlow.phase === "dismissed"
    ) {
      return null;
    }
    const question = buildAutomationOfferQuestion(
      automationOfferFlow,
      automationOfferLabels,
    );
    if (!question) return null;
    return toHostPendingQuestion({ sessionId: scope, question });
  }, [
    automationOfferFlow,
    automationOfferLabels,
    input.selectedSessionId,
  ]);

  const effectiveActiveQuestion =
    !input.activeQuestion && hostAutomationQuestion
      ? hostAutomationQuestion
      : input.activeQuestion;

  const effectiveRespondQuestion = useCallback(
    (requestID: string, answers: string[][]) => {
      if (isHostAutomationQuestionId(requestID)) {
        handleHostAutomationAnswer(answers);
        return;
      }
      input.respondQuestion?.(requestID, answers);
    },
    [handleHostAutomationAnswer, input.respondQuestion],
  );

  const openCreatedAutomation = useCallback(
    (row: { id: string; scene: "office" | "code" }) => {
      const workspaceId = input.selectedWorkspaceId.trim();
      if (!workspaceId) return;
      writeAutomationFocus({
        workspaceId,
        automationId: row.id,
        scene: row.scene,
      });
      writeAssistantCategoryMemory(workspaceId, row.scene);
      writeAssistantSelectionMemory(workspaceId, row.scene, {
        kind: "automation",
      });
      writeRailView("assistant", workspaceId, "scheduledTasks");
      input.onNavigateToMode("assistant");
    },
    [input.onNavigateToMode, input.selectedWorkspaceId],
  );

  const automationResultAccessory =
    automationOfferFlow.phase === "result" &&
    automationOfferFlow.resultRows.length > 0 &&
    input.selectedSessionId?.trim() === automationOfferScopeRef.current ? (
      <AutomationCreateResultCard
        rows={automationOfferFlow.resultRows}
        onView={(row) => openCreatedAutomation(row)}
        onDismiss={() =>
          setAutomationOfferFlow((current) => ({
            ...current,
            phase: "dismissed",
            resultRows: [],
          }))
        }
      />
    ) : null;

  return {
    automationOfferFlow,
    effectiveActiveQuestion,
    effectiveRespondQuestion,
    automationResultAccessory,
    openCreatedAutomation,
  };
}
