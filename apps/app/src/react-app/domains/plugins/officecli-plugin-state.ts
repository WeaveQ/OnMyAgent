import type { OfficeCliStatus } from "@onmyagent/types/officecli";

export type OfficeCliPrimaryAction = "install" | "update" | "retry";
export type OfficeCliStatusTone = "danger" | "neutral" | "success" | "warning";

export function getOfficeCliPrimaryAction(
  status: OfficeCliStatus,
): OfficeCliPrimaryAction | null {
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

export function isOfficeCliBusy(status: OfficeCliStatus): boolean {
  return (
    status.state === "checking" ||
    status.state === "installing" ||
    status.state === "uninstalling" ||
    status.state === "updating"
  );
}

export function canUninstallOfficeCli(status: OfficeCliStatus): boolean {
  return status.supported && Boolean(status.installedVersion) && !isOfficeCliBusy(status);
}

export function getOfficeCliStatusTone(
  status: OfficeCliStatus,
): OfficeCliStatusTone {
  if (status.state === "unsupported" || status.state === "error") return "danger";
  if (status.state === "update_available") return "warning";
  if (status.state === "installed") return "success";
  return "neutral";
}
