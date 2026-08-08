import type { DingtalkConnectionStatus } from "@onmyagent/types/dingtalk-connector";
import type { StatusBadgeTone } from "@/components/ui/status-badge";

export function isDingtalkBusy(
  status: DingtalkConnectionStatus | null,
): boolean {
  if (!status) return true;
  return status.phase === "busy" || status.phase === "authorizing";
}

export function getDingtalkStatusTone(
  status: DingtalkConnectionStatus,
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

export type DingtalkPrimaryAction = "connect" | "retry";

export function getDingtalkPrimaryAction(
  status: DingtalkConnectionStatus | null,
): DingtalkPrimaryAction | null {
  if (!status) return null;
  if (status.authorized) return null;
  if (status.phase === "error") return "retry";
  if (status.phase === "disconnected") return "connect";
  return null;
}

export function canDisconnectDingtalk(
  status: DingtalkConnectionStatus | null,
): boolean {
  if (!status) return false;
  return (
    status.phase === "connected" || status.authorized || status.mcpConfigured
  );
}
