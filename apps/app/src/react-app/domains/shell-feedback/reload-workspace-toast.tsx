/** @jsxImportSource react */
import { RefreshCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloatingToastFrame } from "./floating-toast-frame";
import type { ReloadTrigger } from "../../../app/types";

export type ReloadWorkspaceToastProps = {
  open: boolean;
  title: string;
  description: string;
  trigger?: ReloadTrigger | null;
  warning?: string;
  blockedReason?: string | null;
  error?: string | null;
  reloadLabel: string;
  dismissLabel: string;
  busy?: boolean;
  canReload: boolean;
  hasActiveRuns: boolean;
  onReload: () => void;
  onDismiss: () => void;
};

function describeTrigger(
  description: string,
  trigger?: ReloadTrigger | null,
): string {
  if (!trigger) return description;
  const { type, name, action } = trigger;
  const trimmedName = name?.trim();
  const verb =
    action === "removed"
      ? "was removed"
      : action === "added"
        ? "was added"
        : action === "updated"
          ? "was updated"
          : "changed";

  if (type === "skill") {
    return trimmedName
      ? `Skill '${trimmedName}' ${verb}. Reload to use it.`
      : "Skills changed. Reload to apply.";
  }
  if (type === "plugin") {
    return trimmedName
      ? `Plugin '${trimmedName}' ${verb}. Reload to activate.`
      : "Plugins changed. Reload to apply.";
  }
  if (type === "mcp") {
    return trimmedName
      ? `MCP '${trimmedName}' ${verb}. Reload to connect.`
      : "MCP config changed. Reload to apply.";
  }
  if (type === "config") {
    return trimmedName
      ? `Config '${trimmedName}' ${verb}. Reload to apply.`
      : "Config changed. Reload to apply.";
  }
  if (type === "agent") {
    return trimmedName
      ? `Agent '${trimmedName}' ${verb}. Reload to use it.`
      : "Agents changed. Reload to apply.";
  }
  if (type === "command") {
    return trimmedName
      ? `Command '${trimmedName}' ${verb}. Reload to use it.`
      : "Commands changed. Reload to apply.";
  }
  return "Config changed. Reload to apply.";
}

const reloadWorkspaceToastClass = {
  icon: "text-dls-text",
  warningIcon: "text-dls-status-warning",
  message: "min-w-0 text-sm text-dls-text",
  title: "font-medium",
  errorText: "text-dls-status-danger-fg",
  warningText: "text-dls-status-warning",
  reloadButton: "h-auto px-0 align-baseline font-medium text-dls-text underline-offset-2 hover:text-dls-text/80 disabled:cursor-not-allowed disabled:opacity-60",
  dismissButton: "shrink-0 rounded-full text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
};

export function ReloadWorkspaceToast(props: ReloadWorkspaceToastProps) {
  if (!props.open) return null;

  const message = props.hasActiveRuns
    ? "Reloading will stop active tasks."
    : props.error
      ? props.error
      : describeTrigger(props.description, props.trigger);

  return (
    <FloatingToastFrame>
        <div className={props.hasActiveRuns ? reloadWorkspaceToastClass.warningIcon : reloadWorkspaceToastClass.icon}>
          <RefreshCcw
            size={16}
            className={props.busy ? "animate-spin" : undefined}
          />
        </div>

        <div className={reloadWorkspaceToastClass.message}>
          <span className={reloadWorkspaceToastClass.title}>{props.title}</span>{" "}
          <span className={props.error ? reloadWorkspaceToastClass.errorText : props.hasActiveRuns ? reloadWorkspaceToastClass.warningText : undefined}>
            {message}
          </span>{" "}
          <Button
            type="button"
            variant="link"
            size="xs"
            className={reloadWorkspaceToastClass.reloadButton}
            onClick={() => props.onReload()}
            disabled={props.busy || !props.canReload}
          >
            {props.reloadLabel}
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={reloadWorkspaceToastClass.dismissButton}
          onClick={() => props.onDismiss()}
          aria-label={props.dismissLabel}
        >
          <X size={14} />
        </Button>
    </FloatingToastFrame>
  );
}
