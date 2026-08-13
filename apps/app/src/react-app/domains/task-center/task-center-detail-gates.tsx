/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { TaskOrchestratorHumanGate } from "@onmyagent/types";

import {
  ToolApprovalCard,
  ToolApprovalCardBody,
  ToolApprovalCardFooter,
  ToolApprovalCardHeader,
} from "@/components/ui/tool-approval-card";
import { MonoLogBox } from "@/components/ui/mono-log-box";
import { NoticeBox } from "@/components/ui/notice-box";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { formatTaskCenterTimestamp } from "./task-center-detail-shared";
import {
  taskCenterFormatDuration,
  taskCenterGateDecisionLabelKey,
  taskCenterGateLabelKey,
  taskCenterGateRiskLabelKey,
  taskCenterGateStatusLabelKey,
} from "./task-center-model";

const gateRiskTone: Record<
  TaskOrchestratorHumanGate["risk"],
  StatusBadgeTone
> = {
  safe: "neutral",
  careful: "warning",
  destructive: "danger",
};

function OperationField(props: {
  field: "method" | "kind" | "command" | "cwd" | "diff";
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-dls-secondary">
        {props.label}
      </div>
      <MonoLogBox data-operation-field={props.field} wrap="wrap">
        {props.value}
      </MonoLogBox>
    </div>
  );
}

function TaskCenterGateOperation(props: {
  gate: TaskOrchestratorHumanGate;
}) {
  const operation = props.gate.operation;
  const hasDetails = Boolean(
    operation.method ||
      operation.kind ||
      operation.command ||
      operation.cwd ||
      operation.params.length ||
      operation.diff ||
      operation.readOnly,
  );
  if (!hasDetails) return null;

  return (
    <section
      className="space-y-3"
      aria-label={t("task_center.gate_operation_details")}
    >
      <div className="text-xs font-semibold text-dls-text">
        {t("task_center.gate_operation_details")}
      </div>
      {operation.method || operation.kind ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {operation.method ? (
            <OperationField
              field="method"
              label={t("task_center.gate_operation_method")}
              value={operation.method}
            />
          ) : null}
          {operation.kind ? (
            <OperationField
              field="kind"
              label={t("task_center.gate_operation_kind")}
              value={operation.kind}
            />
          ) : null}
        </div>
      ) : null}
      {operation.command ? (
        <OperationField
          field="command"
          label={t("task_center.gate_operation_command")}
          value={operation.command}
        />
      ) : null}
      {operation.cwd ? (
        <OperationField
          field="cwd"
          label={t("task_center.gate_operation_cwd")}
          value={operation.cwd}
        />
      ) : null}
      {operation.params.length ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-dls-secondary">
            {t("task_center.gate_operation_params")}
          </div>
          <MonoLogBox
            data-operation-field="params"
            density="stacked"
            wrap="wrap"
          >
            <dl className="space-y-2">
              {operation.params.map((param, index) => (
                <div key={`${param.name}-${index}`}>
                  <dt className="font-semibold text-dls-text">{param.name}</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {param.value}
                  </dd>
                </div>
              ))}
            </dl>
          </MonoLogBox>
        </div>
      ) : null}
      {operation.diff ? (
        <OperationField
          field="diff"
          label={t("task_center.gate_operation_diff")}
          value={operation.diff}
        />
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-dls-secondary">
          {t("task_center.gate_operation_read_only")}
        </div>
        <StatusBadge
          data-operation-field="read-only"
          shape="soft"
          size="tiny"
          tone="surface"
        >
          {t(
            operation.readOnly
              ? "task_center.gate_operation_yes"
              : "task_center.gate_operation_no",
          )}
        </StatusBadge>
      </div>
    </section>
  );
}

export function TaskCenterPendingGates(props: {
  gates: TaskOrchestratorHumanGate[];
  busy: boolean;
  readOnly?: boolean;
  onResolve: (gateId: string, decision: "approve" | "reject") => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const hasExpiringGate = props.gates.some((gate) => gate.expiresAt !== null);
  useEffect(() => {
    if (!hasExpiringGate) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasExpiringGate]);
  const actionable = props.gates.filter(
    (gate) => gate.status === "pending" || gate.status === "resolving",
  );
  const audit = props.gates.filter(
    (gate) => gate.status === "approved" || gate.status === "rejected" || gate.status === "cancelled",
  );
  if (!actionable.length && !audit.length) return null;
  return (
    <div className="space-y-3" data-task-center-gates>
      {actionable.map((gate) => (
        (() => {
          const remainingMs = gate.expiresAt === null ? null : gate.expiresAt - now;
          const expired = remainingMs !== null && remainingMs <= 0;
          return <ToolApprovalCard key={gate.id} risk={gate.risk} data-task-center-gate={gate.id} data-task-center-gate-status={gate.status}>
          <ToolApprovalCardHeader>
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{gate.title}</div>
              <div className="mt-1 text-xs text-dls-secondary">
                {t(taskCenterGateLabelKey(gate.kind))}
              </div>
            </div>
            <StatusBadge
              shape="soft"
              size="sm"
              tone={gateRiskTone[gate.risk]}
            >
              {t(taskCenterGateRiskLabelKey(gate.risk))}
            </StatusBadge>
          </ToolApprovalCardHeader>
          <ToolApprovalCardBody>
            <p className="whitespace-pre-wrap text-sm leading-6">{gate.summary}</p>
            <NoticeBox data-task-center-gate-expiry={gate.id} tone={expired ? "warning" : "neutral"}>
              {gate.expiresAt === null
                ? t("task_center.gate_no_expiry")
                : expired
                  ? t("task_center.gate_expired", { expiresAt: formatTaskCenterTimestamp(gate.expiresAt) })
                  : t("task_center.gate_remaining", { remaining: taskCenterFormatDuration(remainingMs), expiresAt: formatTaskCenterTimestamp(gate.expiresAt) })}
            </NoticeBox>
            {gate.status === "resolving" && gate.decision ? (
              <NoticeBox data-gate-status="resolving" role="status" tone="info">
                {t("task_center.gate_resolving", {
                  decision: t(taskCenterGateDecisionLabelKey(gate.decision)),
                })}
              </NoticeBox>
            ) : null}
            <TaskCenterGateOperation gate={gate} />
          </ToolApprovalCardBody>
          <ToolApprovalCardFooter
            risk={gate.risk}
            denyLabel={t("task_center.reject")}
            allowOnceLabel={t("task_center.approve")}
            busy={props.readOnly || props.busy || gate.status === "resolving" || expired}
            onDeny={() => props.onResolve(gate.id, "reject")}
            onAllowOnce={() => props.onResolve(gate.id, "approve")}
          />
          </ToolApprovalCard>;
        })()
      ))}
      {audit.length ? (
        <div className="space-y-2" data-task-center-gate-audit>
          {audit.map((gate) => (
            <div key={gate.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2 text-xs" data-task-center-gate={gate.id} data-task-center-gate-status={gate.status}>
              <StatusBadge size="tiny" shape="soft" tone={gate.status === "approved" ? "success" : gate.status === "rejected" ? "danger" : "surface"}>{t(taskCenterGateStatusLabelKey(gate.status))}</StatusBadge>
              <span className="font-medium text-dls-text">{gate.title}</span>
              <span className="text-dls-secondary">{t("task_center.gate_audit_resolved", { time: formatTaskCenterTimestamp(gate.resolvedAt) })}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
