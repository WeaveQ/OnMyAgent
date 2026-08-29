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
import { Plus, Quote, Square, X } from "lucide-react";
import { LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES } from "@onmyagent/types/desktop-ipc";

import { ContextUsageIndicator } from "./context-usage-indicator";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { SendButton } from "@/components/ui/send-button";
import { Textarea } from "@/components/ui/textarea";
import {
  localAgentComposerClass,
  resolveLocalAgentComposerLayout,
} from "./local-agent-composer-layout";
import {
  LocalAgentComposerMentionMenu,
  LocalAgentComposerSlashMenu,
  LocalAgentComposerToolMenu,
} from "./local-agent-composer-menus-view";
import {
  localAgentComposerListFiles,
  localAgentComposerSaveAttachment,
  type LocalAgentComposerFileEntry,
} from "@/app/lib/desktop";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import {
  canSubmitLocalAgentComposer,
  fileToDataUrl,
  findAllMentionSpans,
  findAtQuery,
  formatAttachmentBytes,
  getNativeFilePath,
  isImageMime,
  renderMentionMirror,
  resolveLocalAgentComposerTextPresentation,
  shouldCommitLocalAgentAttachment,
  type AtQueryState,
} from "./local-agent-draft-composer-support";
import { assembleLocalAgentPrompt } from "./local-agent-prompt-assembly";

export type {
  LocalAgentAttachment,
  LocalAgentComposerSubmit,
  LocalAgentQuoteChip,
  LocalAgentSlashCommand,
} from "./local-agent-composer-types";
export {
  canSubmitLocalAgentComposer,
  resolveLocalAgentComposerTextPresentation,
  shouldCommitLocalAgentAttachment,
} from "./local-agent-draft-composer-support";
import type {
  LocalAgentAttachment,
  LocalAgentComposerSubmit,
  LocalAgentQuoteChip,
  LocalAgentSlashCommand,
} from "./local-agent-composer-types";

const LONG_PASTE_THRESHOLD = 800;

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
  onStop?: () => void;
  onSlashCommandExecute?: (command: LocalAgentSlashCommand) => void;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  contextUsage?: { used: number; total: number; label?: string | null } | null;
}) {
  const [value, setValue] = useState(props.initialDraft);
  const [slashOpen, setSlashOpen] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<LocalAgentAttachment[]>([]);
  const [quotes, setQuotes] = useState<LocalAgentQuoteChip[]>([]);
  const [mentions, setMentions] = useState<Record<string, string>>({});
  const [atState, setAtState] = useState<AtQueryState>({
    active: false,
    query: "",
    start: -1,
    end: -1,
  });
  const [mentionFiles, setMentionFiles] = useState<LocalAgentComposerFileEntry[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [uploading, setUploading] = useState(0);
  const [uploadFailure, setUploadFailure] = useState<{ file: File; name: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const dragCounterRef = useRef(0);
  const uploadingRef = useRef(0);
  const uploadCountsByDraftRef = useRef(new Map<string, number>());
  const draftKeyRef = useRef(props.draftKey);
  draftKeyRef.current = props.draftKey;
  const fileInputId = `local-agent-file-input-${props.draftKey}`;

  const slashQuery = value.startsWith("/") && !/\s/.test(value) ? value.toLowerCase() : "";
  // Show all live commands from the ACP wrapper (codex-acp publishes 8 builtins
  // plus $skill entries); the menu is already scrollable via max-h-60.
  const visibleSlashCommands = useMemo(
    () =>
      slashQuery
        ? props.slashCommands.filter((command) => command.name.toLowerCase().startsWith(slashQuery))
        : props.slashCommands,
    [props.slashCommands, slashQuery],
  );

  useEffect(() => setValue(props.initialDraft), [props.draftKey, props.initialDraft]);
  useEffect(() => {
    setAttachments([]);
    setQuotes([]);
    setMentions({});
    setUploadFailure(null);
    const count = uploadCountsByDraftRef.current.get(props.draftKey) ?? 0;
    uploadingRef.current = count;
    setUploading(count);
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
    void localAgentComposerListFiles({
      workspaceRoot: props.workspaceRoot,
      query: atState.query,
      limit: 40,
    })
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
    if (
      !canSubmitLocalAgentComposer({
        text,
        attachmentCount: attachments.length,
        quoteCount: quotes.length,
        uploading: uploadingRef.current,
        disabled: props.disabled,
        submitting: props.submitting,
      })
    ) {
      return;
    }
    props.onDraftCommit(props.draftKey, "");
    const assembled = assembleLocalAgentPrompt({ text, attachments, mentions, quotes });
    props.onSubmit({
      text,
      attachments,
      mentions,
      quotes,
      unresolvedMentions: assembled.unresolvedMentions,
    });
    setValue("");
    setAttachments([]);
    setQuotes([]);
    setMentions({});
    setAtState({ active: false, query: "", start: -1, end: -1 });
    setSlashOpen(false);
    setUploadFailure(null);
  }, [attachments, mentions, props, quotes, value]);

  const selectSlashCommand = useCallback(
    (command: LocalAgentSlashCommand) => {
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
    },
    [props],
  );

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

  const insertMention = useCallback(
    (entry: LocalAgentComposerFileEntry) => {
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
    },
    [atState, props, value],
  );

  const addAttachmentFromFile = useCallback(
    async (file: File) => {
      if (!props.workspaceRoot) return;
      const uploadDraftKey = props.draftKey;
      const draftUploadCount = (uploadCountsByDraftRef.current.get(uploadDraftKey) ?? 0) + 1;
      uploadCountsByDraftRef.current.set(uploadDraftKey, draftUploadCount);
      uploadingRef.current = draftUploadCount;
      setUploading(draftUploadCount);
      setUploadFailure(null);
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
          if (kind === "image" && file.size <= LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES) {
            previewUrl = await fileToDataUrl(file).catch(() => undefined);
          }
        } else {
          if (file.size > LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES) {
            throw new Error("attachment exceeds local payload limit");
          }
          const dataUrl = await fileToDataUrl(file);
          const saved = await localAgentComposerSaveAttachment({
            workspaceRoot: props.workspaceRoot,
            name: file.name,
            dataUrl,
            size: file.size,
          });
          absolutePath = saved.path;
          displayPath = saved.path;
          size = saved.size;
          if (kind === "image") previewUrl = dataUrl;
        }
        if (shouldCommitLocalAgentAttachment(draftKeyRef.current, uploadDraftKey)) {
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
        }
      } catch {
        if (shouldCommitLocalAgentAttachment(draftKeyRef.current, uploadDraftKey)) {
          setUploadFailure({ file, name: file.name });
        }
      } finally {
        const remaining = Math.max(0, (uploadCountsByDraftRef.current.get(uploadDraftKey) ?? 1) - 1);
        if (remaining === 0) uploadCountsByDraftRef.current.delete(uploadDraftKey);
        else uploadCountsByDraftRef.current.set(uploadDraftKey, remaining);
        if (draftKeyRef.current === uploadDraftKey) {
          uploadingRef.current = remaining;
          setUploading(remaining);
        }
      }
    },
    [props.draftKey, props.workspaceRoot],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        await addAttachmentFromFile(file);
      }
    },
    [addAttachmentFromFile],
  );

  const handlePaste = useCallback(
    async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
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
    },
    [handleFiles],
  );

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
  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragCounterRef.current = 0;
      setDragActive(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) void handleFiles(files);
    },
    [handleFiles],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((att) => att.id !== id));
  }, []);
  const removeQuote = useCallback((id: string) => {
    setQuotes((current) => current.filter((q) => q.id !== id));
  }, []);

  const retryUpload = useCallback(() => {
    const failure = uploadFailure;
    if (!failure) return;
    void addAttachmentFromFile(failure.file);
  }, [addAttachmentFromFile, uploadFailure]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) return;
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        if (toolMenuOpen) {
          event.preventDefault();
          setToolMenuOpen(false);
          return;
        }
        if (slashOpen) {
          event.preventDefault();
          setSlashOpen(false);
          return;
        }
        if (atState.active) {
          event.preventDefault();
          setAtState({ active: false, query: "", start: -1, end: -1 });
          return;
        }
      }
      if (atState.active && mentionFiles.length) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setMentionIndex((i) => (i + 1) % mentionFiles.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setMentionIndex((i) => (i - 1 + mentionFiles.length) % mentionFiles.length);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          insertMention(mentionFiles[mentionIndex]);
          return;
        }
      }
      if (
        (event.key === "Tab" || event.key === "Enter") &&
        slashOpen &&
        visibleSlashCommands.length
      ) {
        event.preventDefault();
        selectSlashCommand(visibleSlashCommands[0]);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    [
      atState,
      insertMention,
      mentionFiles,
      mentionIndex,
      selectSlashCommand,
      slashOpen,
      submit,
      toolMenuOpen,
      visibleSlashCommands,
    ],
  );

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
  const textPresentation = resolveLocalAgentComposerTextPresentation(mentionSpans.length > 0);
  const canSend = canSubmitLocalAgentComposer({
    text: value,
    attachmentCount: attachments.length,
    quoteCount: quotes.length,
    uploading,
    disabled: props.disabled,
    submitting: props.submitting,
  });

  const hasAttachments =
    attachments.length > 0 || quotes.length > 0 || uploading > 0 || uploadFailure !== null;
  const showStop = Boolean(props.submitting && props.onStop);
  const layout = resolveLocalAgentComposerLayout({
    hasAttachments,
    dragActive,
  });

  return (
    <div
      className="@container/local-composer mac:titlebar-no-drag w-full min-w-0 max-w-full"
      data-local-agent-composer-shell="true"
      data-local-agent-composer-focused={focused ? "true" : "false"}
    >
      <div
        className={layout.panelChromeClass}
        data-local-agent-composer-root="true"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragActive ? (
          <div className={localAgentComposerClass.dropOverlay}>
            <div className="rounded-xl border border-dls-border bg-dls-surface px-5 py-4 text-center text-sm font-medium text-dls-text">
              {t("local_agent.composer_drop_here")}
            </div>
          </div>
        ) : null}
        {slashOpen ? (
          <LocalAgentComposerSlashMenu
            commands={visibleSlashCommands}
            onSelect={selectSlashCommand}
          />
        ) : null}
        {atState.active && mentionFiles.length ? (
          <LocalAgentComposerMentionMenu
            files={mentionFiles}
            mentionIndex={mentionIndex}
            onHover={setMentionIndex}
            onSelect={insertMention}
          />
        ) : null}
        {hasAttachments ? (
          <div className={localAgentComposerClass.attachmentRail}>
            {attachments.map((att) => (
              <div
                key={att.id}
                className={localAgentComposerClass.attachmentChip}
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
                    {att.size ? ` · ${formatAttachmentBytes(att.size)}` : ""}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="ml-0.5 shrink-0 text-dls-secondary opacity-70 hover:bg-dls-hover hover:text-dls-text hover:opacity-100 group-hover/att:opacity-100"
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
                className={localAgentComposerClass.attachmentChip}
                data-testid="local-agent-quote"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface text-dls-secondary">
                  <Quote className="size-3.5" aria-hidden="true" />
                </div>
                <div className="min-w-0 max-w-[14rem]">
                  <div className="truncate text-xs font-medium text-dls-text">
                    {t("local_agent.composer_pasted_text")}
                  </div>
                  <div className="truncate text-2xs text-dls-secondary">
                    {t("local_agent.composer_pasted_lines", { count: q.lines })}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="ml-0.5 shrink-0 text-dls-secondary opacity-70 hover:bg-dls-hover hover:text-dls-text hover:opacity-100 group-hover/att:opacity-100"
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
            {uploadFailure ? (
              <NoticeBox
                tone="error"
                className="flex min-w-0 items-center gap-2"
                role="alert"
                data-testid="local-agent-upload-error"
              >
                <span className="min-w-0 truncate">{uploadFailure.name}</span>
                <span className="shrink-0">{t("files.upload_failed")}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="ml-auto shrink-0 text-dls-status-danger-fg hover:bg-dls-hover"
                  onClick={retryUpload}
                >
                  {t("system.error_action_retry")}
                </Button>
              </NoticeBox>
            ) : null}
          </div>
        ) : null}
        <div className={layout.editorPadClass}>
          <div className="relative">
            <div
              aria-hidden
              data-local-agent-mirror="true"
              className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-composer"
              style={{ color: textPresentation.mirrorColor }}
            >
              {renderMentionMirror(value, mentions)}
            </div>
            <Textarea
              ref={textareaRef}
              rows={2}
              className="relative min-h-[52px] resize-none border-0 bg-transparent p-0 text-composer text-dls-text shadow-none placeholder:text-dls-secondary/70 focus-visible:border-transparent focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-transparent sm:text-composer md:text-composer"
              style={{
                color: textPresentation.textareaColor,
                caretColor: "var(--dls-text, currentColor)",
                WebkitTextFillColor: textPresentation.textareaTextFillColor,
              }}
              aria-label={t("local_agent.input_aria")}
              data-local-agent-composer="true"
              value={value}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={props.placeholder}
              disabled={props.disabled || props.submitting}
            />
          </div>
          <div
            className={localAgentComposerClass.actionRow}
            data-local-agent-composer-toolbar="true"
          >
            <div
              className={localAgentComposerClass.toolsCluster}
              data-local-agent-composer-tools="true"
            >
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
              <div ref={toolMenuRef} className="relative -ml-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={
                    toolMenuOpen
                      ? localAgentComposerClass.activeToolButton
                      : localAgentComposerClass.toolButton
                  }
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
                      "transition-transform duration-200 ease-out motion-reduce:rotate-0 motion-reduce:transition-none",
                      toolMenuOpen ? "rotate-45" : "rotate-0",
                    )}
                  />
                </Button>
                {toolMenuOpen ? (
                  <LocalAgentComposerToolMenu
                    slashCommands={props.slashCommands}
                    onAddFile={openFilePicker}
                    onSelectSlash={selectSlashCommand}
                  />
                ) : null}
              </div>
              {props.toolbarLeft}
            </div>
            <div
              className={localAgentComposerClass.trailingCluster}
              data-local-agent-composer-trailing="true"
            >
              {props.contextUsage ? (
                <ContextUsageIndicator usage={props.contextUsage} size={16} className="p-0.5" />
              ) : null}
              {props.toolbarRight}
              {showStop ? (
                <Button
                  variant="destructive"
                  size="icon-lg"
                  type="button"
                  onClick={props.onStop}
                  className={localAgentComposerClass.stopButton}
                  title={t("composer.stop")}
                  aria-label={t("composer.stop")}
                  data-testid="local-agent-composer-stop"
                >
                  <Square size={12} fill="currentColor" />
                </Button>
              ) : (
                <SendButton
                  type="button"
                  aria-label={t("local_agent.send_aria")}
                  onClick={submit}
                  disabled={!canSend}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
LocalAgentDraftComposer.displayName = "LocalAgentDraftComposer";

export function buildLocalAgentPrompt(payload: LocalAgentComposerSubmit): string {
  // Backwards-compat wrapper. Prefer `assembleLocalAgentPrompt` when the
  // caller also needs `unresolvedMentions` or structured sections.
  return assembleLocalAgentPrompt(payload).text;
}
