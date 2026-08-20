/** @jsxImportSource react */
import { HardDrive } from "lucide-react";

import { MonoLogBox } from "@/components/ui/mono-log-box";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ToolApprovalCard,
  ToolApprovalCardBody,
  ToolApprovalCardFooter,
  ToolApprovalCardHeader,
} from "@/components/ui/tool-approval-card";
import { t } from "@/i18n";
import type {
  PersonalLocalAgentApprovalDecision,
  PersonalLocalAgentApprovalRequest,
} from "../../../../app/lib/desktop";

export function LocalAgentApprovalCard(props: {
  approval: PersonalLocalAgentApprovalRequest;
  pending?: boolean;
  onResolve?: (
    approval: PersonalLocalAgentApprovalRequest,
    decision: PersonalLocalAgentApprovalDecision,
  ) => void;
}) {
  const { approval, onResolve } = props;
  const pending = props.pending ?? Boolean(onResolve);
  const risk = approval.readonly ? "safe" as const : "careful" as const;
  const command = (approval.command || approval.summary || "").trim();
  const method = approval.method?.trim() || "";
  const cwd = approval.cwd?.trim() || "";
  const title = approval.title?.trim() || t("local_agent.approval_required");

  return (
    <ToolApprovalCard
      risk={risk}
      data-testid="local-agent-approval-card"
      data-approval-id={approval.id}
      data-approval-pending={pending ? "true" : "false"}
    >
      <ToolApprovalCardHeader className="min-w-0 flex-col items-stretch gap-2 pb-0">
        {pending ? (
          <div className="text-xs font-medium leading-5 text-dls-text">
            {t("local_agent.approval_required")}
          </div>
        ) : null}
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div
            className="min-w-0 flex-1 break-words text-sm font-medium leading-5 text-dls-text"
            title={title}
          >
            {title}
          </div>
          <StatusBadge
            tone={approval.readonly ? "neutral" : "warning"}
            shape="soft"
            size="tiny"
          >
            {approval.readonly
              ? t("local_agent.approval_readonly")
              : t("local_agent.approval_side_effect")}
          </StatusBadge>
        </div>
        {method ? (
          <div className="min-w-0 break-all font-mono text-2xs leading-4 text-dls-text-tertiary" title={method}>
            {method}
          </div>
        ) : null}
      </ToolApprovalCardHeader>
      <ToolApprovalCardBody className="min-w-0 space-y-2">
        {command ? (
          <MonoLogBox
            wrap="preBreak"
            className="max-h-32 min-w-0 overflow-auto"
            data-testid="local-agent-approval-command"
          >
            {command}
          </MonoLogBox>
        ) : null}
        {cwd ? (
          <div
            className="flex min-w-0 items-start gap-1.5 font-mono text-2xs leading-4 text-dls-text-tertiary"
            title={cwd}
          >
            <HardDrive className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 break-all">{cwd}</span>
          </div>
        ) : null}
      </ToolApprovalCardBody>
      {pending && onResolve ? (
        <ToolApprovalCardFooter
          risk={risk}
          denyLabel={t("local_agent.approval_decline")}
          allowOnceLabel={t("local_agent.approval_allow_once")}
          allowAlwaysLabel={t("local_agent.approval_allow_session")}
          onDeny={() => onResolve(approval, "decline")}
          onAllowOnce={() => onResolve(approval, "accept")}
          onAllowAlways={() => onResolve(approval, "acceptForSession")}
        />
      ) : null}
    </ToolApprovalCard>
  );
}
