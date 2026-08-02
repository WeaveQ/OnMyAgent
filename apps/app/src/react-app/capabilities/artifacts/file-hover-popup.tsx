/** @jsxImportSource react */
/**
 * Cursor-style file hover card: path + size + quick actions on filename hover.
 * Keeps the ⋯ menu for less-common / destructive actions (delete).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Copy,
  ExternalLink,
  FileUp,
  FolderOpen,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { t } from "../../../i18n";
import { ArtifactIcon } from "./artifact-icon";

const OPEN_DELAY_MS = 380;
const CLOSE_DELAY_MS = 160;

export type FileHoverPopupProps = {
  name: string;
  /** Path shown under the name (absolute or workspace-relative). */
  pathLabel: string;
  sizeLabel?: string;
  updatedLabel?: string;
  /** Filename cell / trigger content. */
  children: ReactNode;
  className?: string;
  onView?: () => void;
  onOpenFile?: () => void;
  onOpenInFolder?: () => void;
  onCopyPath?: () => void;
};

export function FileHoverPopup(props: FileHoverPopupProps) {
  const {
    name,
    pathLabel,
    sizeLabel,
    updatedLabel,
    children,
    className,
    onView,
    onOpenFile,
    onOpenInFolder,
    onCopyPath,
  } = props;

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const panelId = useId();

  const clearTimers = useCallback(() => {
    if (openTimer.current != null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const measure = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const panelW = 288;
    let left = rect.left;
    let top = rect.bottom + pad;
    // Keep inside viewport.
    left = Math.max(pad, Math.min(left, window.innerWidth - panelW - pad));
    if (top + 220 > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - pad - 200);
    }
    setCoords({ top, left });
  }, []);

  const scheduleOpen = useCallback(() => {
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      measure();
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [clearTimers, measure]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [clearTimers]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const metaBits = [sizeLabel, updatedLabel].filter(Boolean).join(" · ");
  const hasActions = Boolean(onView || onOpenFile || onOpenInFolder || onCopyPath);

  const run = (fn?: () => void) => {
    fn?.();
    setOpen(false);
  };

  return (
    <span
      ref={rootRef}
      className={cn("relative inline-flex min-w-0 max-w-full", className)}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          scheduleClose();
        }
      }}
    >
      <span
        className="min-w-0 max-w-full truncate"
        aria-describedby={open ? panelId : undefined}
      >
        {children}
      </span>
      {open && coords ? (
        <div
          ref={panelRef}
          id={panelId}
          role="tooltip"
          className="fixed z-50 w-72 overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid text-sm text-dls-text shadow-[0_8px_28px_rgba(0,0,0,0.28)] ring-1 ring-foreground/5 animate-in fade-in-0 zoom-in-95 duration-100"
          style={{
            top: coords.top,
            left: coords.left,
            backgroundColor: "var(--dls-surface-solid, #2c2c2c)",
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="flex items-start gap-3 border-b border-dls-border/70 px-3 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-dls-surface-muted text-dls-secondary ring-1 ring-dls-border/60">
              <ArtifactIcon name={name} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-dls-text" title={name}>
                {name}
              </div>
              <div
                className="mt-0.5 break-all font-mono text-2xs leading-4 text-dls-secondary"
                title={pathLabel}
              >
                {pathLabel}
              </div>
              {metaBits ? (
                <div className="mt-1 text-2xs text-dls-secondary">{metaBits}</div>
              ) : null}
            </div>
          </div>
          {hasActions ? (
            <div className="flex flex-col p-1.5" role="menu">
              {onView ? (
                <HoverAction
                  icon={<FileUp className="size-4" aria-hidden />}
                  label={t("files.view_in_panel")}
                  onClick={() => run(onView)}
                />
              ) : null}
              {onOpenFile ? (
                <HoverAction
                  icon={<ExternalLink className="size-4" aria-hidden />}
                  label={t("files.open_file")}
                  onClick={() => run(onOpenFile)}
                />
              ) : null}
              {onOpenInFolder ? (
                <HoverAction
                  icon={<FolderOpen className="size-4" aria-hidden />}
                  label={t("files.open_in_folder")}
                  onClick={() => run(onOpenInFolder)}
                />
              ) : null}
              {onCopyPath ? (
                <HoverAction
                  icon={<Copy className="size-4" aria-hidden />}
                  label={t("files.copy_path")}
                  onClick={() => run(onCopyPath)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

function HoverAction(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-dls-text outline-none transition-colors hover:bg-dls-hover focus-visible:bg-dls-hover focus-visible:ring-2 focus-visible:ring-dls-accent/40"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClick();
      }}
    >
      <span className="text-dls-secondary">{props.icon}</span>
      {props.label}
    </button>
  );
}
