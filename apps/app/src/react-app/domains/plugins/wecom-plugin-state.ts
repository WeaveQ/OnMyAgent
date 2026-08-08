import type { WecomConnectionStatus } from "@onmyagent/types/wecom-connector";
import type { StatusBadgeTone } from "@/components/ui/status-badge";

export function isWecomBusy(status: WecomConnectionStatus | null): boolean {
  if (!status) return true;
  return status.phase === "busy" || status.phase === "authorizing";
}

export function getWecomStatusTone(
  status: WecomConnectionStatus,
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

export type WecomPrimaryAction = "connect" | "retry";

export function getWecomPrimaryAction(
  status: WecomConnectionStatus | null,
): WecomPrimaryAction | null {
  if (!status) return null;
  if (status.authorized) return null;
  if (status.phase === "error") return "retry";
  if (status.phase === "disconnected") return "connect";
  return null;
}

export function canDisconnectWecom(
  status: WecomConnectionStatus | null,
): boolean {
  if (!status) return false;
  return (
    status.phase === "connected" ||
    status.authorized ||
    status.skillInstalled
  );
}
