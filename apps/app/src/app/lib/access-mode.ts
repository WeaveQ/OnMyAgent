import type { ComposerAccessMode } from "../types";

export function isLowRiskSessionPermission(permission: string | undefined): boolean {
  return (
    permission === "read" ||
    permission === "todowrite" ||
    permission === "question" ||
    permission === "skill"
  );
}

export function resolveAccessModePermissionReply(
  mode: ComposerAccessMode | undefined,
  permission?: string,
): "always" | null {
  if (mode === "full") return "always";
  if (mode !== "delegate") return null;
  return isLowRiskSessionPermission(permission) ? "always" : null;
}
