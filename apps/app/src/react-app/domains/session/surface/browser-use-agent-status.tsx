import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Square } from "lucide-react";

import {
  browserUseAgentApprove,
  browserUseAgentCancel,
  browserUseAgentStatus,
} from "../../../../app/lib/desktop";
import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ToolApprovalCard,
  ToolApprovalCardBody,
  ToolApprovalCardFooter,
  ToolApprovalCardHeader,
} from "@/components/ui/tool-approval-card";
import { useBrowserUseAgentRunStore } from "../status/browser-use-agent-store";

const terminalStates = new Set(["completed", "failed", "cancelled"]);

function statusLabel(status: string): string {
  if (status === "pending_approval") return t("session.browser_use_agent_status_pending_approval");
  if (status === "completed") return t("session.browser_use_agent_status_completed");
  if (status === "failed") return t("session.browser_use_agent_status_failed");
  if (status === "cancelled") return t("session.browser_use_agent_status_cancelled");
  return t("session.browser_use_agent_status_running");
}

function phaseLabel(events: Array<Record<string, unknown>> | undefined): string | null {
  const phase = events
    ?.slice()
    .reverse()
    .find((event) => typeof event.phase === "string")?.phase;
  if (phase === "observing") return t("session.browser_use_agent_phase_observing");
  if (phase === "planning") return t("session.browser_use_agent_phase_planning");
  if (phase === "acting") return t("session.browser_use_agent_phase_acting");
  if (phase === "verifying") return t("session.browser_use_agent_phase_verifying");
  return null;
}

export function BrowserUseAgentStatus({ sessionId, modelLabel }: { sessionId: string; modelLabel: string }): React.JSX.Element | null {
  const runId = useBrowserUseAgentRunStore((state) => state.runIdsBySession[sessionId] ?? null);
  const [resolvingApproval, setResolvingApproval] = useState(false);
  const query = useQuery({
    queryKey: ["browser-use-agent", runId],
    queryFn: () => browserUseAgentStatus(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (current) => {
      const status = current.state.data?.status;
      return status && terminalStates.has(status) ? false : 1000;
    },
  });
  if (!runId) return null;
  const run = query.data;
  const status = run?.status ?? "running";
  const approval = run?.pendingApprovals[0];
  const currentPhase = phaseLabel(run?.events);
  const running = status === "running" || status === "pending_approval";
  const tone = status === "failed"
    ? "error"
    : status === "pending_approval"
      ? "warning"
      : "neutral";

  const resolveApproval = async (decision: "accept" | "reject") => {
    if (!approval) return;
    setResolvingApproval(true);
    try {
      await browserUseAgentApprove({ runId, approvalId: approval.id, decision });
      await query.refetch();
    } finally {
      setResolvingApproval(false);
    }
  };

  return (
    <div className="space-y-2 px-6 sm:px-8" role="status" aria-live="polite">
      <NoticeBox tone={tone} size="content" className="flex items-center gap-3">
        <Bot className="size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-dls-text">{t("session.browser_use_agent_title")}</span>
            <StatusBadge
              tone={status === "completed" ? "success" : status === "failed" ? "danger" : status === "pending_approval" ? "warning" : "accent"}
              shape="soft"
              size="sm"
            >
              {statusLabel(status)}
            </StatusBadge>
          </div>
          <p className="mt-1 text-dls-secondary">
            {status === "completed"
              ? String(run?.result ?? t("session.browser_use_agent_completed"))
              : status === "failed"
                ? run?.error ?? t("session.browser_use_agent_failed")
                : currentPhase ?? t("session.browser_use_agent_running")}
          </p>
          <p className="mt-1 text-xs text-dls-secondary">
            {t("session.browser_use_agent_model", { model: modelLabel })}
          </p>
        </div>
        {running ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void browserUseAgentCancel(runId).then(() => query.refetch())}
          >
            <Square className="size-3.5" aria-hidden="true" />
            {t("session.browser_use_agent_cancel")}
          </Button>
        ) : null}
        {query.isFetching && running ? <LoadingSpinner size="sm" /> : null}
      </NoticeBox>

      {approval ? (
        <ToolApprovalCard risk="careful">
          <ToolApprovalCardHeader>
            <div className="min-w-0">
              <div className="font-medium">{t("session.browser_use_agent_approval_title")}</div>
              <div className="mt-1 text-xs text-dls-secondary">{approval.summary}</div>
            </div>
          </ToolApprovalCardHeader>
          <ToolApprovalCardBody>
            <p className="text-xs text-dls-secondary">{t("session.browser_use_agent_approval_desc")}</p>
          </ToolApprovalCardBody>
          <ToolApprovalCardFooter
            risk="careful"
            busy={resolvingApproval}
            denyLabel={t("session.browser_use_agent_deny")}
            allowOnceLabel={t("session.browser_use_agent_allow_once")}
            onDeny={() => void resolveApproval("reject")}
            onAllowOnce={() => void resolveApproval("accept")}
          />
        </ToolApprovalCard>
      ) : null}
    </div>
  );
}
