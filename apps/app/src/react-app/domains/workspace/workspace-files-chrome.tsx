/** @jsxImportSource react */
/**
 * Shared Files rail chrome: type filter menu + refresh flash helpers.
 * Used by Mine uploads panel and Tasks/Experts browser panel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, RefreshCw, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../i18n";
import { FILE_CATEGORIES, fileCategoryLabel, type FileCategory } from "./workspace-files-model";

/** state-timings.short-ms — refresh success flash duration. */
export const FILES_REFRESH_FLASH_MS = 1000;

export function useFilesRefreshFlash() {
  const [refreshDone, setRefreshDone] = useState(false);
  const timerRef = useRef<number | null>(null);
  const manualRefreshRef = useRef(false);

  const clearFlashTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearFlashTimer(), [clearFlashTimer]);

  const markManualRefresh = useCallback(() => {
    manualRefreshRef.current = true;
    setRefreshDone(false);
    clearFlashTimer();
  }, [clearFlashTimer]);

  const finishRefreshFlash = useCallback(() => {
    if (!manualRefreshRef.current) return;
    manualRefreshRef.current = false;
    setRefreshDone(true);
    clearFlashTimer();
    timerRef.current = window.setTimeout(() => {
      setRefreshDone(false);
      timerRef.current = null;
    }, FILES_REFRESH_FLASH_MS);
  }, [clearFlashTimer]);

  const cancelManualRefresh = useCallback(() => {
    manualRefreshRef.current = false;
  }, []);

  return {
    refreshDone,
    markManualRefresh,
    finishRefreshFlash,
    cancelManualRefresh,
  };
}

export function FilesTypeFilter(props: {
  value: FileCategory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: FileCategory) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0", props.className)}>
      <Button
        type="button"
        variant="outline"
        size="default"
        onClick={() => props.onOpenChange(!props.open)}
        className="h-9 gap-1.5 rounded-lg px-3 text-sm"
        data-files-type-filter="true"
      >
        <SlidersHorizontal data-icon="inline-start" className="size-3.5 text-dls-secondary" />
        {fileCategoryLabel(props.value)}
        <ChevronDown className={cn("size-3.5 transition-transform", props.open && "rotate-180")} />
      </Button>
      {props.open ? (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 flex min-w-[148px] flex-col rounded-xl border border-dls-border bg-dls-surface-solid py-1 "
          style={{
            backgroundColor: "var(--dls-surface-solid, var(--dls-surface))",
          }}
        >
          {FILE_CATEGORIES.map((cat) => (
            <MenuRowButton
              key={cat}
              align="center"
              type="button"
              onClick={() => {
                props.onChange(cat);
                props.onOpenChange(false);
              }}
              active={props.value === cat}
            >
              {fileCategoryLabel(cat)}
            </MenuRowButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Ghost refresh icon beside the page title. */
export function FilesRefreshButton(props: {
  loading: boolean;
  refreshDone: boolean;
  disabled?: boolean;
  onClick: () => void;
  source?: "mine" | "browser";
}) {
  const source = props.source ?? "browser";
  const label = props.refreshDone ? t("common.refreshed") : t("common.refresh");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={props.disabled || props.loading || props.refreshDone}
      onClick={props.onClick}
      className={cn(
        "size-7 shrink-0 rounded-md text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
        props.refreshDone && "text-dls-status-success-fg hover:text-dls-status-success-fg",
      )}
      data-files-mine-refresh={source === "mine" ? "true" : undefined}
      data-files-browser-refresh={source === "browser" ? "true" : undefined}
      title={label}
      aria-label={label}
      aria-busy={props.loading || undefined}
    >
      {props.loading ? (
        <RefreshCw className="size-4 animate-spin" aria-hidden />
      ) : props.refreshDone ? (
        <Check className="size-4" strokeWidth={2.5} aria-hidden />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
    </Button>
  );
}

export function FilesTypeFilterOverlay(props: { open: boolean; onClose: () => void }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-10" onClick={props.onClose} onContextMenu={props.onClose} />
  );
}
