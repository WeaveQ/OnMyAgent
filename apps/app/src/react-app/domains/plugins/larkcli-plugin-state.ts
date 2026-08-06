import type { OfficeCliStatus } from "@onmyagent/types/officecli";

export type LarkCliPrimaryAction = "install" | "update" | "retry";
export type LarkCliStatusTone = "danger" | "neutral" | "success" | "warning";

export function getLarkCliPrimaryAction(
  status: OfficeCliStatus,
): LarkCliPrimaryAction | null {
  if (!status.supported || status.state === "unsupported") return null;

  switch (status.state) {
    case "not_installed":
      return "install";
    case "update_available":
      return "update";
    case "error":
      return "retry";
    default:
      return null;
  }
}

export function isLarkCliBusy(status: OfficeCliStatus): boolean {
  return (
    status.state === "checking" ||
    status.state === "installing" ||
    status.state === "uninstalling" ||
    status.state === "updating"
  );
}

export function canUninstallLarkCli(status: OfficeCliStatus): boolean {
  return status.supported && Boolean(status.installedVersion) && !isLarkCliBusy(status);
}

export function getLarkCliStatusTone(
  status: OfficeCliStatus,
): LarkCliStatusTone {
  if (status.state === "unsupported" || status.state === "error") return "danger";
  if (status.state === "update_available") return "warning";
  if (status.state === "installed") return "success";
  return "neutral";
}
