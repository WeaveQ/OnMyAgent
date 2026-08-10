/** @jsxImportSource react */
/**
 * Presentational sections for the Mine uploads Files panel.
 * Extracted from workspace-files-uploads-panel (P1-5 file-size split).
 */
import {
  type DragEvent,
  type RefObject,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderPlus,
  Loader2,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { CountBadge } from "@/components/ui/status-badge";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { FILES_EMPTY_STATE_ASSET } from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import { typeScale } from "@/react-app/design-system/type-scale";
import { isElectronRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import { FileHoverPopup } from "../../capabilities/artifacts/file-hover-popup";
import {
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
} from "../../capabilities/artifacts/workspace-file-tree";
import { FilesRefreshButton } from "./workspace-files-chrome";
import {
  FILE_CATEGORIES,
  fileCategoryLabel,
  getFileCategory,
  type FileCategory,
  type TreeOutlineRow,
  type UserUploadRow,
} from "./workspace-files-model";
import { FilesSortableTableHeader } from "./workspace-files-table-sort";
import type {
  WorkspaceFileSortDir,
  WorkspaceFileSortKey,
} from "../../capabilities/artifacts/workspace-file-tree";
import { UploadRowActionsMenu } from "./workspace-files-uploads-row-menu";

export type BreadcrumbSegment = { path: string; label: string };

export function UploadsMineChrome(props: {
  canLoad: boolean;
  loading: boolean;
  uploading: boolean;
  refreshDone: boolean;
  createFolderBusy: boolean;
  filterActive: boolean;
  treeMode: boolean;
  treeAllExpanded: boolean;
  typeFilter: FileCategory;
  typeMenuOpen: boolean;
  query: string;
  showBreadcrumb: boolean;
  breadcrumbSegments: BreadcrumbSegment[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onRefresh: () => void;
  onOpenCreateFolder: () => void;
  onPickClick: () => void;
  onImportFiles: (files: FileList) => void;
  onExpandCollapse: () => void;
  onToggleTypeMenu: () => void;
  onSelectType: (cat: FileCategory) => void;
  onQueryChange: (value: string) => void;
  onEnterFolder: (path: string) => void;
}) {
  return (
    <div className="mb-3 flex w-full min-w-0 shrink-0 flex-col gap-2">
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 text-left">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className={cn(typeScale.pageTitle, "min-w-0 truncate text-left")}>
              {t("files.source_uploads_title")}
            </h1>
            <FilesRefreshButton
              source="mine"
              loading={props.loading}
              refreshDone={props.refreshDone}
              disabled={!props.canLoad || props.uploading}
              onClick={props.onRefresh}
            />
          </div>
          <p className={cn(typeScale.pageSubtitle, "mt-1 max-w-2xl text-left")}>
            {t("files.source_uploads_desc")}
          </p>
        </div>

        {/* create · upload · expand · type · search — right of title */}
        <div
          className="mt-1.5 flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2"
          data-files-mine-toolbar="true"
        >
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={
              !props.canLoad ||
              props.uploading ||
              props.loading ||
              props.createFolderBusy
            }
            onClick={props.onOpenCreateFolder}
            className="size-9 shrink-0 rounded-full"
            data-files-create-folder="true"
            title={t("files.create_folder")}
            aria-label={t("files.create_folder")}
          >
            <FolderPlus className="size-3.5" aria-hidden />
          </Button>
          <input
            ref={props.fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const list = event.target.files;
              if (list?.length) props.onImportFiles(list);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!props.canLoad || props.uploading || props.loading}
            onClick={props.onPickClick}
            className="size-9 shrink-0 rounded-full"
            data-files-upload="true"
            title={props.uploading ? t("files.uploading") : t("files.upload_files")}
            aria-label={
              props.uploading ? t("files.uploading") : t("files.upload_files")
            }
            aria-busy={props.uploading || undefined}
          >
            {props.uploading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5" aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={
              !props.canLoad ||
              props.loading ||
              props.uploading ||
              props.filterActive
            }
            aria-pressed={props.treeMode && props.treeAllExpanded}
            onClick={props.onExpandCollapse}
            className={cn(
              "size-9 shrink-0 rounded-full",
              props.treeMode &&
                "border-dls-accent/40 bg-dls-accent/10 text-dls-text",
            )}
            data-files-expand-collapse="true"
            data-files-tree-mode={props.treeMode ? "true" : "false"}
            data-files-tree-expanded={props.treeAllExpanded ? "true" : "false"}
            title={
              props.treeMode && props.treeAllExpanded
                ? t("files.collapse_all_folders")
                : t("files.expand_all_folders")
            }
            aria-label={
              props.treeMode && props.treeAllExpanded
                ? t("files.collapse_all_folders")
                : t("files.expand_all_folders")
            }
          >
            {props.treeMode && props.treeAllExpanded ? (
              <ChevronsDownUp className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronsUpDown className="size-3.5 shrink-0" aria-hidden />
            )}
          </Button>
          <div className="relative shrink-0">
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={props.onToggleTypeMenu}
              className="h-9 gap-1.5 rounded-full px-3 text-sm"
            >
              <SlidersHorizontal
                data-icon="inline-start"
                className="size-3.5 text-dls-secondary"
              />
              {fileCategoryLabel(props.typeFilter)}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  props.typeMenuOpen && "rotate-180",
                )}
              />
            </Button>
            {props.typeMenuOpen ? (
              <div
                className="absolute right-0 top-full z-50 mt-1.5 flex min-w-[148px] flex-col rounded-xl border border-dls-border bg-dls-surface-solid py-1 shadow-md"
                style={{
                  backgroundColor:
                    "var(--dls-surface-solid, var(--dls-surface))",
                }}
              >
                {FILE_CATEGORIES.map((cat) => (
                  <MenuRowButton
                    key={cat}
                    align="center"
                    type="button"
                    onClick={() => props.onSelectType(cat)}
                    active={props.typeFilter === cat}
                  >
                    {fileCategoryLabel(cat)}
                  </MenuRowButton>
                ))}
              </div>
            ) : null}
          </div>
          <InputGroup
            controlSize="default"
            radius="lg"
            tone="surface"
            className="min-w-[11rem] w-48 rounded-full sm:w-56"
          >
            <InputGroupAddon align="inline-start">
              <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              placeholder={t("files.search_uploads_placeholder")}
              disabled={props.loading || props.uploading}
              className="h-9 text-sm placeholder:text-dls-secondary"
            />
          </InputGroup>
        </div>
      </div>

      {/* Nested path only — root already named by the page title. */}
      {props.showBreadcrumb ? (
        <div
          className="flex w-full min-w-0 items-center"
          data-files-mine-pathbar="true"
        >
          <nav
            className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-dls-secondary"
            aria-label={t("files.breadcrumb_label")}
            data-files-mine-breadcrumb="true"
          >
            {props.breadcrumbSegments.map((segment, index) => {
              const isLast = index === props.breadcrumbSegments.length - 1;
              return (
                <span
                  key={segment.path}
                  className="inline-flex min-w-0 max-w-full items-center gap-1"
                >
                  {index > 0 ? (
                    <span
                      className="shrink-0 text-dls-secondary/60"
                      aria-hidden
                    >
                      /
                    </span>
                  ) : null}
                  {isLast ? (
                    <span className="truncate font-medium text-dls-text">
                      {segment.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="truncate rounded-md px-0.5 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
                      onClick={() => props.onEnterFolder(segment.path)}
                    >
                      {segment.label}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

export function UploadsMineDropZone(props: {
  canLoad: boolean;
  loading: boolean;
  rowsLength: number;
  dragActive: boolean;
  showEmpty: boolean;
  showTable: boolean;
  filterActive: boolean;
  uploading: boolean;
  treeMode: boolean;
  treeRows: TreeOutlineRow[];
  visibleRows: UserUploadRow[];
  rowByPath: Map<string, UserUploadRow>;
  selectedId: string | null;
  dropTargetId: string | null;
  moveBusy: boolean;
  pathCopiedFlash: string | null;
  workspaceRoot: string;
  sortKey: WorkspaceFileSortKey;
  sortDir: WorkspaceFileSortDir;
  onToggleSort: (key: WorkspaceFileSortKey) => void;
  onPickClick: () => void;
  onDragEnter: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onEnterFolder: (path: string) => void;
  onToggleTreeExpanded: (path: string) => void;
  onSelectRow: (id: string) => void;
  onClearDropTarget: () => void;
  onMineDragStart: (event: DragEvent, row: UserUploadRow) => void;
  onFolderDragOver: (event: DragEvent, row: UserUploadRow) => void;
  onFolderDragLeave: (event: DragEvent, row: UserUploadRow) => void;
  onFolderDrop: (event: DragEvent, row: UserUploadRow) => void;
  absoluteForRow: (row: UserUploadRow) => string;
  workspaceRelativeForRow: (row: UserUploadRow) => string;
  onOpenExternally: (row: UserUploadRow) => void;
  onOpenInFolder: (row: UserUploadRow) => void;
  onCopyPath: (row: UserUploadRow) => void;
  onMoveTo: (row: UserUploadRow) => void;
  onDelete: (row: UserUploadRow) => void;
}) {
  if (!props.canLoad) {
    return (
      <Empty className="min-h-[280px] border border-dashed border-dls-border">
        <EmptyHeader>
          <EmptyStateIllustration
            src={FILES_EMPTY_STATE_ASSET}
            size="compact"
            className="mb-2"
          />
          <EmptyTitle>{t("files.no_tool_folder")}</EmptyTitle>
          <EmptyDescription>{t("files.no_tool_folder_hint")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (props.loading && props.rowsLength === 0) {
    return (
      <div
        className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-sm text-dls-secondary"
        role="status"
        aria-busy="true"
      >
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span>{t("files.loading")}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full min-w-0 flex-1 flex-col rounded-xl border border-dls-border",
        props.dragActive && "border-dls-accent border-dashed bg-dls-accent/5",
      )}
      onDragEnter={props.onDragEnter}
      onDragLeave={props.onDragLeave}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      {props.dragActive ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl bg-dls-background/80 backdrop-blur-[1px]">
          <Upload className="size-8 text-dls-accent" aria-hidden />
          <p className="text-sm font-medium text-dls-text">
            {t("files.drop_to_upload")}
          </p>
          <p className="text-xs text-dls-secondary">
            {t("files.drop_to_upload_hint")}
          </p>
        </div>
      ) : null}

      {props.showEmpty ? (
        <Empty className="min-h-[280px] border-0">
          <EmptyHeader>
            <EmptyStateIllustration
              src={FILES_EMPTY_STATE_ASSET}
              size="compact"
              className="mb-2"
            />
            <EmptyTitle>
              {props.filterActive
                ? t("files.no_matching_files")
                : t("files.uploads_empty_title")}
            </EmptyTitle>
            <EmptyDescription>
              {props.filterActive
                ? t("files.no_matching_files_hint")
                : t("files.uploads_empty_hint")}
            </EmptyDescription>
          </EmptyHeader>
          {!props.filterActive ? (
            <Button
              type="button"
              size="default"
              disabled={props.uploading}
              onClick={props.onPickClick}
              className="mt-4 gap-1.5"
            >
              <Upload className="size-3.5" aria-hidden />
              {t("files.import_to_workspace")}
            </Button>
          ) : null}
        </Empty>
      ) : props.showTable ? (
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto">
          <table className="w-full table-fixed caption-bottom text-sm">
            <FilesSortableTableHeader
              sortKey={props.sortKey}
              sortDir={props.sortDir}
              onToggleSort={props.onToggleSort}
              actionsLabel={t("files.file_actions", { name: "" })}
              withSortDataAttrs
            />
            <TableBody>
              {props.treeMode && !props.filterActive
                ? props.treeRows.map((outlineRow) => {
                    if (outlineRow.type === "dir") {
                      const node = outlineRow.node;
                      const row = props.rowByPath.get(node.path);
                      const hasChildren = node.children.length > 0;
                      const isDropTarget =
                        Boolean(row) && props.dropTargetId === row?.id;
                      return (
                        <TableRow
                          key={`tree-dir:${node.path}`}
                          data-workspace-upload-row="dir"
                          data-files-tree-depth={String(outlineRow.depth)}
                          data-mine-drop-target={
                            isDropTarget ? "true" : undefined
                          }
                          className={cn(
                            "group h-11 cursor-pointer hover:bg-dls-hover/50",
                            isDropTarget &&
                              "bg-dls-accent/10 ring-1 ring-inset ring-dls-accent/40",
                          )}
                          onDragOver={
                            row
                              ? (event) => props.onFolderDragOver(event, row)
                              : undefined
                          }
                          onDragLeave={
                            row
                              ? (event) => props.onFolderDragLeave(event, row)
                              : undefined
                          }
                          onDrop={
                            row
                              ? (event) => void props.onFolderDrop(event, row)
                              : undefined
                          }
                        >
                          <TableCell className="text-left">
                            <div
                              className="flex min-w-0 items-center gap-2"
                              style={{
                                paddingLeft: `${outlineRow.depth * 1.25}rem`,
                              }}
                            >
                              {hasChildren ? (
                                <button
                                  type="button"
                                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                                  aria-expanded={outlineRow.expanded}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    props.onToggleTreeExpanded(node.path);
                                  }}
                                >
                                  {outlineRow.expanded ? (
                                    <ChevronDown className="size-3.5" />
                                  ) : (
                                    <ChevronRight className="size-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="size-6 shrink-0" />
                              )}
                              <Folder
                                className="size-4 shrink-0 text-dls-text"
                                strokeWidth={1.75}
                                aria-hidden
                              />
                              <button
                                type="button"
                                className="min-w-0 truncate text-left text-sm font-medium text-dls-text hover:text-dls-accent"
                                title={node.path}
                                onClick={() => props.onEnterFolder(node.path)}
                              >
                                {node.name}
                              </button>
                              {outlineRow.fileCount > 0 ? (
                                <CountBadge size="meta">
                                  {t("files.file_count", {
                                    count: outlineRow.fileCount,
                                  })}
                                </CountBadge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-left text-dls-secondary">
                            {t("files.type_folder")}
                          </TableCell>
                          <TableCell className="text-left text-dls-secondary tabular-nums">
                            {node.mtimeMs > 0
                              ? formatWorkspaceFileTime(node.mtimeMs)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-left text-dls-secondary tabular-nums">
                            —
                          </TableCell>
                          <TableCell className="relative py-2 text-left" />
                        </TableRow>
                      );
                    }

                    const fileNode = outlineRow.node;
                    const row = props.rowByPath.get(fileNode.path);
                    if (!row) return null;
                    const selected = row.id === props.selectedId;
                    return (
                      <TableRow
                        key={`tree-file:${fileNode.path}`}
                        data-state={selected ? "selected" : undefined}
                        data-workspace-upload-row="file"
                        data-files-tree-depth={String(outlineRow.depth)}
                        draggable={!props.moveBusy}
                        className={cn(
                          "group h-11 cursor-pointer cursor-grab active:cursor-grabbing",
                          selected && "bg-dls-surface-muted/80",
                        )}
                        onDragStart={(event) =>
                          props.onMineDragStart(event, row)
                        }
                        onDragEnd={() => props.onClearDropTarget()}
                        onClick={() => props.onSelectRow(row.id)}
                        onDoubleClick={() => void props.onOpenExternally(row)}
                      >
                        <TableCell className="text-left">
                          <div
                            className="flex min-w-0 items-center gap-2"
                            style={{
                              paddingLeft: `${outlineRow.depth * 1.25}rem`,
                            }}
                          >
                            <span className="size-6 shrink-0" />
                            <ArtifactIcon
                              name={row.name}
                              className="size-4 shrink-0"
                            />
                            <FileHoverPopup
                              name={row.name}
                              pathLabel={
                                props.workspaceRoot
                                  ? props.absoluteForRow(row)
                                  : props.workspaceRelativeForRow(row)
                              }
                              sizeLabel={formatWorkspaceFileSize(row.size)}
                              updatedLabel={
                                row.updatedAt
                                  ? formatWorkspaceFileTime(row.updatedAt)
                                  : undefined
                              }
                              onView={() => props.onSelectRow(row.id)}
                              onOpenFile={() =>
                                void props.onOpenExternally(row)
                              }
                              onOpenInFolder={
                                props.workspaceRoot && isElectronRuntime()
                                  ? () => void props.onOpenInFolder(row)
                                  : undefined
                              }
                              onCopyPath={() => void props.onCopyPath(row)}
                            >
                              <span className="truncate font-medium text-dls-text underline-offset-2 group-hover:underline">
                                {row.name}
                              </span>
                            </FileHoverPopup>
                          </div>
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary">
                          {fileCategoryLabel(getFileCategory(row.name))}
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary tabular-nums">
                          {row.updatedAt
                            ? formatWorkspaceFileTime(row.updatedAt)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary tabular-nums">
                          {formatWorkspaceFileSize(row.size)}
                        </TableCell>
                        <TableCell className="relative py-2 text-left">
                          <UploadRowActionsMenu
                            name={row.name}
                            pathCopied={props.pathCopiedFlash === row.id}
                            showMoveTo
                            onPreview={() => props.onSelectRow(row.id)}
                            onOpenExternally={() =>
                              void props.onOpenExternally(row)
                            }
                            onOpenInFolder={() =>
                              void props.onOpenInFolder(row)
                            }
                            onMoveTo={() => props.onMoveTo(row)}
                            onCopyPath={() => void props.onCopyPath(row)}
                            onDelete={() => props.onDelete(row)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                : props.visibleRows.map((row) => {
                    const selected = row.id === props.selectedId;
                    const isDir = row.kind === "dir";
                    const isDropTarget =
                      isDir && props.dropTargetId === row.id;
                    return (
                      <TableRow
                        key={row.id}
                        data-state={selected ? "selected" : undefined}
                        data-workspace-upload-row={isDir ? "dir" : "file"}
                        data-mine-drop-target={
                          isDropTarget ? "true" : undefined
                        }
                        draggable={!isDir && !props.moveBusy}
                        className={cn(
                          "group cursor-pointer",
                          selected && "bg-dls-surface-muted/80",
                          isDropTarget &&
                            "bg-dls-accent/10 ring-1 ring-inset ring-dls-accent/40",
                          !isDir && "cursor-grab active:cursor-grabbing",
                        )}
                        onDragStart={(event) =>
                          props.onMineDragStart(event, row)
                        }
                        onDragEnd={() => props.onClearDropTarget()}
                        onDragOver={(event) =>
                          props.onFolderDragOver(event, row)
                        }
                        onDragLeave={(event) =>
                          props.onFolderDragLeave(event, row)
                        }
                        onDrop={(event) => void props.onFolderDrop(event, row)}
                        onClick={() => {
                          if (isDir) {
                            props.onEnterFolder(row.path);
                            return;
                          }
                          props.onSelectRow(row.id);
                        }}
                        onDoubleClick={() => {
                          if (isDir) {
                            props.onEnterFolder(row.path);
                            return;
                          }
                          void props.onOpenExternally(row);
                        }}
                      >
                        <TableCell className="text-left">
                          <div className="flex min-w-0 items-center gap-2">
                            {isDir ? (
                              <Folder
                                className="size-4 shrink-0 text-dls-text"
                                strokeWidth={1.75}
                                aria-hidden
                              />
                            ) : (
                              <ArtifactIcon
                                name={row.name}
                                className="size-4 shrink-0"
                              />
                            )}
                            {isDir ? (
                              <span className="truncate font-medium text-dls-text">
                                {row.name}
                              </span>
                            ) : (
                              <FileHoverPopup
                                name={row.name}
                                pathLabel={
                                  props.workspaceRoot
                                    ? props.absoluteForRow(row)
                                    : props.workspaceRelativeForRow(row)
                                }
                                sizeLabel={formatWorkspaceFileSize(row.size)}
                                updatedLabel={
                                  row.updatedAt
                                    ? formatWorkspaceFileTime(row.updatedAt)
                                    : undefined
                                }
                                onView={() => props.onSelectRow(row.id)}
                                onOpenFile={() =>
                                  void props.onOpenExternally(row)
                                }
                                onOpenInFolder={
                                  props.workspaceRoot && isElectronRuntime()
                                    ? () => void props.onOpenInFolder(row)
                                    : undefined
                                }
                                onCopyPath={() => void props.onCopyPath(row)}
                              >
                                <span className="truncate font-medium text-dls-text underline-offset-2 group-hover:underline">
                                  {row.name}
                                </span>
                              </FileHoverPopup>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary">
                          {isDir
                            ? t("files.type_folder")
                            : fileCategoryLabel(getFileCategory(row.name))}
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary tabular-nums">
                          {row.updatedAt
                            ? formatWorkspaceFileTime(row.updatedAt)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary tabular-nums">
                          {isDir ? "—" : formatWorkspaceFileSize(row.size)}
                        </TableCell>
                        <TableCell className="relative py-2 text-left">
                          <UploadRowActionsMenu
                            name={row.name}
                            pathCopied={props.pathCopiedFlash === row.id}
                            showMoveTo={!isDir}
                            onPreview={() => props.onSelectRow(row.id)}
                            onOpenExternally={() =>
                              void props.onOpenExternally(row)
                            }
                            onOpenInFolder={() =>
                              void props.onOpenInFolder(row)
                            }
                            onMoveTo={() => props.onMoveTo(row)}
                            onCopyPath={() => void props.onCopyPath(row)}
                            onDelete={() => props.onDelete(row)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function UploadsCreateFolderDialog(props: {
  open: boolean;
  name: string;
  busy: boolean;
  onNameChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("files.create_folder_title")}
      data-files-create-folder-dialog="true"
      onClick={() => {
        if (!props.busy) props.onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-dls-border bg-dls-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-dls-text">
          {t("files.create_folder_title")}
        </h2>
        <input
          autoFocus
          value={props.name}
          onChange={(event) => props.onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void props.onConfirm();
            }
            if (event.key === "Escape" && !props.busy) {
              props.onClose();
            }
          }}
          placeholder={t("files.create_folder_placeholder")}
          disabled={props.busy}
          className="mt-3 h-9 w-full rounded-lg border border-dls-border bg-dls-background px-3 text-sm text-dls-text outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.busy}
            onClick={props.onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={props.busy || !props.name.trim()}
            onClick={() => void props.onConfirm()}
          >
            {props.busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {t("files.create_folder_confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
