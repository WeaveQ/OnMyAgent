import type { TencentDocsConnectionStatus } from "@onmyagent/types/tencent-docs-connector";
import type { StatusBadgeTone } from "@/components/ui/status-badge";

export function isTencentDocsBusy(
  status: TencentDocsConnectionStatus | null,
): boolean {
  if (!status) return true;
  return status.phase === "busy" || status.phase === "authorizing";
}

export function getTencentDocsStatusTone(
  status: TencentDocsConnectionStatus,
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

export type TencentDocsPrimaryAction = "connect" | "retry";

export function getTencentDocsPrimaryAction(
  status: TencentDocsConnectionStatus | null,
): TencentDocsPrimaryAction | null {
  if (!status) return null;
  // Already authorized — never push "retry" for ghost oauth_timeout on the card.
  if (status.authorized) return null;
  if (status.phase === "error") return "retry";
  if (status.phase === "disconnected") return "connect";
  if (status.phase === "connected" && !status.authorized) return "connect";
  return null;
}

export function canDisconnectTencentDocs(
  status: TencentDocsConnectionStatus | null,
): boolean {
  if (!status) return false;
  return (
    status.phase === "connected" ||
    status.authorized ||
    status.mcpConfigured ||
    status.skillInstalled
  );
}
