export type ComputerUseActivityPhase =
  | "inactive"
  | "ready"
  | "running"
  | "paused"
  | "errored";

export type ComputerUseActivityTransition =
  | "started"
  | "paused"
  | "resumed"
  | "finished"
  | "errored";

export function computerUseActivityTransition(
  previous: ComputerUseActivityPhase | undefined,
  current: ComputerUseActivityPhase,
): ComputerUseActivityTransition | null {
  if (previous === undefined || previous === current) return null;
  if (current === "errored") return "errored";
  if (current === "paused") return "paused";
  if (current === "running") {
    return previous === "paused" ? "resumed" : "started";
  }
  if (
    (current === "ready" || current === "inactive") &&
    (previous === "running" || previous === "paused")
  ) {
    return "finished";
  }
  return null;
}

export type ComputerUsePermissionState = {
  accessibility: boolean;
  screenRecording: boolean;
};

export function computerUsePermissionTransition(
  previous: ComputerUsePermissionState | undefined,
  current: ComputerUsePermissionState,
): boolean {
  if (!previous) return false;
  const wasGranted = previous.accessibility && previous.screenRecording;
  const isGranted = current.accessibility && current.screenRecording;
  return wasGranted && !isGranted;
}
