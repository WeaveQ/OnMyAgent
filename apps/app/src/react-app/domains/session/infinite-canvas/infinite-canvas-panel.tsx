/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileJson, Sparkles, X } from "lucide-react";
import { getSnapshot, type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { t } from "../../../../i18n";

import { runCanvasCommands } from "./tldraw-adapter";
import { CANVAS_TEMPLATES } from "./templates";
import {
  createEmptyCanvasSnapshot,
  loadCanvasSnapshot,
  saveCanvasSnapshot,
} from "./persistence";
import type { CanvasCommand, CanvasSessionKey, CanvasSnapshot, CanvasTemplateId } from "./types";

type InfiniteCanvasPanelProps = {
  canvasKey: CanvasSessionKey;
  onClose: () => void;
};

const TEMPLATE_IDS: CanvasTemplateId[] = [
  "blank",
  "flowchart",
  "taskBreakdown",
  "architecture",
  "meeting",
  "expertAnalysis",
];
const SAVE_DEBOUNCE_MS = 700;

function isCanvasTemplateId(value: string): value is CanvasTemplateId {
  return TEMPLATE_IDS.some((id) => id === value);
}

function canvasTemplateLabel(id: CanvasTemplateId) {
  switch (id) {
    case "blank":
      return t("infinite_canvas.template.blank");
    case "flowchart":
      return t("infinite_canvas.template.flowchart");
    case "taskBreakdown":
      return t("infinite_canvas.template.taskBreakdown");
    case "architecture":
      return t("infinite_canvas.template.architecture");
    case "meeting":
      return t("infinite_canvas.template.meeting");
    case "expertAnalysis":
      return t("infinite_canvas.template.expertAnalysis");
  }
}

function getStorage() {
  if (globalThis.window === undefined) return null;
  return window.localStorage;
}

function loadSnapshotForKey(canvasKey: CanvasSessionKey) {
  const storage = getStorage();
  return storage ? loadCanvasSnapshot(storage, canvasKey) : createEmptyCanvasSnapshot(canvasKey);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseCommandInput(value: string, templateId: CanvasTemplateId): CanvasCommand[] {
  const trimmed = value.trim();
  if (!trimmed) return [{ type: "template", templateId }];
  const parsed: unknown = JSON.parse(trimmed);
  if (Array.isArray(parsed)) return parsed.filter(isCanvasCommand);
  return isCanvasCommand(parsed) ? [parsed] : [];
}

function isCanvasCommand(value: unknown): value is CanvasCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return "type" in value && typeof value.type === "string";
}

export function InfiniteCanvasPanel(props: InfiniteCanvasPanelProps) {
  const [initialSnapshot, setInitialSnapshot] = useState<CanvasSnapshot>(() =>
    loadSnapshotForKey(props.canvasKey),
  );
  const [templateId, setTemplateId] = useState<CanvasTemplateId>(initialSnapshot.templateId);
  const [commandInput, setCommandInput] = useState("");
  const [status, setStatus] = useState(t("infinite_canvas.status_ready"));
  const editorRef = useRef<Editor | null>(null);
  const commandInputRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const snapshotRef = useRef<CanvasSnapshot>(initialSnapshot);
  const templateIdRef = useRef<CanvasTemplateId>(initialSnapshot.templateId);

  useEffect(() => {
    const nextSnapshot = loadSnapshotForKey(props.canvasKey);
    snapshotRef.current = nextSnapshot;
    templateIdRef.current = nextSnapshot.templateId;
    setInitialSnapshot(nextSnapshot);
    setTemplateId(nextSnapshot.templateId);
    setCommandInput("");
    setStatus(t("infinite_canvas.status_ready"));
  }, [props.canvasKey]);

  const updateTemplateId = useCallback((nextTemplateId: CanvasTemplateId) => {
    templateIdRef.current = nextTemplateId;
    setTemplateId(nextTemplateId);
  }, []);

  const flushSnapshot = useCallback((options: { announce?: boolean } = {}) => {
    const editor = editorRef.current;
    const nextStorage = getStorage();
    if (!editor || !nextStorage) return;
    try {
      const nextSnapshot: CanvasSnapshot = {
        ...snapshotRef.current,
        document: getSnapshot(editor.store),
        templateId: templateIdRef.current,
        updatedAt: Date.now(),
      };
      saveCanvasSnapshot(nextStorage, nextSnapshot);
      snapshotRef.current = nextSnapshot;
      if (options.announce !== false) setStatus(t("infinite_canvas.status_saved"));
    } catch {
      if (options.announce !== false) setStatus(t("infinite_canvas.status_save_failed"));
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      flushSnapshot();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSnapshot]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      flushSnapshot({ announce: false });
    };
  }, [flushSnapshot]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      const cleanup = editor.store.listen(
        () => {
          scheduleSave();
        },
        { scope: "document", source: "user" },
      );
      if (initialSnapshot.document) {
        editor.zoomToFit();
      }
      return () => {
        flushSnapshot({ announce: false });
        cleanup();
        if (editorRef.current === editor) editorRef.current = null;
      };
    },
    [flushSnapshot, initialSnapshot.document, scheduleSave],
  );

  const applyCommands = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const rawCommandInput = commandInput || commandInputRef.current?.value || "";
      const commands = parseCommandInput(rawCommandInput, templateId);
      const result = runCanvasCommands(editor, commands);
      setStatus(
        result.ok
          ? t("infinite_canvas.status_applied", { count: result.applied })
          : result.errors.join("; "),
      );
      setCommandInput("");
      scheduleSave();
    } catch {
      setStatus(t("infinite_canvas.status_invalid_command"));
    }
  }, [commandInput, scheduleSave, templateId]);

  const exportJson = useCallback(() => {
    flushSnapshot();
    const editor = editorRef.current;
    if (!editor) return;
    const blob = new Blob([JSON.stringify(getSnapshot(editor.store), null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `canvas-${props.canvasKey.sessionId}.json`);
  }, [flushSnapshot, props.canvasKey.sessionId]);

  const exportPng = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const shapeIds = editor.getCurrentPageShapeIds();
    void editor
      .toImage([...shapeIds], { format: "png", background: true })
      .then(({ blob }) => downloadBlob(blob, `canvas-${props.canvasKey.sessionId}.png`))
      .catch(() => setStatus(t("infinite_canvas.status_export_failed")));
  }, [props.canvasKey.sessionId]);

  const templateOptions = useMemo(
    () =>
      TEMPLATE_IDS.map((id) => ({
        id,
        label: canvasTemplateLabel(id),
      })),
    [],
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-dls-surface text-dls-text">
      <header
        data-panel-titlebar="true"
        className="flex shrink-0 items-center gap-2 border-b border-dls-border px-3 py-2 mac:titlebar-drag"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{t("infinite_canvas.title")}</div>
          <div className="truncate text-xs text-dls-secondary">{status}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={t("infinite_canvas.export_json")}
          aria-label={t("infinite_canvas.export_json")}
          onClick={exportJson}
        >
          <FileJson className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={t("infinite_canvas.export_png")}
          aria-label={t("infinite_canvas.export_png")}
          onClick={exportPng}
        >
          <Download className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={t("infinite_canvas.close")}
          aria-label={t("infinite_canvas.close")}
          onClick={() => {
            flushSnapshot();
            props.onClose();
          }}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-dls-border px-3 py-2">
        <Select
          value={templateId}
          items={templateOptions.map((option) => ({ value: option.id, label: option.label }))}
          onValueChange={(value) => {
            if (value && isCanvasTemplateId(value)) {
              updateTemplateId(value);
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={t("infinite_canvas.template_label")}
            className="h-8 w-44 rounded-lg border-dls-border bg-dls-surface px-2 text-xs text-dls-text"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger>
            <SelectGroup>
              {templateOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-infinite-canvas-command-apply="true"
          onClick={applyCommands}
        >
          <Sparkles className="size-4" />
          {t("infinite_canvas.apply")}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <Tldraw
          key={`${props.canvasKey.surface}:${props.canvasKey.workspaceId}:${props.canvasKey.sessionId}`}
          snapshot={initialSnapshot.document ?? undefined}
          onMount={handleMount}
        />
      </div>

      <div className="shrink-0 border-t border-dls-border p-3">
        <Textarea
          ref={commandInputRef}
          data-infinite-canvas-command-input="true"
          value={commandInput}
          onChange={(event) => setCommandInput(event.target.value)}
          onInput={(event) => setCommandInput(event.currentTarget.value)}
          placeholder={t("infinite_canvas.command_placeholder")}
          aria-label={t("infinite_canvas.command_label")}
          className="max-h-28 min-h-16 resize-none rounded-lg border-dls-border bg-dls-background text-xs"
        />
      </div>
    </section>
  );
}
