/** @jsxImportSource react */
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Folder, Paperclip, Plus, Quote, SlashSquare, X } from "lucide-react";

import { ContextUsageIndicator } from "./context-usage-indicator";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import { SendButton } from "@/components/ui/send-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  localAgentComposerListFiles,
  localAgentComposerSaveAttachment,
  type LocalAgentComposerFileEntry,
} from "@/app/lib/desktop";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";

export type LocalAgentSlashCommand = {
  name: string;
  description: string;
  source: "acp" | "builtin";
  selectionBehavior: "insert" | "execute";
  hint?: string;
  completionBehavior?: "normal" | "neutral_tip_on_empty";
  emptyTurnTipCode?: string;
  emptyTurnTipParams?: Record<string, unknown>;
};

export type LocalAgentAttachment = {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  size?: number;
  kind: "file" | "image";
  previewUrl?: string;
};

export type LocalAgentQuoteChip = {
  id: string;
  text: string;
  lines: number;
};

export type LocalAgentComposerSubmit = {
  text: string;
  attachments: LocalAgentAttachment[];
  mentions: Record<string, string>;
  quotes: LocalAgentQuoteChip[];
  unresolvedMentions: string[];
};

const LONG_PASTE_THRESHOLD = 800;

import { assembleLocalAgentPrompt } from "./local-agent-prompt-assembly";

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function getNativeFilePath(file: File): string | null {
  type ElectronBridge = { files?: { getPathForFile?: (file: File) => string | null } };
  const globalScope = globalThis as typeof globalThis & { __ONMYAGENT_ELECTRON__?: ElectronBridge };
  const bridge = globalScope.__ONMYAGENT_ELECTRON__;
  const helper = bridge?.files?.getPathForFile;
  if (typeof helper === "function") {
    try { return helper(file) ?? null; } catch { return null; }
  }
  const legacyPath = (file as File & { path?: string }).path;
  return typeof legacyPath === "string" && legacyPath ? legacyPath : null;
}

function bytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type AtQueryState = {
  active: boolean;
  query: string;
  start: number;
  end: number;
};

type MentionSpan = { start: number; end: number };
function findAllMentionSpans(value: string, mentions: Record<string, string>): MentionSpan[] {
  const spans: MentionSpan[] = [];
  const tokens = Object.keys(mentions).sort((a, b) => b.length - a.length);
  if (!tokens.length) return spans;
  let cursor = 0;
  while (cursor < value.length) {
    let matched = false;
    for (const token of tokens) {
      if (value.startsWith(token, cursor)) {
        const before = cursor === 0 ? " " : value[cursor - 1];
        if (!before || /\s/.test(before) || cursor === 0) {
          const end = cursor + token.length;
          const after = value[end];
          if (after === undefined || /\s/.test(after) || after === "" ) {
            spans.push({ start: cursor, end });
            cursor = end;
            matched = true;
            break;
          }
        }
      }
    }
    if (!matched) cursor += 1;
  }
  return spans;
}

function findAtQuery(value: string, caret: number): AtQueryState {
  if (caret <= 0) return { active: false, query: "", start: -1, end: -1 };
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@") {
      const before = i === 0 ? " " : value[i - 1];
      if (before && /\s/.test(before) === false && i !== 0) {
        return { active: false, query: "", start: -1, end: -1 };
      }
      const query = value.slice(i + 1, caret);
      if (/\s/.test(query)) return { active: false, query: "", start: -1, end: -1 };
      return { active: true, query, start: i, end: caret };
    }
    if (/\s/.test(value[i])) break;
    i -= 1;
  }
  return { active: false, query: "", start: -1, end: -1 };
}

function renderMirror(value: string, mentions: Record<string, string>): React.ReactNode[] {
  const spans = findAllMentionSpans(value, mentions);
  if (!spans.length) return [value + "\u200b"];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (cursor < span.start) nodes.push(value.slice(cursor, span.start));
    nodes.push(
      <span key={`m-${i}`} style={{ color: "var(--dls-accent, #2563eb)" }}>{value.slice(span.start, span.end)}</span>,
    );
    cursor = span.end;
  });
  if (cursor < value.length) nodes.push(value.slice(cursor));
  nodes.push("\u200b");
  return nodes;
}

export const LocalAgentDraftComposer = memo(function LocalAgentDraftComposer(props: {
  draftKey: string;
  workspaceRoot: string;
  initialDraft: string;
  disabled: boolean;
  submitting: boolean;
  placeholder: string;
  slashCommands: LocalAgentSlashCommand[];
  onDraftCommit: (draftKey: string, value: string) => void;
  onSubmit: (payload: LocalAgentComposerSubmit) => void;
  onSlashCommandExecute?: (command: LocalAgentSlashCommand) => void;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  /** Workbench-style strip under the card (workspace / approval). */
  bottomAccessory?: ReactNode;
  contextUsage?: { used: number; total: number; label?: string | null } | null;
}) {
  const [value, setValue] = useState(props.initialDraft);
  const [slashOpen, setSlashOpen] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<LocalAgentAttachment[]>([]);
  const [quotes, setQuotes] = useState<LocalAgentQuoteChip[]>([]);
  const [mentions, setMentions] = useState<Record<string, string>>({});
  const [atState, setAtState] = useState<AtQueryState>({ active: false, query: "", start: -1, end: -1 });
  const [mentionFiles, setMentionFiles] = useState<LocalAgentComposerFileEntry[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [uploading, setUploading] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const dragCounterRef = useRef(0);
  const fileInputId = `local-agent-file-input-${props.draftKey}`;

  const slashQuery = value.startsWith("/") && !/\s/.test(value) ? value.toLowerCase() : "";
  // Show all live commands from the ACP wrapper (codex-acp publishes 8 builtins
  // plus $skill entries); the menu is already scrollable via max-h-60.
  const visibleSlashCommands = useMemo(
    () => slashQuery
      ? props.slashCommands.filter((command) => command.name.toLowerCase().startsWith(slashQuery))
      : props.slashCommands,
    [props.slashCommands, slashQuery],
  );

  useEffect(() => setValue(props.initialDraft), [props.draftKey, props.initialDraft]);
  useEffect(() => {
    setAttachments([]);
    setQuotes([]);
    setMentions({});
  }, [props.draftKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => props.onDraftCommit(props.draftKey, value), 350);
    return () => window.clearTimeout(timer);
  }, [props.draftKey, props.onDraftCommit, value]);

  useEffect(() => {
    if (!atState.active) {
      setMentionFiles([]);
      return;
    }
    let cancelled = false;
    void localAgentComposerListFiles({ workspaceRoot: props.workspaceRoot, query: atState.query, limit: 40 })
      .then((result) => {
        if (!cancelled) {
          setMentionFiles(result.files);
          setMentionIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) setMentionFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [atState.active, atState.query, props.workspaceRoot]);

  const submit = useCallback(() => {
    const text = value;
    if (!text.trim() && attachments.length === 0 && quotes.length === 0) return;
    props.onDraftCommit(props.draftKey, "");
    const assembled = assembleLocalAgentPrompt({ text, attachments, mentions, quotes });
    props.onSubmit({ text, attachments, mentions, quotes, unresolvedMentions: assembled.unresolvedMentions });
    setValue("");
    setAttachments([]);
    setQuotes([]);
    setMentions({});
    setAtState({ active: false, query: "", start: -1, end: -1 });
    setSlashOpen(false);
  }, [attachments, mentions, props, quotes, value]);

  const selectSlashCommand = useCallback((command: LocalAgentSlashCommand) => {
    setSlashOpen(false);
    setToolMenuOpen(false);
    if (command.source === "builtin") {
      setValue("");
      props.onDraftCommit(props.draftKey, "");
      props.onSlashCommandExecute?.(command);
      return;
    }
    const nextValue = `${command.name} `;
    setValue(nextValue);
    props.onDraftCommit(props.draftKey, nextValue);
    textareaRef.current?.focus();
  }, [props]);

  const openFilePicker = useCallback(() => {
    setToolMenuOpen(false);
    document.getElementById(fileInputId)?.click();
  }, [fileInputId]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolMenuRef.current?.contains(target)) return;
      setToolMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toolMenuOpen]);

  const insertMention = useCallback((entry: LocalAgentComposerFileEntry) => {
    if (!atState.active) return;
    const token = `@${entry.relativePath || entry.name}`;
    const next = value.slice(0, atState.start) + token + " " + value.slice(atState.end);
    setValue(next);
    props.onDraftCommit(props.draftKey, next);
    setMentions((current) => ({ ...current, [token]: entry.path }));
    setAtState({ active: false, query: "", start: -1, end: -1 });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = atState.start + token.length + 1;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }, [atState, props, value]);

  const addAttachmentFromFile = useCallback(async (file: File) => {
    if (!props.workspaceRoot) return;
    setUploading((n) => n + 1);
    try {
      const nativePath = getNativeFilePath(file);
      const kind: LocalAgentAttachment["kind"] = isImageMime(file.type) ? "image" : "file";
      let absolutePath: string;
      let displayPath: string;
      let size: number = file.size;
      let previewUrl: string | undefined;
      if (nativePath) {
        absolutePath = nativePath;
        displayPath = nativePath;
        if (kind === "image") previewUrl = await fileToDataUrl(file).catch(() => undefined);
      } else {
        const dataUrl = await fileToDataUrl(file);
        const saved = await localAgentComposerSaveAttachment({
          workspaceRoot: props.workspaceRoot,
          name: file.name,
          dataUrl,
        });
        absolutePath = saved.path;
        displayPath = saved.path;
        size = saved.size;
        if (kind === "image") previewUrl = dataUrl;
      }
      setAttachments((current) => [
        ...current,
        {
          id: `att-${Date.now().toString(36)}-${current.length}`,
          name: file.name,
          absolutePath,
          relativePath: displayPath,
          size,
          kind,
          previewUrl,
        },
      ]);
    } catch (error) {
      console.warn("[local-agent composer] attach failed", error);
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  }, [props.workspaceRoot]);

  const handleFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      await addAttachmentFromFile(file);
    }
  }, [addAttachmentFromFile]);

  const handlePaste = useCallback(async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files: File[] = [];
    let hadImage = false;
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          if (isImageMime(file.type)) hadImage = true;
          files.push(file);
        }
      }
    }
    if (files.length) {
      event.preventDefault();
      await handleFiles(files);
      return;
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.length > LONG_PASTE_THRESHOLD) {
      event.preventDefault();
      const chip: LocalAgentQuoteChip = {
        id: `q-${Date.now().toString(36)}`,
        text,
        lines: text.split(/\r?\n/).length,
      };
      setQuotes((current) => [...current, chip]);
    }
    void hadImage;
  }, [handleFiles]);

  const handleDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragCounterRef.current += 1;
    setDragActive(true);
  }, []);
  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);
  const handleDragLeave = useCallback(() => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  }, []);
  const handleDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void handleFiles(files);
  }, [handleFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((att) => att.id !== id));
  }, []);
  const removeQuote = useCallback((id: string) => {
    setQuotes((current) => current.filter((q) => q.id !== id));
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return;
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      if (toolMenuOpen) { event.preventDefault(); setToolMenuOpen(false); return; }
      if (slashOpen) { event.preventDefault(); setSlashOpen(false); return; }
      if (atState.active) { event.preventDefault(); setAtState({ active: false, query: "", start: -1, end: -1 }); return; }
    }
    if (atState.active && mentionFiles.length) {
      if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((i) => (i + 1) % mentionFiles.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((i) => (i - 1 + mentionFiles.length) % mentionFiles.length); return; }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(mentionFiles[mentionIndex]);
        return;
      }
    }
    if ((event.key === "Tab" || event.key === "Enter") && slashOpen && visibleSlashCommands.length) {
      event.preventDefault();
      selectSlashCommand(visibleSlashCommands[0]);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }, [atState, insertMention, mentionFiles, mentionIndex, selectSlashCommand, slashOpen, submit, toolMenuOpen, visibleSlashCommands]);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    setValue(nextValue);
    const slashActive = nextValue.startsWith("/") && !/\s/.test(nextValue);
    setSlashOpen(slashActive);
    if (slashActive) setToolMenuOpen(false);
    const caret = event.target.selectionStart ?? nextValue.length;
    const at = findAtQuery(nextValue, caret);
    setAtState(at);
  }, []);

  const mentionSpans = useMemo(() => findAllMentionSpans(value, mentions), [value, mentions]);
  const canSend = (Boolean(value.trim()) || attachments.length > 0 || quotes.length > 0)
    && !props.disabled && !props.submitting;

  const hasFooter = Boolean(props.bottomAccessory);

  return (
    // One outer silhouette so focus never paints a blue top half + gray footer.
    // Keep overflow visible so slash/mention menus can escape upward.
    // Always solid surface — glass-mixed tokens make the composer look hollow
    // and grey out controls on mac vibrancy.
    <div
      className={cn(
        // overflow visible: slash/mention menus open upward past the shell.
        "mac:titlebar-no-drag w-full min-w-0 max-w-full rounded-xl border bg-dls-surface-solid shadow-sm transition-[border-color,box-shadow]",
        dragActive
          ? "border-dls-accent/60"
          : focused
            ? "border-dls-border-strong"
            : "border-dls-border",
      )}
      data-local-agent-composer-shell="true"
    >
    <div
      className={cn(
        // No overflow-x-hidden here: with overflow-y visible CSS forces y→auto and
        // clips the upward slash/mention menus (button looked "unclickable").
        "relative min-w-0 max-w-full overflow-visible bg-dls-surface-solid",
        hasFooter ? "rounded-t-xl" : "rounded-xl",
      )}
      data-local-agent-composer-root="true"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive ? (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-dls-accent bg-dls-accent/10 text-sm font-medium text-dls-accent">
          {t("local_agent.composer_drop_here")}
        </div>
      ) : null}
      {slashOpen ? (
        <div
          className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-60 overflow-y-auto rounded-xl border border-dls-border bg-dls-surface-solid p-2 shadow-lg"
          data-testid="local-agent-slash-menu"
        >
          {visibleSlashCommands.length ? (
            <div className="grid gap-1">
              {visibleSlashCommands.map((command) => (
                <button
                  key={`${command.source}:${command.name}`}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-dls-hover"
                  onClick={() => selectSlashCommand(command)}
                  data-testid={`local-agent-slash-${command.name.replace(/^\//, "")}`}
                >
                  <SlashSquare size={14} className="mt-0.5 shrink-0 text-dls-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-dls-text">{command.name}</span>
                      <div className="flex items-center gap-1">
                        {command.hint ? <kbd className="rounded-sm border border-dls-border bg-dls-surface-muted px-1 py-0.5 text-xs font-mono text-dls-secondary">{command.hint}</kbd> : null}
                        <StatusBadge size="tiny" tone="surface">{command.source === "acp" ? "ACP" : t("local_agent.slash_builtin")}</StatusBadge>
                      </div>
                    </div>
                    {command.description ? <div className="truncate text-xs text-dls-secondary">{command.description}</div> : null}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-dls-secondary" data-testid="local-agent-slash-empty">
              {t("local_agent.slash_empty")}
            </div>
          )}
        </div>
      ) : null}
      {atState.active && mentionFiles.length ? (
        <div
          className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-60 overflow-y-auto rounded-xl border border-dls-border bg-dls-surface-solid p-2 shadow-lg"
          data-testid="local-agent-mention-menu"
        >
          <div className="grid gap-1">
            {mentionFiles.map((entry, index) => (
              <button
                key={entry.path}
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-dls-hover",
                  index === mentionIndex && "bg-dls-hover",
                )}
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => insertMention(entry)}
              >
                {entry.isDirectory ? (
                  <Folder className="mt-0.5 size-3.5 shrink-0 text-dls-secondary" />
                ) : (
                  <ArtifactIcon name={entry.name} className="mt-0.5 size-3.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-dls-text">{entry.name}{entry.isDirectory ? "/" : ""}</div>
                  <div className="truncate text-xs text-dls-secondary">{entry.relativePath}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {(attachments.length > 0 || quotes.length > 0 || uploading > 0) ? (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="group/att flex max-w-full items-center gap-2 rounded-lg bg-dls-surface-muted px-2 py-1.5 text-xs"
              data-testid="local-agent-attachment"
            >
              {att.kind === "image" && att.previewUrl ? (
                <div className="size-8 shrink-0 overflow-hidden rounded-md bg-dls-surface">
                  <img src={att.previewUrl} alt="" className="size-full object-cover" />
                </div>
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface text-dls-secondary">
                  <ArtifactIcon name={att.name} className="size-3.5" />
                </div>
              )}
              <div className="min-w-0 max-w-[14rem]">
                <div className="truncate text-xs font-medium text-dls-text">{att.name}</div>
                <div className="truncate text-2xs text-dls-secondary">
                  {att.relativePath}
                  {att.size ? ` · ${bytes(att.size)}` : ""}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="ml-0.5 size-5 shrink-0 rounded-full text-dls-secondary opacity-70 hover:bg-dls-hover hover:text-dls-text hover:opacity-100 group-hover/att:opacity-100"
                onClick={() => removeAttachment(att.id)}
                aria-label={t("action.remove")}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
          {quotes.map((q) => (
            <div
              key={q.id}
              className="group/att flex max-w-full items-center gap-2 rounded-lg bg-dls-surface-muted px-2 py-1.5 text-xs"
              data-testid="local-agent-quote"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface text-dls-secondary">
                <Quote className="size-3.5" aria-hidden="true" />
              </div>
              <div className="min-w-0 max-w-[14rem]">
                <div className="truncate text-xs font-medium text-dls-text">{t("local_agent.composer_pasted_text")}</div>
                <div className="truncate text-2xs text-dls-secondary">
                  {t("local_agent.composer_pasted_lines", { count: q.lines })}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="ml-0.5 size-5 shrink-0 rounded-full text-dls-secondary opacity-70 hover:bg-dls-hover hover:text-dls-text hover:opacity-100 group-hover/att:opacity-100"
                onClick={() => removeQuote(q.id)}
                aria-label={t("action.remove")}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
          {uploading > 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-dls-accent/60 px-2 py-1.5 text-xs text-dls-accent">
              {t("local_agent.composer_uploading", { count: uploading })}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="px-3.5 pt-3 pb-2.5">
        <div className="relative">
          <div
            aria-hidden
            data-local-agent-mirror="true"
            className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-sm leading-6"
            style={{ color: "transparent" }}
          >
            {renderMirror(value, mentions)}
          </div>
          <Textarea
            ref={textareaRef}
            rows={2}
            className="relative min-h-[52px] resize-none border-0 bg-transparent p-0 text-sm leading-6 text-dls-text shadow-none placeholder:text-dls-secondary/70 focus-visible:border-transparent focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-transparent"
            style={{
              color: mentionSpans.length ? "transparent" : undefined,
              caretColor: "var(--dls-text, currentColor)",
              WebkitTextFillColor: mentionSpans.length ? "transparent" : undefined,
            }}
            aria-label={t("local_agent.input_aria")}
            data-local-agent-composer="true"
            value={value}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onPaste={handlePaste}
            placeholder={props.placeholder}
            disabled={props.disabled || props.submitting}
          />
        </div>
        {/* Match home composer action row: + menu left, send right. */}
        <div className="mt-2 flex items-end justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-visible">
            <input
              type="file"
              multiple
              className="hidden"
              id={fileInputId}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                if (files.length) void handleFiles(files);
                event.currentTarget.value = "";
              }}
            />
            <div ref={toolMenuRef} className="relative -ml-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-8 shrink-0 rounded-md text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
                  toolMenuOpen && "bg-dls-surface-muted text-dls-text",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSlashOpen(false);
                  setToolMenuOpen((open) => !open);
                }}
                aria-expanded={toolMenuOpen}
                aria-haspopup="menu"
                title={t("composer.quick_actions")}
                aria-label={t("composer.quick_actions")}
                disabled={props.disabled}
                data-testid="local-agent-tool-menu-button"
              >
                <Plus
                  size={16}
                  className={cn(
                    "transition-transform duration-200 ease-out",
                    toolMenuOpen ? "rotate-45" : "rotate-0",
                  )}
                />
              </Button>
              {toolMenuOpen ? (
                <div
                  className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid p-1.5 shadow-lg"
                  style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
                  role="menu"
                  data-testid="local-agent-tool-menu"
                >
                  <MenuRowButton
                    type="button"
                    align="center"
                    density="compact"
                    className="justify-start gap-2 text-dls-text hover:text-dls-text"
                    onClick={openFilePicker}
                  >
                    <Paperclip className="size-3.5 shrink-0 text-dls-text" />
                    <span className="truncate text-sm leading-5">{t("composer.add_file")}</span>
                  </MenuRowButton>
                  {props.slashCommands.length > 0 ? (
                    <>
                      <div className="my-1 h-px bg-dls-border/80" role="separator" />
                      <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-dls-secondary">
                        {t("local_agent.slash_menu_title")}
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {props.slashCommands.map((command) => (
                          <MenuRowButton
                            key={`${command.source}:${command.name}`}
                            type="button"
                            align="start"
                            density="compact"
                            className="w-full justify-start gap-2 text-dls-text hover:text-dls-text"
                            onClick={() => selectSlashCommand(command)}
                            data-testid={`local-agent-tool-slash-${command.name.replace(/^\//, "")}`}
                          >
                            <SlashSquare className="mt-0.5 size-3.5 shrink-0 text-dls-secondary" />
                            <span className="min-w-0 flex-1 text-left">
                              <span className="block truncate text-sm font-medium leading-5">
                                {command.name}
                              </span>
                              {command.description ? (
                                <span className="block truncate text-xs leading-4 text-dls-secondary">
                                  {command.description}
                                </span>
                              ) : null}
                            </span>
                          </MenuRowButton>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            {props.toolbarLeft}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {props.contextUsage ? <ContextUsageIndicator usage={props.contextUsage} /> : null}
            {props.toolbarRight}
            <SendButton
              type="button"
              aria-label={t("local_agent.send_aria")}
              onClick={submit}
              disabled={!canSend}
              loading={props.submitting}
            />
          </div>
        </div>
      </div>
    </div>
    {props.bottomAccessory ? (
      <div
        className="relative z-10 mt-0 flex min-h-10 w-full min-w-0 max-w-full items-center gap-1.5 overflow-visible rounded-b-xl border-t border-dls-border bg-dls-surface-muted/80 px-2 py-1 text-xs font-normal leading-none text-dls-secondary"
        data-local-agent-composer-footer="true"
      >
        {props.bottomAccessory}
      </div>
    ) : null}
    </div>
  );
});
LocalAgentDraftComposer.displayName = "LocalAgentDraftComposer";

export function buildLocalAgentPrompt(payload: LocalAgentComposerSubmit): string {
  // Backwards-compat wrapper. Prefer `assembleLocalAgentPrompt` when the
  // caller also needs `unresolvedMentions` or structured sections.
  return assembleLocalAgentPrompt(payload).text;
}
