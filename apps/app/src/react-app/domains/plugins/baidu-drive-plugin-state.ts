import type { BaiduDriveConnectionStatus } from "@onmyagent/types/baidu-drive-connector";
import type { StatusBadgeTone } from "@/components/ui/status-badge";

export function isBaiduDriveBusy(
  status: BaiduDriveConnectionStatus | null,
): boolean {
  if (!status) return true;
  return status.phase === "busy" || status.phase === "authorizing";
}

export function getBaiduDriveStatusTone(
  status: BaiduDriveConnectionStatus,
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

export type BaiduDrivePrimaryAction = "connect" | "retry";

export function getBaiduDrivePrimaryAction(
  status: BaiduDriveConnectionStatus | null,
): BaiduDrivePrimaryAction | null {
  if (!status) return null;
  if (status.authorized) return null;
  if (status.phase === "error") return "retry";
  if (status.phase === "disconnected") return "connect";
  if (status.phase === "connected" && !status.authorized) return "connect";
  return null;
}

export function canDisconnectBaiduDrive(
  status: BaiduDriveConnectionStatus | null,
): boolean {
  if (!status) return false;
  return (
    status.phase === "connected" ||
    status.authorized ||
    status.mcpConfigured
  );
}
