import type { TencentMeetingConnectionStatus } from "@onmyagent/types/tencent-meeting-connector";
import type { StatusBadgeTone } from "@/components/ui/status-badge";

export function isTencentMeetingBusy(
  status: TencentMeetingConnectionStatus | null,
): boolean {
  if (!status) return true;
  return status.phase === "busy" || status.phase === "authorizing";
}

export function getTencentMeetingStatusTone(
  status: TencentMeetingConnectionStatus,
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

export type TencentMeetingPrimaryAction = "connect" | "retry";

export function getTencentMeetingPrimaryAction(
  status: TencentMeetingConnectionStatus | null,
): TencentMeetingPrimaryAction | null {
  if (!status) return null;
  if (status.authorized) return null;
  if (status.phase === "error") return "retry";
  if (status.phase === "disconnected") return "connect";
  return null;
}

export function canDisconnectTencentMeeting(
  status: TencentMeetingConnectionStatus | null,
): boolean {
  if (!status) return false;
  return (
    status.phase === "connected" ||
    status.authorized ||
    status.mcpConfigured
  );
}
