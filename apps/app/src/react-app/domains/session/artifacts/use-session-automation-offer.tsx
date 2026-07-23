/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutomationTaskInput } from "@onmyagent/types";

import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type { PendingQuestion } from "../../../../app/types";
import { t } from "../../../../i18n";
import { useStatusToasts } from "../../shell-feedback";
import type { OpenTarget } from "./open-target";
import { AutomationCreateResultCard } from "./automation-create-result-card";
import {
  automationProposalsFingerprint,
  createAutomationsFromPayloads,
  loadNewAutomationProposals,
} from "./apply-automation-proposals";
import {
  applyAutomationOfferAnswer,
  buildAutomationOfferQuestion,
  buildCreatePayloadsFromDrafts,
  createIdleAutomationOfferFlow,
  finalizeAutomationCreateResult,
  isHostAutomationQuestionId,
  startAutomationOfferFlow,
  toHostPendingQuestion,
  type AutomationCreateResultRow,
  type AutomationOfferFlowState,
  type AutomationOfferLabels,
} from "./expert-automation-offer-flow";

export function useSessionAutomationOffer(input: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  catalogRoot: string;
  sessionRoot: string;
  selectedSessionId: string | null;
  sessionDirectory: string | null;
  selectedModel?: AutomationTaskInput["model"];
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  sessionBusy: boolean;
  openTargets: readonly OpenTarget[];
  onViewCreatedAutomation: (row: AutomationCreateResultRow) => void;
}) {
  const { showToast } = useStatusToasts();
  const [flow, setFlow] = useState<AutomationOfferFlowState>(() =>
    createIdleAutomationOfferFlow(),
  );
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const offeredFingerprintRef = useRef("");
  const offerScopeRef = useRef("");
  const wasSessionBusyRef = useRef(false);
  const scopeKey = input.selectedSessionId?.trim() ?? "";

  const labels = useMemo<AutomationOfferLabels>(
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

  const clearOffer = useCallback(() => {
    offeredFingerprintRef.current = "";
    offerScopeRef.current = "";
    wasSessionBusyRef.current = false;
    setFlow(createIdleAutomationOfferFlow());
  }, []);

  useEffect(() => {
    if (!scopeKey) {
      clearOffer();
      return;
    }
    if (offerScopeRef.current && offerScopeRef.current !== scopeKey) {
      clearOffer();
    }
  }, [clearOffer, scopeKey]);

  const scanProposals = useCallback(async () => {
    const workspaceId = input.workspaceId.trim();
    const sessionDirectory = input.sessionDirectory?.trim() ?? "";
    if (
      !input.client ||
      !workspaceId ||
      !scopeKey ||
      !sessionDirectory ||
      input.activeQuestion
    ) {
      return;
    }
    const currentPhase = flowRef.current.phase;
    if (
      currentPhase !== "idle" &&
      currentPhase !== "dismissed" &&
      currentPhase !== "result" &&
      offerScopeRef.current === scopeKey
    ) {
      return;
    }
    try {
      const loaded = await loadNewAutomationProposals({
        client: input.client,
        workspaceId,
        catalogRoot: input.catalogRoot,
        sessionRoot: input.sessionRoot,
        sessionDirectory,
        includeWorkspaceRoot: false,
      });
      if (loaded.proposals.length === 0 || input.selectedSessionId?.trim() !== scopeKey) {
        if (loaded.proposals.length === 0 && flowRef.current.phase === "idle") {
          offeredFingerprintRef.current = "all-existing";
          offerScopeRef.current = scopeKey;
        }
        return;
      }
      const fingerprint = automationProposalsFingerprint(loaded.proposals);
      if (
        fingerprint === offeredFingerprintRef.current &&
        offerScopeRef.current === scopeKey
      ) {
        return;
      }
      offeredFingerprintRef.current = fingerprint;
      offerScopeRef.current = scopeKey;
      setFlow(startAutomationOfferFlow({ proposals: loaded.proposals, fingerprint }));
    } catch {
      // Proposal discovery is best-effort after a conversation turn.
    }
  }, [
    input.activeQuestion,
    input.catalogRoot,
    input.client,
    input.selectedSessionId,
    input.sessionDirectory,
    input.sessionRoot,
    input.workspaceId,
    scopeKey,
  ]);

  useEffect(() => {
    if (input.sessionBusy) {
      wasSessionBusyRef.current = true;
      return;
    }
    if (!wasSessionBusyRef.current) return;
    wasSessionBusyRef.current = false;
    void scanProposals();
  }, [input.sessionBusy, scanProposals]);

  useEffect(() => {
    if (!scopeKey || input.sessionBusy) return;
    const hasProposalTarget = input.openTargets.some((target) =>
      target.value.replace(/\\/g, "/").includes("automations/proposals/"),
    );
    if (hasProposalTarget) void scanProposals();
  }, [input.openTargets, input.sessionBusy, scanProposals, scopeKey]);

  const createFromFlow = useCallback(
    async (nextFlow: AutomationOfferFlowState) => {
      const workspaceId = input.workspaceId.trim();
      const sessionDirectory = input.sessionDirectory?.trim() ?? "";
      if (!input.client || !workspaceId || !scopeKey || !sessionDirectory) {
        setFlow((current) => ({ ...current, busy: false, phase: "dismissed" }));
        return;
      }
      const items = buildCreatePayloadsFromDrafts(nextFlow.drafts);
      if (items.length === 0) {
        showToast({ tone: "warning", title: t("session.automation_configure_empty") });
        setFlow((current) => ({ ...current, busy: false, phase: "dismissed" }));
        return;
      }
      try {
        const result = await createAutomationsFromPayloads({
          client: input.client,
          workspaceId,
          items,
          defaultModel: input.selectedModel,
          defaultWorkspaceDirectory: sessionDirectory,
          sourceSessionId: scopeKey,
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
        setFlow(
          finalizeAutomationCreateResult({
            state: nextFlow,
            result,
            drafts: nextFlow.drafts,
          }),
        );
      } catch (error) {
        showToast({
          tone: "error",
          title: t("session.automation_proposals_create_failed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        });
        setFlow((current) => ({ ...current, busy: false, phase: "confirm" }));
      }
    },
    [
      input.client,
      input.selectedModel,
      input.sessionDirectory,
      input.workspaceId,
      scopeKey,
      showToast,
    ],
  );

  const respondToQuestion = useCallback(
    (requestID: string, answers: string[][]) => {
      if (!isHostAutomationQuestionId(requestID)) {
        input.respondQuestion?.(requestID, answers);
        return;
      }
      const decided = applyAutomationOfferAnswer({
        state: flowRef.current,
        answers,
        labels,
      });
      setFlow(decided.state);
      if (decided.kind === "create") void createFromFlow(decided.state);
    },
    [createFromFlow, input.respondQuestion, labels],
  );

  const hostQuestion = useMemo(() => {
    if (
      !scopeKey ||
      flow.phase === "idle" ||
      flow.phase === "dismissed" ||
      flow.phase === "result"
    ) {
      return null;
    }
    const question = buildAutomationOfferQuestion(flow, labels);
    return question
      ? toHostPendingQuestion({ sessionId: scopeKey, question })
      : null;
  }, [flow, labels, scopeKey]);

  const resultAccessory =
    flow.phase === "result" &&
    flow.resultRows.length > 0 &&
    scopeKey === offerScopeRef.current ? (
      <AutomationCreateResultCard
        rows={flow.resultRows}
        onView={input.onViewCreatedAutomation}
        onDismiss={() =>
          setFlow((current) => ({
            ...current,
            phase: "dismissed",
            resultRows: [],
          }))
        }
      />
    ) : null;

  return {
    activeQuestion:
      !input.activeQuestion && hostQuestion ? hostQuestion : input.activeQuestion,
    questionReplyBusy: Boolean(input.questionReplyBusy || flow.busy),
    respondQuestion: respondToQuestion,
    resultAccessory,
  };
}
