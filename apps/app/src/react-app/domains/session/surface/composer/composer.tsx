/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle, ClipboardList, Plus, Square } from "lucide-react";
import type { CloudImportedPluginFile } from "../../../../../app/cloud/import-state";
import type { SlashCommandOption } from "../../../../../app/types";
import type { McpDirectoryInfo } from "../../../../../app/constants";
import { t } from "../../../../../i18n";
import { useDesktopRestriction } from "../../../shared";
import { ModelBehaviorSelect } from "../../../../../components/model-behavior-select";
import { ModelSelectContainer } from "../../components/model-select";
import { Button } from "@/components/ui/button";
import { SendButton } from "@/components/ui/send-button";
import { ContextUsageIndicator } from "../../../local-agents";
import { LexicalPromptEditor } from "./editor";
import { AccessPermissionSelect } from "./access-permission-select";
import { matchComposerSlashQuery } from "./tool-menu-model";
import {
  ReactComposerNotice,
} from "./notice";
import {
  type ComposerProps,
  type MentionItem,
  type ToolMenuSection,
  type CollaborationModeOption,
  composerTextClass,
  composerMenuClass,
  EMPTY_COLLABORATION_MODE,
  DEFAULT_OFFICE_COLLABORATION_MODE,
  collaborationModeValue,
  selectedCollaborationModeKey,
  collaborationModeOptions,
  FLUSH_PROMPT_EVENT,
  FOCUS_PROMPT_EVENT,
  parseClipboardUriList,
  COMPOSER_CONTAIN_STYLE,
  pluginSlashCommandName,
} from "./composer-helpers";
import { ComposerSlashMenu, ComposerMentionMenu } from "./slash-mention-menus";
import { ComposerToolMenu } from "./composer-tool-menu";
import { resolveComposerLayoutClasses } from "./composer-layout";
import { useMentionFolderBrowser } from "./use-mention-folder-browser";
import { useComposerCatalogs } from "./use-composer-catalogs";
import { useComposerAttachments } from "./use-composer-attachments";
import { useComposerAgentMenu } from "./use-composer-agent-menu";
import { useComposerMineFiles } from "./use-composer-mine-files";
import { ComposerAttachmentChips } from "./composer-attachment-chips";

export function ReactSessionComposer(props: ComposerProps) {
  const builtInExtensionsDisabled = useDesktopRestriction("allowBuiltInExtensions");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuSection, setToolMenuSection] = useState<ToolMenuSection>("files");
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState<string | null>(null);
  const [selectedComposerExtension, setSelectedComposerExtension] = useState<McpDirectoryInfo | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [connectorSearchQuery, setConnectorSearchQuery] = useState("");
  const [showDefaultCollaborationChip, setShowDefaultCollaborationChip] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  // IME composition guard: while an IME composition is active, we must not
  // treat Enter as a submit. Three signals keep this reliable across WebKit,
  // Chrome, and Safari: event.isComposing, event.keyCode === 229, and the
  // compositionstart/compositionend events below.
  const imeComposingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef(props.draft);
  // Live draft for slash/mention matching — updated in the same tick as editor
  // onChange so the menu filters while typing even if parent store re-render lags.
  const [liveDraft, setLiveDraft] = useState(props.draft);
  useEffect(() => {
    setLiveDraft(props.draft);
    draftRef.current = props.draft;
  }, [props.draft]);

  const handleDraftChange = useCallback(
    (value: string) => {
      draftRef.current = value;
      setLiveDraft(value);
      props.onDraftChange(value);
    },
    [props.onDraftChange],
  );

  // Open slash menu whenever the caret-side draft ends with `/` or `/partial`.
  // Previous regex required the *entire* draft to be a slash token, so after a
  // skill chip (`/12306 `) a second `/` never opened the menu again.
  const slashToken = matchComposerSlashQuery(liveDraft);
  const slashOpenNext = slashToken.open;
  const slashQuery = slashToken.query;
  const mentionMatch = liveDraft.match(/@([^\s@]*)$/);
  const mentionOpenNext = Boolean(mentionMatch);
  const mentionQuery = mentionMatch?.[1] ?? "";

  useEffect(() => {
    setSlashOpen(slashOpenNext);
    setMenuIndex(0);
  }, [slashOpenNext, slashQuery]);

  useEffect(() => {
    setMentionOpen(mentionOpenNext);
    setMenuIndex(0);
  }, [mentionOpenNext, mentionQuery]);

  const { handleAgentMenuKeyDown } = useComposerAgentMenu({
    listAgents: props.listAgents,
    onSelectAgent: props.onSelectAgent,
  });

  const catalogs = useComposerCatalogs({
    listCommands: props.listCommands,
    listSkills: props.listSkills,
    listMcp: props.listMcp,
    listImportedPlugins: props.listImportedPlugins,
    skillsProp: props.skills,
    mcpServersProp: props.mcpServers,
    mcpStatusProp: props.mcpStatus,
    mcpStatusesProp: props.mcpStatuses,
    importedPluginsProp: props.importedPlugins,
    promptTemplates: props.promptTemplates,
    slashOpen,
    slashQuery,
    toolMenuOpen,
    toolMenuSection,
    skillSearchQuery,
    connectorSearchQuery,
    builtInExtensionsDisabled,
    setSkillSearchQuery,
    setConnectorSearchQuery,
    setSelectedPromptTemplateId,
    setSelectedComposerExtension,
  });

  const mentionBrowser = useMentionFolderBrowser({
    open: mentionOpen,
    query: mentionQuery,
    searchFiles: props.searchFiles,
    listFolderFiles: props.listFolderFiles,
  });
  const mentionFiltered = mentionBrowser.filtered;
  const mentionFolderPath = mentionBrowser.folderPath;

  const {
    addAttachments,
    addSelectedMentionFiles,
    captureAppshot,
    canCaptureAppshot,
  } = useComposerAttachments({
    attachmentsEnabled: props.attachmentsEnabled,
    attachmentsDisabledReason: props.attachmentsDisabledReason,
    onAttachFiles: props.onAttachFiles,
    onNotice: props.onNotice,
    loadWorkspaceFiles: props.loadWorkspaceFiles,
    rootRef,
    draftRef,
    onDraftChange: handleDraftChange,
    setMentionOpen,
    setToolMenuOpen,
    mentionAddSelectedFiles: mentionBrowser.addSelectedFiles,
  });

  const mineFiles = useComposerMineFiles({
    open: toolMenuOpen && toolMenuSection === "mine",
    listFolderFiles: props.listFolderFiles,
    searchFiles: props.searchFiles,
    loadWorkspaceFiles: props.loadWorkspaceFiles,
    addAttachments,
    onAdded: () => setToolMenuOpen(false),
  });

  const activeMenu = slashOpen ? "slash" : mentionOpen ? "mention" : null;
  const activeItems =
    activeMenu === "slash"
      ? catalogs.slashFiltered
      : activeMenu === "mention" && !mentionFolderPath
        ? mentionFiltered
        : [];
  const canSend = props.draft.trim().length > 0 || props.attachments.length > 0;
  const collaborationVariant = props.collaborationModeVariant ?? "legacy";
  const modeOptions = collaborationModeOptions(collaborationVariant);
  const promptTemplates = props.promptTemplates ?? [];
  const selectedPromptTemplate =
    promptTemplates.find((template) => template.id === selectedPromptTemplateId) ?? null;
  const selectedModeKey = selectedCollaborationModeKey(props.collaborationMode, collaborationVariant);
  const selectedModeOption =
    modeOptions.find((option) => option.key === selectedModeKey) ?? null;
  const SelectedModeIcon = selectedModeOption?.Icon ?? ClipboardList;
  const shouldShowCollaborationChip =
    selectedModeOption !== null &&
    (collaborationVariant === "legacy" ||
      selectedModeKey !== "craft" ||
      showDefaultCollaborationChip);

  const applyPromptTemplate = useCallback(
    (templateId: string, prompt: string) => {
      props.onSelectPromptTemplate?.(templateId, prompt);
      setSelectedPromptTemplateId(null);
      setToolMenuOpen(false);
    },
    [props.onSelectPromptTemplate],
  );

  useEffect(() => {
    if (!activeItems.length) {
      setMenuIndex(0);
      return;
    }
    setMenuIndex((current) => Math.max(0, Math.min(current, activeItems.length - 1)));
  }, [activeItems.length]);

  useEffect(() => {
    menuItemRefs.current.length = activeItems.length;
    const target = menuItemRefs.current[menuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [menuIndex, activeItems.length]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolMenuRef.current?.contains(target)) return;
      setToolMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [toolMenuOpen]);

  const applyCommandSelection = (command: SlashCommandOption) => {
    const insertion = `/${command.name} `;
    // Prefer live draft so chip insertion replaces the in-progress `/query`.
    // Drop trailing newlines (Lexical multi-paragraph) so `/obsidian\n` still replaces.
    const draft = liveDraft.replace(/[\n\r]+$/u, "");
    if (/\/[^\s/]*$/u.test(draft)) {
      handleDraftChange(draft.replace(/\/[^\s/]*$/u, insertion));
    } else {
      const needsSpace = draft.length > 0 && !/\s$/u.test(draft);
      handleDraftChange(`${draft}${needsSpace ? " " : ""}${insertion}`);
    }
    setSlashOpen(false);
    setToolMenuOpen(false);
  };

  const applyPluginFileSelection = (file: CloudImportedPluginFile) => {
    const commandName = pluginSlashCommandName(file);
    if (commandName) {
      applyCommandSelection({
        id: `plugin:${file.configObjectId}`,
        name: commandName,
        source: file.objectType === "skill" ? "skill" : "command",
      });
      return;
    }
    props.onInsertMention("file", file.path);
    setToolMenuOpen(false);
  };

  const applyExtensionSelection = (entry: McpDirectoryInfo) => {
    props.onDraftChange(entry.composerPrompt ?? `Use ${entry.name} to `);
    setToolMenuOpen(false);
  };

  const applyExtensionSuggestion = (entry: McpDirectoryInfo, prompt: string) => {
    props.onDraftChange(`${entry.composerPrompt ?? `Use ${entry.name} to `}${prompt}`);
    setSelectedComposerExtension(null);
    setToolMenuOpen(false);
  };

  const openToolMenuSettings = () => {
    props.onOpenSkillsMarketplace?.();
    if (!props.onOpenSkillsMarketplace) {
      props.onOpenSettingsSection?.("skills");
    }
  };

  /** Connectors header configure → custom MCP dialog (or market connectors). */
  const openConnectorsConfigure = () => {
    setToolMenuOpen(false);
    if (props.onOpenConnectorsMarketplace) {
      props.onOpenConnectorsMarketplace();
      return;
    }
    props.onOpenSettingsSection?.("mcps");
  };

  /** Custom MCP editor / fallback when marketplace is unavailable. */
  const openCustomConnectorOrMarketplace = () => {
    setToolMenuOpen(false);
    if (props.onOpenCustomConnector) {
      props.onOpenCustomConnector();
      return;
    }
    props.onOpenConnectorsMarketplace?.();
  };

  const openFilePicker = () => {
    if (!props.attachmentsEnabled) return;
    setToolMenuOpen(false);
    fileInputRef.current?.click();
  };

  const applyCollaborationModeSelection = (
    option: CollaborationModeOption,
    options?: { keepMenuOpen?: boolean },
  ) => {
    props.onCollaborationModeChange(collaborationModeValue(option.key));
    // Craft/default is silent — only surface a chip for non-default modes.
    setShowDefaultCollaborationChip(option.key !== "craft");
    if (!options?.keepMenuOpen) {
      setToolMenuOpen(false);
    }
  };

  const clearCollaborationModeSelection = () => {
    setShowDefaultCollaborationChip(false);
    props.onCollaborationModeChange(
      collaborationVariant === "office"
        ? DEFAULT_OFFICE_COLLABORATION_MODE
        : EMPTY_COLLABORATION_MODE,
    );
  };

  const selectMentionItem = (item: MentionItem) => {
    if (item.kind === "directory") {
      mentionBrowser.openFolder(item.value);
      return;
    }
    props.onInsertMention(item.kind, item.value);
    setMentionOpen(false);
  };

  const acceptActiveItem = () => {
    if (!activeItems.length) return false;
    if (activeMenu === "slash") {
      const command = catalogs.slashFiltered[menuIndex];
      if (!command) return false;
      applyCommandSelection(command);
      return true;
    }
    if (activeMenu === "mention") {
      const item = mentionFiltered[menuIndex];
      if (!item) return false;
      selectMentionItem(item);
      return true;
    }
    return false;
  };

  // Listen for cross-app focus + draft flush events. The Solid shell uses
  // these from deep-link handlers, the command palette, and the browser
  // pagehide/beforeunload cycle so no in-flight draft is lost.
  useEffect(() => {
    const handleFocus = () => {
      const root = rootRef.current;
      if (!root) return;
      const editable = root.querySelector<HTMLElement>("[contenteditable='true']");
      editable?.focus();
    };
    const handleFlush = () => {
      // onDraftChange always runs synchronously on every keystroke, so this
      // listener is effectively a hook for the shell to signal "we're about
      // to unmount, commit any debounced state". Re-fire with the current
      // draft so downstream stores can checkpoint it.
      props.onDraftChange(draftRef.current);
    };
    window.addEventListener(FOCUS_PROMPT_EVENT, handleFocus);
    window.addEventListener(FLUSH_PROMPT_EVENT, handleFlush);
    window.addEventListener("beforeunload", handleFlush);
    window.addEventListener("pagehide", handleFlush);
    return () => {
      window.removeEventListener(FOCUS_PROMPT_EVENT, handleFocus);
      window.removeEventListener(FLUSH_PROMPT_EVENT, handleFlush);
      window.removeEventListener("beforeunload", handleFlush);
      window.removeEventListener("pagehide", handleFlush);
    };
  }, [props.onDraftChange]);

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // IME composition guard — block Enter while IME is mid-character.
    const imeActive =
      imeComposingRef.current ||
      (event.nativeEvent as KeyboardEvent).isComposing === true ||
      event.keyCode === 229;
    if (event.key === "Enter" && imeActive) {
      return;
    }
    if (handleAgentMenuKeyDown(event)) return;

    if (toolMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setToolMenuOpen(false);
      return;
    }

    if (mentionOpen && mentionFolderPath && event.key === "Escape") {
      event.preventDefault();
      mentionBrowser.backFolder();
      return;
    }

    if (!activeMenu || !activeItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMenuIndex((current) => (current + 1) % activeItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMenuIndex((current) => (current - 1 + activeItems.length) % activeItems.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      void acceptActiveItem();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSlashOpen(false);
      setMentionOpen(false);
    }
  };

  const layout = resolveComposerLayoutClasses({
    homeLayout: props.homeLayout,
    heroHome: props.heroHome,
    showOuterBorder: props.showOuterBorder,
    compactTopSpacing: props.compactTopSpacing,
    hasBottomAccessory: Boolean(props.bottomAccessory),
    hasAttachments: props.attachments.length > 0,
    mentionOpen,
    slashOpen,
  });
  const {
    homeLayout,
    heroHome,
    inlineToolbarAccessory,
    underCardAccessory,
    panelChromeClass,
    editorPadClass,
    rootChromeClass,
    contentMaxWidthClass,
  } = layout;

  return (
    <div
      ref={rootRef}
      className={`sticky bottom-0 mac:titlebar-no-drag ${toolMenuOpen ? "z-50" : "z-20"} ${rootChromeClass}`}
      style={COMPOSER_CONTAIN_STYLE}
      onKeyDownCapture={handleKeyDownCapture}
      onCompositionStart={() => {
        imeComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        imeComposingRef.current = false;
      }}
    >
      <div className={`mx-auto w-full ${contentMaxWidthClass}`}>
        {/* Main composer panel — input + primary toolbar only (WorkBuddy layout). */}
        <div className={panelChromeClass}>
          {props.topAccessory ? <div className="relative z-10">{props.topAccessory}</div> : null}
          <ReactComposerNotice notice={props.notice} />

          <ComposerMentionMenu
            open={mentionOpen}
            filtered={mentionFiltered}
            folderPath={mentionFolderPath}
            folderItems={mentionBrowser.folderItems}
            folderLoading={mentionBrowser.folderLoading}
            folderAdding={mentionBrowser.folderAdding}
            folderError={mentionBrowser.folderError}
            selectedFilePaths={mentionBrowser.selectedFilePaths}
            activeMenu={activeMenu}
            menuIndex={menuIndex}
            menuItemRefs={menuItemRefs}
            setMenuIndex={setMenuIndex}
            onSelect={selectMentionItem}
            onOpenFolder={mentionBrowser.openFolder}
            onBackFolder={mentionBrowser.backFolder}
            onToggleFile={mentionBrowser.toggleFile}
            onAddSelectedFiles={() => void addSelectedMentionFiles()}
          />
          <ComposerSlashMenu
            open={slashOpen}
            filtered={catalogs.slashFiltered}
            commandsLoaded={catalogs.commandsLoaded}
            commandsLoading={catalogs.commandsLoading}
            activeMenu={activeMenu}
            menuIndex={menuIndex}
            menuItemRefs={menuItemRefs}
            setMenuIndex={setMenuIndex}
            onSelect={applyCommandSelection}
          />

          <ComposerAttachmentChips
            attachments={props.attachments}
            onRemoveAttachment={props.onRemoveAttachment}
          />

          {/*
            Plain text pastes stay as text in the editor. We intentionally do
            not render a pasted-text chip or rail here.
          */}

          {dropzoneActive ? (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-dls-accent bg-dls-accent-mix-10">
              <div className="rounded-xl border border-dls-border bg-dls-surface px-5 py-4 text-center backdrop-blur-sm">
                <div className="text-sm font-medium text-dls-text">{t("composer.attach_files")}</div>
                <div className="mt-1 text-xs text-dls-secondary">{t("composer.any_file_type_supported")}</div>
              </div>
            </div>
          ) : null}

          <div className={editorPadClass}>
            {/* Editor */}
            <LexicalPromptEditor
              sessionId={props.sessionId}
              value={props.draft}
              mentions={props.mentions}
              scenarioTags={props.scenarioTags}
              disabled={props.disabled}
              compact={homeLayout && !heroHome}
              hero={heroHome}
              placeholder={props.placeholder ?? t("composer.placeholder")}
              onChange={handleDraftChange}
              onSubmit={props.onSend}
              onPaste={(event) => {
                // Paste policy:
                // 1. Actual files on the clipboard -> attach them.
                // 2. Explicit text/uri-list (drag from Finder / browser) -> insert links.
                // 3. Plain text -> DO NOTHING. Let Lexical's PlainTextPlugin
                //    handle the paste natively so newlines render correctly
                //    and no content is silently dropped. Previous behavior
                //    hijacked pastes that merely contained absolute paths
                //    like "/Users/..." or pastes longer than 10 lines, which
                //    was the root cause of "paste into composer is broken".
                const files = Array.from(event.clipboardData?.files ?? []);
                if (files.length) {
                  event.preventDefault();
                  void addAttachments(files);
                  return;
                }

                const uriList = event.clipboardData
                  ? parseClipboardUriList(event.clipboardData)
                  : [];
                if (uriList.length) {
                  event.preventDefault();
                  props.onUnsupportedFileLinks(uriList);
                  props.onNotice({
                    title: t("composer.inserted_links_unsupported"),
                    tone: "info",
                  });
                  return;
                }

                const text = event.clipboardData?.getData("text/plain") ?? "";

                // Plain long text pastes stay as editable text. Historical
                // paste chips remain readable through the editor renderer, but
                // new clipboard text should not collapse into a tag.

                if (
                  text.trim() &&
                  (props.isRemoteWorkspace || props.isSandboxWorkspace) &&
                  /file:\/\/|(^|\s)\/(Users|home|var|etc|opt|tmp|private|Volumes|Applications)\//.test(text)
                ) {
                  const attachedFiles = props.attachments.map((attachment) => attachment.file);
                  props.onNotice({
                    title: t("composer.remote_worker_paste_warning"),
                    tone: "warning",
                    actionLabel:
                      props.onUploadInboxFiles && attachedFiles.length > 0
                        ? t("composer.upload_to_shared_folder")
                        : undefined,
                    onAction:
                      props.onUploadInboxFiles && attachedFiles.length > 0
                        ? () => void props.onUploadInboxFiles?.(attachedFiles)
                        : undefined,
                  });
                  // Intentionally no preventDefault — the notice is advisory,
                  // the paste still goes through the editor.
                }
              }}
              onDragOver={(event) => {
                if (event.dataTransfer?.files?.length) {
                  event.preventDefault();
                  if (!dropzoneActive) setDropzoneActive(true);
                }
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                setDropzoneActive(false);
              }}
              onDrop={(event) => {
                const files = Array.from(event.dataTransfer?.files ?? []);
                setDropzoneActive(false);
                if (!files.length) return;
                event.preventDefault();
                void addAttachments(files);
              }}
            />

            {/* Action row — tools left; reasoning + model + send as a tight right cluster */}
            <div className="mt-2 flex items-end justify-between gap-2">
              <div className="flex min-w-0 flex-nowrap items-center gap-0.5 overflow-visible">
                <input
                  ref={(element) => {
                    fileInputRef.current = element;
                  }}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    if (files.length) void addAttachments(files);
                    event.currentTarget.value = "";
                  }}
                />
                <div ref={toolMenuRef} className="relative -ml-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={toolMenuOpen ? composerMenuClass.activeToolButton : composerMenuClass.toolButton}
                    onClick={() => {
                      setMentionOpen(false);
                      setSlashOpen(false);
                      setToolMenuOpen((value) => {
                        const nextOpen = !value;
                        if (nextOpen) {
                          setToolMenuSection("files");
                          setSelectedPromptTemplateId(null);
                        }
                        return nextOpen;
                      });
                    }}
                    aria-expanded={toolMenuOpen}
                    aria-haspopup="dialog"
                    title={t("composer.quick_actions")}
                    aria-label={t("composer.quick_actions")}
                  >
                    <Plus
                      size={16}
                      className={`transition-transform duration-200 ease-out ${toolMenuOpen ? "rotate-45" : "rotate-0"}`}
                    />
                  </Button>
                  {toolMenuOpen ? (
                    <ComposerToolMenu
                      toolMenuSection={toolMenuSection}
                      setToolMenuSection={setToolMenuSection}
                      attachmentsEnabled={Boolean(props.attachmentsEnabled)}
                      canCaptureAppshot={canCaptureAppshot}
                      openFilePicker={openFilePicker}
                      captureAppshot={captureAppshot}
                      minePanel={{
                        title: mineFiles.title,
                        searchQuery: mineFiles.searchQuery,
                        setSearchQuery: mineFiles.setSearchQuery,
                        items: mineFiles.items,
                        loading: mineFiles.loading,
                        adding: mineFiles.adding,
                        error: mineFiles.error,
                        selectedFilePaths: mineFiles.selectedFilePaths,
                        canGoBack: mineFiles.canGoBack,
                        onBack: mineFiles.backFolder,
                        onOpenFolder: mineFiles.openFolder,
                        onToggleFile: mineFiles.toggleFile,
                        onAddSelected: () => {
                          void mineFiles.addSelectedFiles();
                        },
                      }}
                      promptTemplates={promptTemplates}
                      selectedPromptTemplateId={selectedPromptTemplateId}
                      setSelectedPromptTemplateId={setSelectedPromptTemplateId}
                      selectedPromptTemplate={selectedPromptTemplate}
                      applyPromptTemplate={applyPromptTemplate}
                      collaborationVariant={collaborationVariant}
                      modeOptions={modeOptions}
                      selectedModeKey={selectedModeKey}
                      applyCollaborationModeSelection={applyCollaborationModeSelection}
                      skillSearchQuery={skillSearchQuery}
                      setSkillSearchQuery={setSkillSearchQuery}
                      connectorSearchQuery={connectorSearchQuery}
                      setConnectorSearchQuery={setConnectorSearchQuery}
                      filteredSkillItems={catalogs.filteredSkillItems}
                      filteredPluginSkillFiles={catalogs.filteredPluginSkillFiles}
                      filteredMcpItems={catalogs.filteredMcpItems}
                      filteredComposerExtensions={catalogs.filteredComposerExtensions}
                      hasSkillMatches={catalogs.hasSkillMatches}
                      hasSkills={catalogs.hasSkills}
                      hasConnectorMatches={catalogs.hasConnectorMatches}
                      hasConnectors={catalogs.hasConnectors}
                      commandsLoaded={catalogs.commandsLoaded}
                      commandsLoading={catalogs.commandsLoading}
                      skillsLoaded={catalogs.skillsLoaded}
                      skillsLoading={catalogs.skillsLoading}
                      mcpLoaded={catalogs.mcpLoaded}
                      mcpLoading={catalogs.mcpLoading}
                      mcpStatus={catalogs.mcpStatus}
                      pinnedSkillIds={catalogs.pinnedSkillIds}
                      handleTogglePinnedSkill={catalogs.handleTogglePinnedSkill}
                      applyCommandSelection={applyCommandSelection}
                      applyPluginFileSelection={applyPluginFileSelection}
                      applyExtensionSelection={applyExtensionSelection}
                      applyExtensionSuggestion={applyExtensionSuggestion}
                      selectedComposerExtension={selectedComposerExtension}
                      setSelectedComposerExtension={setSelectedComposerExtension}
                      openToolMenuSettings={openToolMenuSettings}
                      openConnectorsConfigure={openConnectorsConfigure}
                      openCustomConnectorOrMarketplace={openCustomConnectorOrMarketplace}
                      setToolMenuOpen={setToolMenuOpen}
                      setExtensionStateVersion={catalogs.setExtensionStateVersion}
                    />
                  ) : null}
                </div>
                {inlineToolbarAccessory ? (
                  <div className="flex min-w-0 shrink items-center">
                    {props.bottomAccessory}
                  </div>
                ) : null}
                {shouldShowCollaborationChip && selectedModeOption ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="max-w-40 shrink-0 gap-1.5 border border-dls-border-strong bg-dls-surface-solid px-2 text-dls-text hover:bg-dls-hover"
                    onClick={clearCollaborationModeSelection}
                    title={t("composer.remove_collaboration_mode", { mode: selectedModeOption.label })}
                    aria-label={t("composer.remove_collaboration_mode", { mode: selectedModeOption.label })}
                  >
                    <SelectedModeIcon size={14} className="shrink-0" />
                    <span className="min-w-0 truncate">{selectedModeOption.label}</span>
                  </Button>
                ) : null}
                {props.hideAccessPermissionSelect ? null : (
                  <AccessPermissionSelect
                    value={props.accessMode}
                    onChange={props.onAccessModeChange}
                  />
                )}
              </div>

              {/* Model controls + send stay as a tight trailing cluster so
                  “深度 / reasoning” is not stranded mid-toolbar with empty flex. */}
              <div className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5">
                {props.modelUnavailable ? null : (
                  <ModelBehaviorSelect
                    value={props.modelVariant}
                    label={props.modelVariantLabel}
                    options={props.modelBehaviorOptions}
                    onChange={props.onModelVariantChange}
                    disabled={props.busy}
                  />
                )}
                {props.modelUnavailable ? (
                  <button
                    type="button"
                    className={composerTextClass.modelUnavailable}
                    onClick={() => {
                      // Closed loop: unavailable model → AI/provider settings
                      // so users can reconnect credentials or pick another
                      // default. Model select next door still switches models.
                      if (props.onOpenSettingsSection) {
                        props.onOpenSettingsSection("ai");
                        return;
                      }
                      props.onModelPickerOpenChange(true);
                    }}
                    title={t("system.error_action_open_ai_settings")}
                    aria-label={t("settings.model_unavailable")}
                  >
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">
                      {t("settings.model_unavailable")}
                    </span>
                  </button>
                ) : null}
                {props.contextUsage ? (
                  <ContextUsageIndicator
                    usage={props.contextUsage}
                    size={16}
                    className="p-0.5"
                  />
                ) : null}
                <ModelSelectContainer
                  open={props.modelPickerOpen}
                  value={props.selectedModel}
                  onOpenChange={props.onModelPickerOpenChange}
                  onChange={props.onModelChange}
                  disabled={props.busy}
                />
                {props.busy && !canSend ? (
                  <Button variant="destructive" size="icon-lg"
                    type="button"
                    onClick={props.onStop}
                    className="rounded-full bg-dls-status-danger text-white hover:bg-dls-status-danger-fg"
                    title={t("composer.stop")}
                    aria-label={t("composer.stop")}
                  >
                    <Square size={12} fill="currentColor" />
                  </Button>
                ) : (
                  <SendButton
                    type="button"
                    onClick={
                      canSend && !props.modelUnavailable
                        ? props.onSend
                        : props.busy
                          ? props.onStop
                          : undefined
                    }
                    disabled={
                      props.disabled ||
                      props.modelUnavailable ||
                      (!canSend && !props.busy)
                    }
                    title={
                      props.modelUnavailable
                        ? t("settings.model_unavailable")
                        : t("composer.send_message")
                    }
                    aria-label={
                      props.modelUnavailable
                        ? t("settings.model_unavailable")
                        : t("composer.send_message")
                    }
                  />
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Secondary chrome under the card (in-session only). Home folds this into the toolbar. */}
        {underCardAccessory ? (
          <div
            className={`relative z-10 mt-0 flex min-h-9 w-full items-center rounded-t-none rounded-b-xl bg-dls-surface-muted px-2 py-1 text-xs font-normal leading-none text-dls-secondary${
              props.showOuterBorder ? " border border-t-0 border-dls-border shadow-sm" : ""
            }`}
          >
            {props.bottomAccessory}
          </div>
        ) : null}
      </div>
    </div>
  );
}
