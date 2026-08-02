/** @jsxImportSource react */
/**
 * Qwen-style awareness file viewer: preview → edit → save / open in folder.
 * Always allows edit; missing/unreadable files fall back to seed so save can create.
 */
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import {
  ensureWorkMemoryAwarenessDir,
  openWorkMemoryAwarenessFileInFolder,
  openWorkMemoryAwarenessFolder,
  readWorkMemoryAwarenessFile,
  writeWorkMemoryAwarenessFile,
} from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import { WORK_MEMORY_SEED } from "../../shared";

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
  /** Called after successful save (for UI refresh). */
  onSaved?: () => void;
  /**
   * After disk write succeeds, apply markdown back into prefs
   * (USER / style / MEMORY). AGENTS.md has no prefs mapping.
   */
  onApplyContentToPrefs?: (
    fileName: AwarenessFileKind,
    content: string,
  ) => void;
};

function seedFor(fileName: AwarenessFileKind | null): string {
  if (!fileName) return "";
  return WORK_MEMORY_SEED[fileName] ?? "";
}

function isMissingIpcError(raw: string): boolean {
  return /not declared|not implemented|unavailable/i.test(raw);
}

export function AwarenessFileViewerModal(props: AwarenessFileViewerModalProps) {
  const desktop = isElectronRuntime();
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!props.open || !props.fileName) return;
    const fallback = seedFor(props.fileName);
    if (!desktop) {
      setError(t("settings.memory_open_folder_desktop_only"));
      setContent(fallback);
      setDraft(fallback);
      setEditing(true);
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
      // Missing / unreadable: seed into the editor so user can save to create.
      setContent(fallback);
      setDraft(fallback);
      setEditing(true);
      setError(null);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error ?? "");
      setContent(fallback);
      setDraft(fallback);
      setEditing(true);
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
      if (props.fileName) {
        props.onApplyContentToPrefs?.(props.fileName, draft);
      }
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
      props.onClose();
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,40rem)] w-[min(100vw-2rem,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-dls-border px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base font-medium">
                {props.fileName ?? props.title}
              </DialogTitle>
              <DialogDescription className="text-xs text-dls-secondary">
                {props.description ?? t("settings.memory_file_viewer_desc")}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-dls-secondary"
                onClick={() => void onOpenFolder()}
              >
                <FolderOpen className="size-4" />
                {t("settings.memory_open_folder")}
              </Button>
              {!editing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(true);
                    setError(null);
                  }}
                  disabled={loading}
                >
                  <Pencil className="size-4" />
                  {t("settings.memory_file_edit")}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-dls-secondary">{t("settings.loading")}</p>
          ) : editing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[min(50vh,22rem)] w-full resize-y rounded-xl border-dls-border bg-dls-surface font-mono text-sm leading-6"
              autoFocus
            />
          ) : (
            <div className="rounded-xl border border-dls-border bg-dls-surface px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-dls-text">
                {content || t("settings.memory_file_empty")}
              </pre>
            </div>
          )}
          {error ? (
            <p className="mt-3 text-xs text-dls-status-danger-fg">{error}</p>
          ) : null}
        </div>

        {editing ? (
          <DialogFooter className="shrink-0 border-t border-dls-border px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(content);
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void onSave()}
              disabled={saving || !desktop}
            >
              {saving ? t("settings.memory_file_saving") : t("common.save")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
