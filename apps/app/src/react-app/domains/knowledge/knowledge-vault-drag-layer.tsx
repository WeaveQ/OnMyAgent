/** @jsxImportSource react */
import { createPortal } from "react-dom";
import { FileText, Folder } from "lucide-react";

import { t } from "../../../i18n";

export type KnowledgeDragLayerState = {
  kind: "file" | "dir";
  name: string;
  x: number;
  y: number;
  destName: string | null;
};

let hiddenGhost: HTMLElement | null = null;

/** Suppress the OS-wide row ghost; the portal layer paints the compact preview. */
export function hideKnowledgeDragGhost(event: { dataTransfer: DataTransfer | null }): void {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  hiddenGhost?.remove();
  const ghost = document.createElement("div");
  ghost.style.cssText = "position:absolute;top:-1000px;left:-1000px;width:1px;height:1px;overflow:hidden";
  document.body.appendChild(ghost);
  transfer.setDragImage(ghost, 0, 0);
  hiddenGhost = ghost;
}

export function releaseKnowledgeDragGhost(): void {
  hiddenGhost?.remove();
  hiddenGhost = null;
}

export function KnowledgeVaultDragLayer(props: { drag: KnowledgeDragLayerState | null }) {
  if (!props.drag) return null;
  const { kind, name, x, y, destName } = props.drag;
  const Icon = kind === "dir" ? Folder : FileText;
  return createPortal(
    <div
      className="pointer-events-none fixed"
      style={{
        zIndex: "var(--dls-z-overlay-max)",
        left: x + 12,
        top: y + 8,
      }}
      aria-hidden
    >
      <div className="flex max-w-[200px] items-center gap-1.5 rounded-md border border-dls-border bg-dls-surface-solid px-2 py-1 text-sm text-dls-text">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{name}</span>
      </div>
      {destName ? (
        <div className="mt-1 w-fit max-w-xs rounded-sm border border-dls-border bg-dls-surface-solid px-2 py-1 text-xs text-dls-text">
          {t("knowledge.drop_move_to", { name: destName })}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
