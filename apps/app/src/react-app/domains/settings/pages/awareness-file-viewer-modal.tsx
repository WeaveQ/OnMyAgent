/** @jsxImportSource react */
/**
 * Awareness file viewer — fixed shell for all four files (style / AGENTS / USER / MEMORY).
 * Preview and edit share the same chrome, width, height, and body surface.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FolderOpen } from "lucide-react";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  ensureWorkMemoryAwarenessDir,
  openWorkMemoryAwarenessFileInFolder,
  openWorkMemoryAwarenessFolder,
  readWorkMemoryAwarenessFile,
  writeWorkMemoryAwarenessFile,
} from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import { getWorkMemorySeed } from "../../shared";

export type AwarenessFileKind =
  | "style.md"
  | "AGENTS.md"
  | "USER.md"
  | "MEMORY.md";

export type AwarenessFileViewerModalProps = {
  open: boolean;
  fileName: AwarenessFileKind | null;
  title: string;
  description?: string;
  onClose: () => void;
  onSaved?: () => void;
  onApplyContentToPrefs?: (
    fileName: AwarenessFileKind,
    content: string,
  ) => void;
};

function seedFor(fileName: AwarenessFileKind | null): string {
  if (!fileName) return "";
  return getWorkMemorySeed(currentLocale())[fileName] ?? "";
}

function isMissingIpcError(raw: string): boolean {
  return /not declared|not implemented|unavailable/i.test(raw);
}

/**
 * Fixed dialog shell — identical for every file and both modes.
 * Overrides DialogContent defaults (grid, max-w-md, gap-6, p-6).
 */
const DIALOG_SHELL =
  "flex h-[min(80vh,36rem)] w-[min(100vw-2rem,36rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none";

/** Shared mono surface: preview scroll area and editor occupy the same box. */
const BODY_SURFACE =
  "box-border size-full rounded-xl border border-dls-border bg-dls-surface font-mono text-sm leading-6 text-dls-text";

const BODY_PAD = "px-4 py-3";

export function AwarenessFileViewerModal(props: AwarenessFileViewerModalProps) {
  const desktop = isElectronRuntime();
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const dirty = useMemo(() => draft !== content, [content, draft]);

  const load = useCallback(async () => {
    if (!props.open || !props.fileName) return;
    const fallback = seedFor(props.fileName);
    if (!desktop) {
      setError(t("settings.memory_open_folder_desktop_only"));
      setContent(fallback);
      setDraft(fallback);
      setEditing(false);
      return;
    }
    setLoading(true);
    setError(null);
    setEditing(false);
    try {
      await ensureWorkMemoryAwarenessDir().catch(() => undefined);
      const result = await readWorkMemoryAwarenessFile(props.fileName);
      if (result?.ok && typeof result.content === "string") {
        setContent(result.content);
        setDraft(result.content);
        return;
      }
      setContent(fallback);
      setDraft(fallback);
      setError(null);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error ?? "");
      setContent(fallback);
      setDraft(fallback);
      setError(
        isMissingIpcError(raw)
          ? t("settings.memory_open_folder_restart_required")
          : t("settings.memory_file_load_failed"),
      );
    } finally {
      setLoading(false);
    }
  }, [desktop, props.fileName, props.open]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    const len = el.value.length;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(len, len);
    });
  }, [editing]);

  const enterEdit = useCallback(() => {
    setDraft(content);
    setEditing(true);
    setError(null);
  }, [content]);

  const cancelEdit = useCallback(() => {
    setDraft(content);
    setEditing(false);
    setError(null);
  }, [content]);

  const onSave = useCallback(async () => {
    if (!props.fileName) return;
    if (!desktop) {
      setError(t("settings.memory_open_folder_desktop_only"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await ensureWorkMemoryAwarenessDir().catch(() => undefined);
      const result = await writeWorkMemoryAwarenessFile({
        name: props.fileName,
        content: draft,
      });
      if (!result?.ok) {
        setError(t("settings.memory_file_save_failed"));
        return;
      }
      setContent(draft);
      setEditing(false);
      props.onApplyContentToPrefs?.(props.fileName, draft);
      props.onSaved?.();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error ?? "");
      setError(
        isMissingIpcError(raw)
          ? t("settings.memory_open_folder_restart_required")
          : t("settings.memory_file_save_failed"),
      );
    } finally {
      setSaving(false);
    }
  }, [desktop, draft, props]);

  const onOpenFolder = useCallback(async () => {
    if (!props.fileName || !desktop) {
      setError(t("settings.memory_open_folder_desktop_only"));
      return;
    }
    try {
      await openWorkMemoryAwarenessFileInFolder(props.fileName);
    } catch {
      try {
        await openWorkMemoryAwarenessFolder();
      } catch {
        setError(t("settings.memory_open_folder_failed"));
      }
    }
  }, [desktop, props.fileName]);

  const onOpenChange = (next: boolean) => {
    if (!next) {
      setEditing(false);
      setDraft(content);
      setError(null);
      props.onClose();
    }
  };

  const setMode = (nextEditing: boolean) => {
    if (nextEditing === editing) return;
    if (nextEditing) {
      enterEdit();
      return;
    }
    if (dirty) {
      // Switching back to preview discards unsaved edits (same as Cancel).
      cancelEdit();
      return;
    }
    setEditing(false);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!saving && desktop && dirty) void onSave();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!saving && desktop && dirty) void onSave();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
  };

  const fileLabel = props.fileName ?? props.title;

  return (
    <Dialog open={props.open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_SHELL}>
        {/* Header — fixed band */}
        <DialogHeader className="h-14 shrink-0 space-y-0 border-b border-dls-border px-5 pe-14 text-left">
          <div className="flex h-full min-w-0 flex-col justify-center gap-0.5">
            <DialogTitle className="truncate font-mono text-base font-medium leading-6">
              {fileLabel}
            </DialogTitle>
            <DialogDescription className="truncate text-xs leading-5 text-dls-secondary">
              {props.description ?? t("settings.memory_file_viewer_desc")}
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* Toolbar + body — fills remaining height */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <SegmentedTabGroup density="filter" role="tablist">
              <NavTabButton
                type="button"
                size="filter"
                shape="tab"
                role="tab"
                aria-selected={!editing}
                active={!editing}
                disabled={loading}
                onClick={() => setMode(false)}
              >
                {t("settings.memory_file_preview")}
              </NavTabButton>
              <NavTabButton
                type="button"
                size="filter"
                shape="tab"
                role="tab"
                aria-selected={editing}
                active={editing}
                disabled={loading || (!desktop && Boolean(error))}
                onClick={() => setMode(true)}
              >
                {t("settings.memory_file_edit")}
              </NavTabButton>
            </SegmentedTabGroup>
            {editing && dirty ? (
              <span className="truncate text-xs text-dls-secondary">
                {t("settings.memory_file_unsaved")}
              </span>
            ) : null}
          </div>

          {/* Fixed body box — absolute fill so preview/edit never change shell size */}
          <div className="relative min-h-0 flex-1">
            {loading ? (
              <div
                className={cn(
                  BODY_SURFACE,
                  BODY_PAD,
                  "flex items-center justify-center text-dls-secondary",
                )}
              >
                {t("settings.loading")}
              </div>
            ) : editing ? (
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditorKeyDown}
                spellCheck={false}
                className={cn(
                  BODY_SURFACE,
                  BODY_PAD,
                  // Kill field-sizing / autofill growth so height stays locked.
                  "absolute inset-0 resize-none overflow-y-auto bg-dls-surface-muted/30 outline-none focus-visible:border-dls-accent focus-visible:ring-0",
                )}
                aria-label={fileLabel}
              />
            ) : (
              <div
                role={desktop ? "button" : undefined}
                tabIndex={desktop ? 0 : undefined}
                className={cn(
                  BODY_SURFACE,
                  BODY_PAD,
                  "absolute inset-0 overflow-y-auto",
                  desktop &&
                    "cursor-text transition-colors hover:bg-dls-surface-muted/25",
                )}
                onClick={() => {
                  if (desktop) enterEdit();
                }}
                onKeyDown={(event) => {
                  if (!desktop) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    enterEdit();
                  }
                }}
              >
                <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm leading-6 text-dls-text">
                  {content || t("settings.memory_file_empty")}
                </pre>
              </div>
            )}
          </div>

          {error ? (
            <p className="shrink-0 text-xs text-dls-status-danger-fg">{error}</p>
          ) : null}
        </div>

        {/* Footer — always same height; actions swap by mode */}
        <DialogFooter className="m-0 mx-0 mb-0 h-14 shrink-0 flex-row items-center justify-between gap-2 rounded-none border-t border-dls-border bg-dls-surface-muted/15 px-5 py-0 sm:justify-between">
          {editing ? (
            <>
              <p className="min-w-0 flex-1 truncate text-xs text-dls-secondary">
                {t("settings.memory_file_editor_hint")}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onSave()}
                  disabled={saving || !desktop || !dirty}
                >
                  {saving ? t("settings.memory_file_saving") : t("common.save")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => void onOpenFolder()}
              >
                <FolderOpen className="size-4" />
                {t("settings.memory_open_folder")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => onOpenChange(false)}
              >
                {t("common.close")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
