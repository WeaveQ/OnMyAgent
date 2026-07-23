import type { TurnWidgetArtifactCopy } from "./turn-content";

export type VisualArtifactExportFormat = "pdf" | "xlsx";
export type VisualSnapshotExportFormat = "png" | "pdf";

export function resolveVisualArtifactExport(
  copies: readonly TurnWidgetArtifactCopy[],
  selectedCopyKey: string,
  format: VisualArtifactExportFormat,
): string | null {
  const copy = copies.find((candidate) => candidate.key === selectedCopyKey);
  const path = format === "pdf" ? copy?.pdf : copy?.xlsx;
  return path?.trim() || null;
}

export function visualExportFileName(
  title: string | null,
  format: VisualSnapshotExportFormat,
  fallbackTitle = "preview",
) {
  const safeTitle = (title?.trim() || fallbackTitle)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/^-+|-+$/g, "") || fallbackTitle;
  return `${safeTitle}.${format}`;
}
