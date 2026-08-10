/** @jsxImportSource react */
/**
 * Files page — Mine uploads/: catalog list, import-by-copy, folder browse,
 * hierarchical expand/collapse, drag-move, and preview/open actions.
 *
 * State lives in `use-workspace-files-uploads-panel`; presentational chrome/table
 * in `workspace-files-uploads-sections` (P1-5 file-size split).
 */
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { type OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import {
  canEditArtifactTarget,
  openArtifactForEditing,
} from "../../capabilities/artifacts/open-artifact-for-editing";
import {
  WORKSPACE_FILES_CATALOG_LIMIT,
  WORKSPACE_UPLOADS_DIR,
  workspaceRelativeForUploadRow,
} from "./workspace-files-model";
import { MineMoveToDialog } from "./workspace-files-move-dialog";
import { FilePreviewDrawer } from "./workspace-files-preview-drawer";
import {
  UploadsCreateFolderDialog,
  UploadsMineChrome,
  UploadsMineDropZone,
} from "./workspace-files-uploads-sections";
import {
  useWorkspaceFilesUploadsPanel,
  type WorkspaceFilesToastInput,
} from "./use-workspace-files-uploads-panel";

export type { WorkspaceFilesToastInput };

export function WorkspaceFilesUploadsPanel(props: {
  /** Hidden keep-alive rails retain data but must not start I/O. */
  active?: boolean;
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  /** Catalog workspace root — required for local Office preview / reveal. */
  workspaceRoot?: string;
  onAddToTask?: (relativePath: string) => void;
  onAskAgentAboutFile?: (input: {
    path: string;
    name: string;
    preview: string;
  }) => void;
  /** Optional toast host from shell/session (workspace must not import shell-feedback). */
  onToast?: (input: WorkspaceFilesToastInput) => void;
}) {
  const m = useWorkspaceFilesUploadsPanel(props);
  const selectedRow = m.selectedRow;
  const selectedTarget = m.selectedTarget;
  const previewState = m.previewState;

  // Same gutters as marketplace pluginsLayoutClass.pageContainer
  // Title/subtitle left · tools right (align task/expert); breadcrumb only when nested.
  return (
    <div className="flex h-full min-h-0 w-full flex-col px-6 pb-10 pt-3">
      <UploadsMineChrome
        canLoad={m.canLoad}
        loading={m.loading}
        uploading={m.uploading}
        refreshDone={m.refreshDone}
        createFolderBusy={m.createFolderBusy}
        filterActive={m.filterActive}
        treeMode={m.treeMode}
        treeAllExpanded={m.treeAllExpanded}
        typeFilter={m.typeFilter}
        typeMenuOpen={m.typeMenuOpen}
        query={m.query}
        showBreadcrumb={m.showBreadcrumb}
        breadcrumbSegments={m.breadcrumbSegments}
        fileInputRef={m.fileInputRef}
        onRefresh={() => {
          m.manualRefreshRef.current = true;
          m.setRefreshDone(false);
          m.setRefreshKey((key) => key + 1);
        }}
        onOpenCreateFolder={() => {
          m.setCreateFolderName("");
          m.setCreateFolderOpen(true);
        }}
        onPickClick={m.onPickClick}
        onImportFiles={(list) => void m.importFiles(list)}
        onExpandCollapse={() => {
          if (m.treeMode && m.treeAllExpanded) m.collapseAllTree();
          else if (m.treeMode) {
            m.setExpandedPaths(new Set(m.expandableDirPaths));
          } else {
            m.expandAllTree();
          }
        }}
        onToggleTypeMenu={() => m.setTypeMenuOpen((prev) => !prev)}
        onSelectType={(cat) => {
          m.setTypeFilter(cat);
          m.setTypeMenuOpen(false);
        }}
        onQueryChange={m.setQuery}
        onEnterFolder={m.enterFolder}
      />

      {m.error ? (
        <p className="mb-3 shrink-0 text-sm text-dls-status-danger-fg">{m.error}</p>
      ) : null}
      {m.catalogTruncated ? (
        <p
          className="mb-3 shrink-0 text-sm text-dls-secondary"
          data-files-catalog-truncated="true"
        >
          {t("files.catalog_truncated", {
            limit: String(WORKSPACE_FILES_CATALOG_LIMIT),
          })}
        </p>
      ) : null}

      <UploadsMineDropZone
        canLoad={m.canLoad}
        loading={m.loading}
        rowsLength={m.rows.length}
        dragActive={m.dragActive}
        showEmpty={m.showEmpty}
        showTable={m.showTable}
        filterActive={m.filterActive}
        uploading={m.uploading}
        treeMode={m.treeMode}
        treeRows={m.treeRows}
        visibleRows={m.visibleRows}
        rowByPath={m.rowByPath}
        selectedId={m.selectedId}
        dropTargetId={m.dropTargetId}
        moveBusy={m.moveBusy}
        pathCopiedFlash={m.pathCopiedFlash}
        workspaceRoot={m.workspaceRoot}
        sortKey={m.sortKey}
        sortDir={m.sortDir}
        onToggleSort={m.toggleSort}
        onPickClick={m.onPickClick}
        onDragEnter={m.onDragEnter}
        onDragLeave={m.onDragLeave}
        onDragOver={m.onDragOver}
        onDrop={m.onDrop}
        onEnterFolder={m.enterFolder}
        onToggleTreeExpanded={m.toggleTreeExpanded}
        onSelectRow={m.setSelectedId}
        onClearDropTarget={() => m.setDropTargetId(null)}
        onMineDragStart={m.handleMineDragStart}
        onFolderDragOver={m.handleFolderDragOver}
        onFolderDragLeave={m.handleFolderDragLeave}
        onFolderDrop={(event, row) => void m.handleFolderDrop(event, row)}
        absoluteForRow={m.absoluteForRow}
        workspaceRelativeForRow={m.workspaceRelativeForRow}
        onOpenExternally={m.handleOpenExternally}
        onOpenInFolder={m.handleOpenInFolder}
        onCopyPath={m.handleCopyPath}
        onMoveTo={m.setMoveTarget}
        onDelete={m.handleDeleteFile}
      />

      {m.typeMenuOpen ? (
        <div
          className="fixed inset-0 z-10"
          onClick={() => m.setTypeMenuOpen(false)}
          onContextMenu={() => m.setTypeMenuOpen(false)}
        />
      ) : null}

      <FilePreviewDrawer
        open={Boolean(selectedRow && selectedTarget)}
        file={m.selectedPreviewNode}
        target={selectedTarget}
        state={previewState}
        copied={m.copiedPath}
        onClose={m.closePreview}
        onCopyPath={() => {
          if (selectedRow) void m.handleCopyPath(selectedRow);
        }}
        onEdit={
          selectedRow &&
          previewState.status === "local" &&
          selectedTarget &&
          canEditArtifactTarget(selectedTarget)
            ? () => {
                if (previewState.status === "local") {
                  void openArtifactForEditing(previewState.filePath);
                }
              }
            : undefined
        }
        onOpenInFolder={
          selectedRow ? () => void m.handleOpenInFolder(selectedRow) : undefined
        }
        onOpenExternally={
          selectedRow
            ? () => void m.handleOpenExternally(selectedRow)
            : undefined
        }
        onAskAgent={
          selectedRow && selectedTarget && props.onAskAgentAboutFile
            ? () =>
                props.onAskAgentAboutFile?.({
                  path: workspaceRelativeForUploadRow(selectedRow),
                  name: selectedRow.name,
                  preview: selectedTarget.preview,
                })
            : selectedRow && props.onAddToTask
              ? () =>
                  props.onAddToTask?.(
                    workspaceRelativeForUploadRow(selectedRow),
                  )
              : undefined
        }
      />

      <ConfirmModal
        open={m.pendingDelete !== null}
        title={t("files.delete_confirm_title")}
        message={t("files.delete_confirm_desc", {
          name: m.pendingDelete?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void m.confirmDelete()}
        onCancel={() => m.setPendingDelete(null)}
      />

      <MineMoveToDialog
        open={m.moveTarget != null}
        client={props.client}
        workspaceId={m.workspaceId}
        sourcePath={
          m.moveTarget ? workspaceRelativeForUploadRow(m.moveTarget) : ""
        }
        sourceName={m.moveTarget?.name ?? ""}
        onClose={() => m.setMoveTarget(null)}
        onMoved={(targetFolderPath) => {
          const folderLabel =
            targetFolderPath === WORKSPACE_UPLOADS_DIR
              ? t("files.move_to_root")
              : targetFolderPath.split("/").pop() || targetFolderPath;
          props.onToast?.({
            tone: "success",
            title: t("files.move_to_success", { folder: folderLabel }),
            actionLabel: t("files.move_view"),
            onAction: () => {
              m.enterFolder(targetFolderPath);
              m.setPreviewState({ status: "idle" });
            },
            dismissLabel: t("common.dismiss"),
          });
          m.setMoveTarget(null);
          m.setRefreshKey((key) => key + 1);
        }}
      />

      <UploadsCreateFolderDialog
        open={m.createFolderOpen}
        name={m.createFolderName}
        busy={m.createFolderBusy}
        onNameChange={m.setCreateFolderName}
        onConfirm={() => void m.confirmCreateFolder()}
        onClose={() => m.setCreateFolderOpen(false)}
      />
    </div>
  );
}
