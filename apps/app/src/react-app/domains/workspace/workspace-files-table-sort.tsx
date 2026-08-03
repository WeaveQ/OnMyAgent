/** @jsxImportSource react */
/**
 * Shared sortable table header for Mine / Tasks / Experts file tables.
 */
import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type WorkspaceFileSortDir,
  type WorkspaceFileSortKey,
} from "../../capabilities/artifacts/workspace-file-tree";
import { t } from "../../../i18n";

export type FilesTableSortState = {
  sortKey: WorkspaceFileSortKey;
  sortDir: WorkspaceFileSortDir;
  toggleSort: (key: WorkspaceFileSortKey) => void;
};

/** Default product sort: type ascending with folders first. */
export function useFilesTableSort(
  initialKey: WorkspaceFileSortKey = "type",
  initialDir: WorkspaceFileSortDir = "asc",
): FilesTableSortState {
  const [sortKey, setSortKey] = useState<WorkspaceFileSortKey>(initialKey);
  const [sortDir, setSortDir] = useState<WorkspaceFileSortDir>(initialDir);

  const toggleSort = useCallback(
    (key: WorkspaceFileSortKey) => {
      if (sortKey === key) {
        setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      // Name/type default ascending; updated/size newest/largest first.
      setSortDir(key === "name" || key === "type" ? "asc" : "desc");
    },
    [sortKey],
  );

  return { sortKey, sortDir, toggleSort };
}

export type FilesSortableTableHeaderProps = {
  sortKey: WorkspaceFileSortKey;
  sortDir: WorkspaceFileSortDir;
  onToggleSort: (key: WorkspaceFileSortKey) => void;
  /** Screen-reader label for the actions column. */
  actionsLabel: string;
  /** Extra data attributes on sort buttons (Mine uses data-files-sort-*). */
  withSortDataAttrs?: boolean;
};

export function FilesSortableTableHeader(props: FilesSortableTableHeaderProps) {
  const columns = [
    {
      key: "name" as WorkspaceFileSortKey,
      label: t("files.column_name"),
      className: "",
    },
    {
      key: "type" as WorkspaceFileSortKey,
      label: t("files.column_type"),
      className: "w-28",
    },
    {
      key: "updated" as WorkspaceFileSortKey,
      label: t("files.column_updated"),
      className: "w-40",
    },
    {
      key: "size" as WorkspaceFileSortKey,
      label: t("files.column_size"),
      className: "w-24",
    },
  ];

  return (
    <TableHeader className="sticky top-0 z-10">
      <TableRow className="hover:bg-transparent">
        {columns.map((column) => {
          const active = props.sortKey === column.key;
          return (
            <TableHead
              key={column.key}
              className={cn(
                "h-10 border-b border-dls-border bg-dls-surface-solid text-left text-xs font-medium text-dls-secondary",
                column.className,
              )}
              style={{
                backgroundColor: "var(--dls-surface-solid, #2c2c2c)",
              }}
              aria-sort={
                active
                  ? props.sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-dls-hover hover:text-dls-text",
                  active ? "font-semibold text-dls-text" : "text-dls-secondary",
                )}
                onClick={() => props.onToggleSort(column.key)}
                aria-label={
                  active
                    ? `${column.label} · ${props.sortDir === "asc" ? "asc" : "desc"}`
                    : column.label
                }
                {...(props.withSortDataAttrs
                  ? {
                      "data-files-sort-key": column.key,
                      "data-files-sort-active": active ? "true" : "false",
                    }
                  : {})}
              >
                <span>{column.label}</span>
                {active ? (
                  props.sortDir === "asc" ? (
                    <ArrowUp className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <ArrowDown className="size-3.5 shrink-0" aria-hidden />
                  )
                ) : (
                  <ArrowUpDown
                    className="size-3.5 shrink-0 opacity-45"
                    aria-hidden
                  />
                )}
              </button>
            </TableHead>
          );
        })}
        <TableHead
          className="h-10 w-12 border-b border-dls-border bg-dls-surface-solid"
          style={{ backgroundColor: "var(--dls-surface-solid, #2c2c2c)" }}
        >
          <span className="sr-only">{props.actionsLabel}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}
