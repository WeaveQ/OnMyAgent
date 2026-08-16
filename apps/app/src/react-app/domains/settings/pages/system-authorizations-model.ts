import type { SystemPermissionType } from "../../../../app/lib/desktop-types";

/** macOS-only TCC rows — hidden on Windows. */
export const MAC_ONLY_PERMISSIONS = new Set<SystemPermissionType>([
  "full-disk-access",
  "accessibility",
  "automation",
]);

/** Linux rows: workspace/fs, notifications, mic + accessibility as unknown. */
export const LINUX_PERMISSION_IDS: readonly SystemPermissionType[] = [
  "full-disk-access",
  "notifications",
  "microphone",
  "screen-recording",
  "accessibility",
];

export function permissionIdsForPlatform(
  platform: string | null | undefined,
  allIds: readonly SystemPermissionType[],
): SystemPermissionType[] {
  if (platform === "linux") {
    return LINUX_PERMISSION_IDS.filter((id) => allIds.includes(id));
  }
  if (platform === "windows") {
    return allIds.filter((id) => !MAC_ONLY_PERMISSIONS.has(id));
  }
  return [...allIds];
}
