/** @jsxImportSource react */
import React, { useCallback, useMemo, useState } from "react";
import { Check, Folder, FolderPlus, FolderX, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

import { workspaceDisplayName } from "./recent-workspaces";

export type WorkspaceFootnoteProps = {
  workspaceRoot: string;
  recentWorkspaces: readonly string[];
  disabled?: boolean;
  /** When true the chip is locked to an existing conversation's workdir and
   * shows a hint to start a new conversation to switch directory. */
  readOnly?: boolean;
  /** compact = workbench bottom-bar chip (borderless); default = standalone chip. */
  density?: "default" | "compact";
  onSelect: (path: string) => void;
  onClear: () => void;
  onBrowse: () => void;
};

/**
 * Local-agent variant of Upstream's `GuidWorkspaceFootnote`. Renders a compact
 * chip beneath the composer that toggles between three states (empty /
 * picked / temporary) and a searchable dropdown of recent workspace roots
 * with browse + clear actions.
 */
export function WorkspaceFootnote(props: WorkspaceFootnoteProps): React.ReactElement {
  const {
    workspaceRoot,
    recentWorkspaces,
    disabled,
    readOnly,
    density = "default",
    onSelect,
    onClear,
    onBrowse,
  } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const compact = density === "compact";

  const trimmedRoot = workspaceRoot.trim();
  const displayName = trimmedRoot ? workspaceDisplayName(trimmedRoot) : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recentWorkspaces;
    return recentWorkspaces.filter((path) => {
      const name = workspaceDisplayName(path).toLowerCase();
      return name.includes(q) || path.toLowerCase().includes(q);
    });
  }, [query, recentWorkspaces]);

  const handleSelect = useCallback(
    (path: string) => {
      onSelect(path);
      setOpen(false);
      setQuery("");
    },
    [onSelect],
  );

  const handleBrowse = useCallback(() => {
    setOpen(false);
    onBrowse();
  }, [onBrowse]);

  const handleClear = useCallback(() => {
    setOpen(false);
    onClear();
  }, [onClear]);

  const chipLabel = trimmedRoot
    ? displayName
    : compact
      ? t("session.choose_folder_optional")
      : t("local_agent.workspace_work_in_project");

  return (
    <div className="mac:titlebar-no-drag flex min-w-0 items-center gap-0.5 text-xs text-dls-secondary">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "mac:titlebar-no-drag inline-flex min-w-0 items-center gap-1.5 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-signal/40 focus-visible:ring-offset-1",
                disabled && "cursor-not-allowed opacity-60",
                compact
                  ? "h-8 max-w-52 shrink gap-1.5 rounded-lg px-2 text-xs font-normal leading-none text-dls-secondary hover:bg-dls-hover hover:text-dls-text [&_svg]:size-3.5"
                  : cn(
                      "rounded-lg border border-dls-border bg-dls-surface px-2.5 py-1 text-xs font-medium text-dls-text hover:bg-dls-hover",
                      !trimmedRoot && "border-dashed",
                    ),
              )}
              title={trimmedRoot || t("local_agent.workspace_no_project")}
              aria-label={
                trimmedRoot
                  ? t("local_agent.workspace_selected_aria", { path: trimmedRoot })
                  : t("local_agent.workspace_pick_aria")
              }
            >
              {trimmedRoot ? <Folder className="h-3.5 w-3.5 shrink-0" /> : <FolderPlus className="h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 truncate">{chipLabel}</span>
            </button>
          }
        />
        <PopoverContent align="start" side="top" sideOffset={6} className="w-72 p-0">
          <div className="border-b border-dls-border p-2">
            <div className="flex items-center gap-1.5 rounded-md border border-dls-border bg-dls-surface px-2 py-1">
              <Search className="h-3.5 w-3.5 text-dls-secondary" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("local_agent.workspace_search_placeholder")}
                className="h-6 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-dls-secondary">
                {recentWorkspaces.length === 0
                  ? t("local_agent.workspace_recent_empty")
                  : t("local_agent.workspace_recent_no_match")}
              </div>
            ) : (
              filtered.map((path) => {
                const active = path === trimmedRoot;
                return (
                  <button
                    key={path}
                    type="button"
                    onClick={() => handleSelect(path)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                      "hover:bg-dls-hover",
                      active && "bg-dls-hover text-dls-text",
                    )}
                    title={path}
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-dls-secondary" />
                    <span className="min-w-0 flex-1 truncate">{workspaceDisplayName(path)}</span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0 text-dls-signal" /> : null}
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-dls-border">
            <button
              type="button"
              onClick={handleBrowse}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-dls-signal transition-colors hover:bg-dls-hover"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>{t("local_agent.workspace_choose_different_folder")}</span>
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={!trimmedRoot || Boolean(readOnly)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                trimmedRoot && !readOnly ? "text-dls-secondary hover:bg-dls-hover" : "text-dls-secondary opacity-50",
              )}
            >
              <FolderX className="h-3.5 w-3.5" />
              <span>{t("local_agent.workspace_no_project")}</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {trimmedRoot && !readOnly && !compact ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onClear}
          disabled={disabled}
          className="mac:titlebar-no-drag h-6 w-6 shrink-0 text-dls-secondary hover:text-dls-text"
          aria-label={t("local_agent.workspace_clear_aria")}
          title={t("local_agent.workspace_clear_aria")}
        >
          <X className="h-3 w-3" />
        </Button>
      ) : null}
      {readOnly ? (
        <span
          className={cn(
            "min-w-0 truncate text-xs text-dls-secondary",
            compact && "max-w-[14rem]",
          )}
          title={t("local_agent.workspace_locked_hint")}
        >
          {compact ? "· " : null}
          {t("local_agent.workspace_locked_hint")}
        </span>
      ) : null}
    </div>
  );
}
