import type { KdocsConnectionStatus } from "@onmyagent/types/kdocs-connector";
import type { StatusBadgeTone } from "@/components/ui/status-badge";

export function isKdocsBusy(status: KdocsConnectionStatus | null): boolean {
  if (!status) return true;
  return status.phase === "busy" || status.phase === "authorizing";
}

export function getKdocsStatusTone(
  status: KdocsConnectionStatus,
): StatusBadgeTone {
  switch (status.phase) {
    case "connected":
      return "success";
    case "authorizing":
    case "busy":
      return "warning";
    case "error":
      return "danger";
    case "disconnected":
    default:
      return "neutral";
  }
}

export type KdocsPrimaryAction = "connect" | "retry";

export function getKdocsPrimaryAction(
  status: KdocsConnectionStatus | null,
): KdocsPrimaryAction | null {
  if (!status) return null;
  if (status.authorized) return null;
  if (status.phase === "error") return "retry";
  if (status.phase === "disconnected") return "connect";
  return null;
}

export function canDisconnectKdocs(
  status: KdocsConnectionStatus | null,
): boolean {
  if (!status) return false;
  return (
    status.phase === "connected" || status.authorized || status.mcpConfigured
  );
}
