/** @jsxImportSource react */
import { useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { t } from "../../../../../i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  AgentManagementAgent,
  AgentManagementInstallationEntry,
  AgentManagementInstallationReport,
} from "../../../../../app/lib/desktop-types";
import { AGENT_MANAGER_PROVIDER_LABELS } from "./agent-management-providers";

interface AgentManagementUpdateConfirmDialogProps {
  agent: AgentManagementAgent | null;
  report: AgentManagementInstallationReport | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (install: AgentManagementInstallationEntry | null) => void;
}

export function AgentManagementUpdateConfirmDialog(
  props: AgentManagementUpdateConfirmDialogProps,
) {
  const { agent, report, loading, onOpenChange, onConfirm } = props;
  const providerLabel = agent ? AGENT_MANAGER_PROVIDER_LABELS[agent.provider] ?? agent.provider : "";
  const defaultInstall = report?.installs.find((i) => i.isPathDefault && i.runnable)
    ?? report?.installs.find((i) => i.runnable)
    ?? report?.installs[0]
    ?? null;
  const [selectedPath, setSelectedPath] = useState<string | null>(defaultInstall?.path ?? null);
  const selectedInstall = report?.installs.find((i) => i.path === selectedPath) ?? defaultInstall;

  const open = Boolean(agent);
  const hasConflict = Boolean(report?.isConflict);
  const bundled = selectedInstall?.bundled ?? false;
  const command = report?.command ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("agent_manager.update.confirm_title", { name: providerLabel })}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-dls-secondary">{t("agent_manager.update.confirm_body")}</p>

        {hasConflict ? (
          <NoticeBox className="mt-3 flex items-start gap-2" tone="warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{t("agent_manager.update.conflict_warning")}</span>
          </NoticeBox>
        ) : null}

        {report?.installs?.length ? (
          <div className="mt-3 rounded-lg border border-dls-border bg-dls-surface">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 text-xs font-medium text-dls-secondary">
              <span>{t("agent_manager.update.installation_column_path")}</span>
              <span>{t("agent_manager.update.installation_column_source")}</span>
              <span>{t("agent_manager.update.installation_column_version")}</span>
            </div>
            <ul className="divide-y divide-dls-border">
              {report.installs.map((install) => {
                const active = install.path === (selectedPath ?? defaultInstall?.path);
                return (
                  <li key={install.path}>
                    <button
                      type="button"
                      className={
                        "grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 text-left text-xs " +
                        (active ? "bg-dls-surface-muted" : "hover:bg-dls-surface-muted")
                      }
                      onClick={() => setSelectedPath(install.path)}
                    >
                      <span className="truncate font-mono text-dls-text">{install.path}</span>
                      <StatusBadge tone={install.bundled ? "accent" : "neutral"}>{install.source}</StatusBadge>
                      <span className="text-dls-secondary">{install.version ?? "-"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {bundled ? (
          <NoticeBox className="mt-3" tone="info">
            {t("agent_manager.update.bundled_readonly")}
          </NoticeBox>
        ) : null}

        {command ? (
          <pre className="mt-3 max-h-32 overflow-auto rounded-md border border-dls-border bg-dls-surface-muted px-3 py-2 text-xs text-dls-text">
{command}
          </pre>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("agent_manager.update.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={loading || bundled || !command}
            onClick={() => onConfirm(selectedInstall ?? null)}
          >
            <ExternalLink className="mr-1.5 size-3.5" />
            {t("agent_manager.update.open_in_terminal")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
