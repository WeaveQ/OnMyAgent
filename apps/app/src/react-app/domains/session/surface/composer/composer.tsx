/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { AlertCircle, Camera, Check, ChevronRight, ClipboardList, FileText, MessageCircle, Paperclip, Plus, Plug, Rocket, Search, Settings, Sparkles, Square, Target, Terminal, X, Zap } from "lucide-react";
import fuzzysort from "fuzzysort";
import { ONMYAGENT_EXTENSION_CATALOG, type McpDirectoryInfo } from "../../../../../app/constants";
import { desktopBridge } from "../../../../../app/lib/desktop";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { MenuRowButton, MenuRowSurface } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { SendButton } from "@/components/ui/send-button";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import type { CloudImportedPlugin, CloudImportedPluginFile } from "../../../../../app/cloud/import-state";
import type { ComposerAccessMode, ComposerAttachment, ComposerCollaborationMode, McpServerEntry, McpStatusMap, ModelRef, SkillCard, SlashCommandOption } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { isOnMyAgentExtensionEnabled, isOnMyAgentExtensionHidden, ONMYAGENT_EXTENSION_STATE_CHANGED, useDesktopRestriction } from "../../../shared";
import { ModelBehaviorSelect } from "../../../../../components/model-behavior-select";
import { ModelSelectContainer } from "../../components/model-select";
import { LexicalPromptEditor } from "./editor";
import { AccessPermissionSelect } from "./access-permission-select";
import {
  collaborationModeOptionKeys,
  filterToolMenuItems,
  formatPluginObjectType,
  pluginSkillFileSearchText,
  skillMenuDescription,
  type CollaborationModeOptionKey,
} from "./tool-menu-model";
import {
  ReactComposerNotice,
  type ReactComposerNotice as ReactComposerNoticeData,
} from "./notice";
import {
  type ComposerProps,
  type MentionItem,
  type PastedTextChip,
  type ToolMenuSection,
  type ToolMenuSettingsSection,
  type CollaborationModeOption,
  type ComposerPromptTemplate,
  type McpServerStatus,
  composerTextClass,
  composerMenuClass,
  EMPTY_COLLABORATION_MODE,
  DEFAULT_OFFICE_COLLABORATION_MODE,
  collaborationModeValue,
  selectedCollaborationModeKey,
  collaborationModeOptions,
  isComposerExtensionAvailable,
  FLUSH_PROMPT_EVENT,
  FOCUS_PROMPT_EVENT,
  MAX_ATTACHMENT_BYTES,
  parseClipboardUriList,
  formatBytes,
  isImageAttachment,
  compressImageFile,
  formatMcpStatusLabel,
  toReactMcpStatus,
  mcpStatusBadgeTone,
  mcpServerDescription,
  COMPOSER_CONTAIN_STYLE,
  extensionIcon,
  pluginSlashCommandName,
} from "./composer-helpers";

export function ReactSessionComposer(props: ComposerProps) {
  const builtInExtensionsDisabled = useDesktopRestriction("allowBuiltInExtensions");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [commands, setCommands] = useState<SlashCommandOption[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillCard[]>(props.skills ?? []);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>(props.mcpServers ?? []);
  const [mcpStatus, setMcpStatus] = useState<string | null>(props.mcpStatus ?? null);
  const [mcpStatuses, setMcpStatuses] = useState<McpStatusMap>(props.mcpStatuses ?? {});
  const [importedPlugins, setImportedPlugins] = useState<CloudImportedPlugin[]>(props.importedPlugins ?? []);
  const [slashOpen, setSlashOpen] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuSection, setToolMenuSection] = useState<ToolMenuSection>("files");
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState<string | null>(null);
  const [selectedComposerExtension, setSelectedComposerExtension] = useState<McpDirectoryInfo | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [connectorSearchQuery, setConnectorSearchQuery] = useState("");
  const [showDefaultCollaborationChip, setShowDefaultCollaborationChip] = useState(false);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commandsCacheRef = useRef<SlashCommandOption[] | null>(null);
  const commandsRequestRef = useRef<Promise<SlashCommandOption[]> | null>(null);
  const commandsLoadVersionRef = useRef(0);
  const listCommandsRef = useRef(props.listCommands);
  const listSkillsRef = useRef(props.listSkills);
  const listMcpRef = useRef(props.listMcp);
  const listImportedPluginsRef = useRef(props.listImportedPlugins);
  const toolMenuLoadRef = useRef({
    openId: 0,
    commands: false,
    skills: false,
    mcps: false,
    plugins: false,
  });
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [skillsLoaded, setSkillsLoaded] = useState(Boolean(props.skills));
  const [mcpLoaded, setMcpLoaded] = useState(Boolean(props.mcpServers));
  const [, setExtensionStateVersion] = useState(0);
  const [agentMenuIndex, setAgentMenuIndex] = useState(0);
  const agentItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  // IME composition guard: while an IME composition is active, we must not
  // treat Enter as a submit. Three signals keep this reliable across WebKit,
  // Chrome, and Safari: event.isComposing, event.keyCode === 229, and the
  // compositionstart/compositionend events below.
  const imeComposingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef(props.draft);
  useEffect(() => {
    draftRef.current = props.draft;
  }, [props.draft]);

  const slashMatch = props.draft.match(/^\/(\S*)$/);
  const slashOpenNext = Boolean(slashMatch);
  const slashQuery = slashMatch?.[1] ?? "";
  const mentionMatch = props.draft.match(/@([^\s@]*)$/);
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

  useEffect(() => {
    if (!agentMenuOpen) return;
    void props.listAgents().then(setAgents).catch(() => setAgents([]));
  }, [agentMenuOpen, props.listAgents]);

  useEffect(() => {
    setSkills(props.skills ?? []);
  }, [props.skills]);

  useEffect(() => {
    setMcpServers(props.mcpServers ?? []);
    setMcpStatus(props.mcpStatus ?? null);
    setMcpStatuses(props.mcpStatuses ?? {});
  }, [props.mcpServers, props.mcpStatus, props.mcpStatuses]);

  useEffect(() => {
    setImportedPlugins(props.importedPlugins ?? []);
  }, [props.importedPlugins]);

  useEffect(() => {
    listCommandsRef.current = props.listCommands;
  }, [props.listCommands]);

  useEffect(() => {
    listSkillsRef.current = props.listSkills;
  }, [props.listSkills]);

  useEffect(() => {
    listMcpRef.current = props.listMcp;
  }, [props.listMcp]);

  useEffect(() => {
    listImportedPluginsRef.current = props.listImportedPlugins;
  }, [props.listImportedPlugins]);

  useEffect(() => {
    setAgentMenuIndex(0);
  }, [agentMenuOpen]);

  useEffect(() => {
    const target = agentItemRefs.current[agentMenuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [agentMenuIndex, agentMenuOpen]);

  useEffect(() => {
    commandsLoadVersionRef.current += 1;
    commandsCacheRef.current = null;
    commandsRequestRef.current = null;
  }, [props.listCommands]);

  const loadCommands = useCallback(() => {
    if (commandsCacheRef.current !== null) {
      return Promise.resolve(commandsCacheRef.current);
    }
    if (commandsRequestRef.current) {
      return commandsRequestRef.current;
    }
    const version = commandsLoadVersionRef.current;
    const request = listCommandsRef.current().then((next) => {
      if (commandsLoadVersionRef.current === version) {
        commandsCacheRef.current = next;
      }
      return next;
    }).finally(() => {
      if (commandsLoadVersionRef.current === version) {
        commandsRequestRef.current = null;
      }
    });
    commandsRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    const refresh = () => setExtensionStateVersion((value) => value + 1);
    window.addEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!toolMenuOpen) return;
    toolMenuLoadRef.current = {
      openId: toolMenuLoadRef.current.openId + 1,
      commands: false,
      skills: false,
      mcps: false,
      plugins: false,
    };
    setCommandsLoaded(false);
    setSkillsLoaded(Boolean(props.skills));
    setMcpLoaded(Boolean(props.mcpServers));
  }, [toolMenuOpen]);

  useEffect(() => {
    setSkillSearchQuery("");
    setConnectorSearchQuery("");
    if (!toolMenuOpen || toolMenuSection !== "templates") {
      setSelectedPromptTemplateId(null);
    }
    if (!toolMenuOpen || toolMenuSection !== "mcps") {
      setSelectedComposerExtension(null);
    }
  }, [toolMenuOpen, toolMenuSection]);

  useEffect(() => {
    if (!slashOpen && !toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    if (toolMenuOpen && toolMenuLoadRef.current.commands) return;
    if (toolMenuOpen) toolMenuLoadRef.current.commands = true;
    let cancelled = false;
    const cached = commandsCacheRef.current;
    if (cached !== null) {
      setCommands(cached);
      setCommandsLoading(false);
      if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    setCommandsLoading(true);
    void loadCommands()
      .then((next) => {
        if (!cancelled) {
          setCommands(next);
          if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommands([]);
          if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
        }
      })
      .finally(() => {
        if (!cancelled) setCommandsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slashOpen, toolMenuOpen, loadCommands]);

  useEffect(() => {
    if (!mentionOpen) return;
    let cancelled = false;
    void Promise.all([props.listAgents(), props.searchFiles(mentionQuery)]).then(([agentList, files]) => {
      if (cancelled) return;
      const recent = props.recentFiles.slice(0, 8);
      const next: MentionItem[] = [
        ...agentList.map((agent) => ({ id: `agent:${agent.name}`, kind: "agent" as const, value: agent.name, label: agent.name })),
        ...recent.map((file) => ({ id: `file:${file}`, kind: "file" as const, value: file, label: file })),
        ...files.filter((file) => !recent.includes(file)).map((file) => ({ id: `file:${file}`, kind: "file" as const, value: file, label: file })),
      ];
      setMentionItems(next);
    }).catch(() => {
      if (!cancelled) setMentionItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, mentionQuery, props.listAgents, props.recentFiles, props.searchFiles]);

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

  useEffect(() => {
    if (!agentMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (agentMenuRef.current?.contains(target)) return;
      setAgentMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [agentMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    const listImportedPlugins = listImportedPluginsRef.current;
    if (listImportedPlugins && !toolMenuLoadRef.current.plugins) {
      let cancelled = false;
      toolMenuLoadRef.current.plugins = true;
      void listImportedPlugins()
        .then((next) => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setImportedPlugins(next);
          }
        })
        .catch(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setImportedPlugins([]);
          }
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    const listSkills = listSkillsRef.current;
    const listMcp = listMcpRef.current;
    if (toolMenuSection === "skills" && listSkills && !toolMenuLoadRef.current.skills) {
      let cancelled = false;
      toolMenuLoadRef.current.skills = true;
      setSkillsLoading(true);
      void listSkills()
        .then((next) => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setSkills(next);
            setSkillsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setSkills([]);
            setSkillsLoaded(true);
          }
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setSkillsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (toolMenuSection === "mcps" && listMcp && !toolMenuLoadRef.current.mcps) {
      let cancelled = false;
      toolMenuLoadRef.current.mcps = true;
      setMcpLoading(true);
      void listMcp()
        .then((next) => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setMcpServers(next.servers);
          setMcpStatuses(next.statuses);
          setMcpStatus(next.status);
          setMcpLoaded(true);
        })
        .catch(() => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setMcpServers([]);
          setMcpStatuses({});
          setMcpLoaded(true);
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setMcpLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [toolMenuOpen, toolMenuSection]);

  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    if (!slashQuery) return commands.slice(0, 8);
    return fuzzysort.go(slashQuery, commands, { keys: ["name", "description"], limit: 8 }).map((entry) => entry.obj);
  }, [commands, slashOpen, slashQuery]);
  const mentionFiltered = useMemo(() => {
    if (!mentionOpen) return [];
    if (!mentionQuery) return mentionItems.slice(0, 8);
    return fuzzysort.go(mentionQuery, mentionItems, { keys: ["label"], limit: 8 }).map((entry) => entry.obj);
  }, [mentionItems, mentionOpen, mentionQuery]);
  const activeMenu = slashOpen ? "slash" : mentionOpen ? "mention" : null;
  const activeItems = activeMenu === "slash" ? slashFiltered : activeMenu === "mention" ? mentionFiltered : [];
  const toolCommandItems = commands.filter((command) => !command.source || command.source === "command");
  const toolSkillItems = commands.filter((command) => command.source === "skill");
  const pluginSkillFiles = importedPlugins.flatMap((plugin) =>
    plugin.files.filter((file) => file.objectType === "command" || file.objectType === "skill"),
  );
  const composerExtensions = ONMYAGENT_EXTENSION_CATALOG.filter((entry) =>
    !builtInExtensionsDisabled &&
    !isOnMyAgentExtensionHidden(entry) && isComposerExtensionAvailable(entry)
  );
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

  const applyCommandSelection = (command: SlashCommandOption) => {
    props.onDraftChange(`/${command.name} `);
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

  const acceptActiveItem = () => {
    if (!activeItems.length) return false;
    if (activeMenu === "slash") {
      const command = slashFiltered[menuIndex];
      if (!command) return false;
      applyCommandSelection(command);
      return true;
    }
    if (activeMenu === "mention") {
      const item = mentionFiltered[menuIndex];
      if (!item) return false;
      props.onInsertMention(item.kind, item.value);
      setMentionOpen(false);
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

  const handleKeyDownCapture: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    // IME composition guard — block Enter while IME is mid-character.
    const imeActive =
      imeComposingRef.current ||
      (event.nativeEvent as KeyboardEvent).isComposing === true ||
      event.keyCode === 229;
    if (event.key === "Enter" && imeActive) {
      return;
    }
    if (agentMenuOpen) {
      const total = agents.length + 1;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setAgentMenuIndex((current) => (current + 1) % total);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setAgentMenuIndex((current) => (current - 1 + total) % total);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = agentMenuIndex === 0 ? null : agents[agentMenuIndex - 1]?.name ?? null;
        props.onSelectAgent(selected);
        setAgentMenuOpen(false);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAgentMenuOpen(false);
        return;
      }
    }

    if (toolMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setToolMenuOpen(false);
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

  const addAttachments = async (inputFiles: File[]) => {
    if (!inputFiles.length) return;
    if (!props.attachmentsEnabled) {
      props.onNotice({
        title: props.attachmentsDisabledReason ?? t("composer.attachments_unavailable"),
        tone: "warning",
      });
      return;
    }

    const accepted: File[] = [];
    const oversize: string[] = [];

    for (const original of inputFiles) {
      const processed = original.type.startsWith("image/") ? await compressImageFile(original) : original;
      if (processed.size > MAX_ATTACHMENT_BYTES) {
        oversize.push(processed.name || original.name);
        continue;
      }
      accepted.push(processed);
    }

    if (accepted.length) {
      props.onAttachFiles(accepted);
      props.onNotice({
        title:
          accepted.length === 1
            ? t("composer.uploaded_single_file", { name: accepted[0]?.name ?? t("composer.file_kind") })
            : t("composer.uploaded_multiple_files", { count: accepted.length }),
        tone: "success",
      });
    }

    if (oversize.length) {
      props.onNotice({
        title:
          oversize.length === 1
            ? t("composer.file_exceeds_limit", { name: oversize[0] })
            : `${oversize.length} files exceed the 8MB limit.`,
        tone: "warning",
      });
    }

  };

  const attachAppshot = async (payload: unknown) => {
    if (typeof payload !== "object" || payload === null) return;
    if (!("name" in payload) || typeof payload.name !== "string") return;
    if (!("mimeType" in payload) || typeof payload.mimeType !== "string") return;
    if (!("data" in payload) || typeof payload.data !== "string") return;
    const binary = atob(payload.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    await addAttachments([
      new File([bytes], payload.name, {
        type: payload.mimeType,
        lastModified: Date.now(),
      }),
    ]);
  };

  const canCaptureAppshot = Boolean(
    typeof window !== "undefined" && window.__ONMYAGENT_ELECTRON__?.computerUse,
  );

  const captureAppshot = async () => {
    if (!props.attachmentsEnabled || !canCaptureAppshot) return;
    setToolMenuOpen(false);
    try {
      await attachAppshot(await desktopBridge.captureComputerUseAppshot());
    } catch (error) {
      props.onNotice({
        title: error instanceof Error ? error.message : t("composer.appshot_failed"),
        tone: "warning",
      });
    }
  };

  useEffect(() => {
    const subscribe = window.__ONMYAGENT_ELECTRON__?.computerUse?.onAppshot;
    if (!subscribe) return;
    return subscribe((payload) => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return;
      void attachAppshot(payload);
    });
  });

  const activeMcpItems = mcpServers.map((entry) => ({
    entry,
    status: toReactMcpStatus(entry.name, entry, mcpStatuses),
  }));
  const combinedSkillItems = [
    ...toolCommandItems,
    ...toolSkillItems,
    ...skills
      .filter((skill) => !toolSkillItems.some((command) => command.name === skill.name))
      .map((skill) => ({
        id: `skill:${skill.name}`,
        name: skill.name,
        description: skill.description,
        source: "skill" as const,
      })),
  ];
  const filteredSkillItems = filterToolMenuItems(
    combinedSkillItems,
    skillSearchQuery,
    (item) => `${item.name} ${item.description ?? ""}`,
  );
  const filteredPluginSkillFiles = filterToolMenuItems(
    pluginSkillFiles,
    skillSearchQuery,
    pluginSkillFileSearchText,
  );
  const filteredMcpItems = filterToolMenuItems(
    activeMcpItems,
    connectorSearchQuery,
    ({ entry }) => `${entry.name} ${mcpServerDescription(entry)}`,
  );
  const filteredComposerExtensions = filterToolMenuItems(
    composerExtensions,
    connectorSearchQuery,
    (entry) => `${entry.name} ${entry.description}`,
  );
  const hasSkills = combinedSkillItems.length > 0 || pluginSkillFiles.length > 0;
  const hasSkillMatches = filteredSkillItems.length > 0 || filteredPluginSkillFiles.length > 0;
  const hasConnectors = activeMcpItems.length > 0 || composerExtensions.length > 0;
  const hasConnectorMatches = filteredMcpItems.length > 0 || filteredComposerExtensions.length > 0;

  const panelRoundedClass =
    mentionOpen || slashOpen
      ? "rounded-t-[18px] border-t-transparent"
      : "";

  const renderSlashMenu = () => {
    if (!slashOpen) return null;
    return (
      <div className={composerMenuClass.anchor}>
          <div className={composerMenuClass.panel}>
            <div
              role="presentation"
              className={composerMenuClass.scrollArea}
              onMouseDown={(event) => event.preventDefault()}
          >
            {slashFiltered.length > 0 ? (
              <div className="grid gap-1">
                {slashFiltered.map((command, index) => (
                  <MenuRowButton
                    key={command.id}
                    ref={(element) => {
                      menuItemRefs.current[index] = element;
                    }}
                    type="button"
                    active={activeMenu === "slash" && slashFiltered[menuIndex]?.id === command.id}
                    onMouseEnter={() => setMenuIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      applyCommandSelection(command);
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) applyCommandSelection(command);
                    }}
                  >
                    <Terminal size={14} className={composerMenuClass.itemIcon} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className={composerMenuClass.itemTitle}>/{command.name}</div>
                        {command.source && command.source !== "command" ? (
                          <StatusBadge className={command.source === "skill" ? composerTextClass.sourceBadge : composerTextClass.commandBadge} size="tiny">
                            {command.source === "skill" ? t("composer.skill_source") : t("composer.mcps_label")}
                          </StatusBadge>
                        ) : null}
                      </div>
                      {command.description ? <div className={composerMenuClass.itemMeta}>{command.description}</div> : null}
                    </div>
                  </MenuRowButton>
                ))}
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-dls-secondary">
                {!commandsLoaded && commandsLoading ? t("composer.loading_commands") : t("composer.no_commands")}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMentionMenu = () => {
    if (!mentionOpen || mentionFiltered.length === 0) return null;
    return (
      <div className={composerMenuClass.anchor}>
          <div className={composerMenuClass.panelWithoutBottomBorder}>
            <div
              role="presentation"
              className={composerMenuClass.scrollArea}
              onMouseDown={(event) => event.preventDefault()}
          >
            <div className="grid gap-1">
              {mentionFiltered.map((item, index) => (
                <MenuRowButton
                  key={item.id}
                  ref={(element) => {
                    menuItemRefs.current[index] = element;
                  }}
                  type="button"
                  active={activeMenu === "mention" && mentionFiltered[menuIndex]?.id === item.id}
                  onMouseEnter={() => setMenuIndex(index)}
                  onClick={() => {
                    props.onInsertMention(item.kind, item.value);
                    setMentionOpen(false);
                  }}
                >
                  {item.kind === "agent" ? (
                    <Zap size={14} className={composerMenuClass.itemIcon} />
                  ) : (
                    <FileText size={14} className={composerMenuClass.itemIcon} />
                  )}
                  <div className="min-w-0">
                    <div className={composerMenuClass.itemTitle}>@{item.label}</div>
                    <div className={composerMenuClass.itemMeta}>
                      {item.kind === "agent"
                        ? t("composer.agent_label")
                        : t("composer.file_kind")}
                    </div>
                  </div>
                </MenuRowButton>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={`sticky bottom-0 mac:titlebar-no-drag ${toolMenuOpen ? "z-50" : "z-20"} bg-gradient-to-t from-dls-background via-dls-background/95 to-transparent px-4 md:px-8 pb-5 ${props.compactTopSpacing ? "pt-0" : "pt-3"}`}
      style={COMPOSER_CONTAIN_STYLE}
      onKeyDownCapture={handleKeyDownCapture}
      onCompositionStart={() => {
        imeComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        imeComposingRef.current = false;
      }}
    >
      <div className="mx-auto w-full max-w-[1120px]">
        {/* Main composer panel — input + primary toolbar only (WorkBuddy layout). */}
        <div
          className={`relative overflow-visible rounded-xl bg-dls-surface ${props.showOuterBorder ? "border border-dls-mist" : ""} ${panelRoundedClass}`}
        >
          {props.topAccessory ? <div className="relative z-10">{props.topAccessory}</div> : null}
          <ReactComposerNotice notice={props.notice} />

          {renderMentionMenu()}
          {renderSlashMenu()}

          {props.attachments.length > 0 ? (
            // Align with editor padding (px-4); keep chips compact so they don't fight the shell.
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {props.attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group/att flex max-w-full items-center gap-2 rounded-lg bg-dls-surface-muted px-2 py-1.5 text-xs"
                >
                  {isImageAttachment(attachment) && attachment.previewUrl ? (
                    <div className="size-8 shrink-0 overflow-hidden rounded-md bg-dls-surface">
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.name}
                        decoding="async"
                        className="size-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface text-dls-secondary">
                      <FileText className="size-3.5" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 max-w-[14rem]">
                    <div className="truncate text-xs font-medium text-dls-text" title={attachment.name}>
                      {attachment.name}
                    </div>
                    <div className="truncate text-2xs text-dls-secondary">
                      {isImageAttachment(attachment) ? t("composer.image_kind") : t("composer.file_kind")}
                      {" · "}
                      {formatBytes(attachment.size)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="ml-0.5 size-5 shrink-0 rounded-full text-dls-secondary opacity-70 hover:bg-dls-hover hover:text-dls-text hover:opacity-100 group-hover/att:opacity-100"
                    onClick={() => props.onRemoveAttachment(attachment.id)}
                    title={t("action.remove")}
                    aria-label={t("action.remove")}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

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

          <div
            className={
              props.attachments.length > 0 ? "px-4 pb-2 pt-2" : "px-4 pb-2 pt-3"
            }
          >
            {/* Editor */}
            <LexicalPromptEditor
              value={props.draft}
              mentions={props.mentions}
              scenarioTags={props.scenarioTags}
              disabled={props.disabled}
              placeholder={props.placeholder ?? t("composer.placeholder")}
              onChange={props.onDraftChange}
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

            {/* Action row — attach/inbox/tools on the left, send on the right */}
            <div className="mt-2 flex items-end justify-between gap-1.5">
              <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-visible">
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
                      setMentionItems([]);
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
                    <div className="absolute bottom-full left-0 z-40 mb-3 h-0 w-0">
                      {/* Primary list — WorkBuddy-style short labels, no truncation at rest. */}
                      <div
                        className="absolute bottom-0 left-0 w-44 rounded-xl border border-dls-border bg-dls-surface-solid p-1.5"
                        style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
                      >
                        <div className="grid gap-0.5">
                          <MenuRowButton
                            type="button"
                            align="center"
                            density="compact"
                            active={toolMenuSection === "files"}
                            className="justify-between gap-2"
                            disabled={!props.attachmentsEnabled}
                            onMouseEnter={() => setToolMenuSection("files")}
                            onFocus={() => setToolMenuSection("files")}
                            onClick={openFilePicker}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Paperclip className="size-3.5 shrink-0 text-dls-secondary" />
                              <span className="truncate text-sm">{t("composer.add_file")}</span>
                            </span>
                          </MenuRowButton>
                          {canCaptureAppshot ? (
                            <MenuRowButton
                              type="button"
                              align="center"
                              density="compact"
                              className="gap-2"
                              disabled={!props.attachmentsEnabled}
                              onClick={() => void captureAppshot()}
                            >
                              <Camera className="size-3.5 shrink-0 text-dls-secondary" />
                              <span className="truncate text-sm">{t("composer.capture_appshot")}</span>
                            </MenuRowButton>
                          ) : null}
                          {([
                            ["modes", t("composer.collaboration_mode"), Sparkles] as const,
                            ...(promptTemplates.length > 0
                              ? ([["templates", t("composer.prompt_templates_short"), ClipboardList]] as const)
                              : []),
                            ["skills", t("dashboard.skills"), Zap] as const,
                            ["mcps", t("composer.connectors_label"), Plug] as const,
                          ]).map(([section, label, Icon]) => (
                            <MenuRowButton
                              key={section}
                              type="button"
                              align="center"
                              density="compact"
                              active={toolMenuSection === section}
                              className="justify-between gap-2"
                              onMouseEnter={() => setToolMenuSection(section)}
                              onFocus={() => setToolMenuSection(section)}
                              onClick={() => setToolMenuSection(section)}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <Icon className="size-3.5 shrink-0 text-dls-secondary" />
                                <span className="truncate text-sm">{label}</span>
                              </span>
                              <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" />
                            </MenuRowButton>
                          ))}
                        </div>
                      </div>
                      {toolMenuSection === "files" ? null : (
                        <div
                          className="absolute bottom-0 left-[calc(11rem-1px)] flex w-[min(calc(100vw-13.5rem),20rem)] min-h-0 max-w-[20rem] flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid"
                          style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
                        >
                          {toolMenuSection === "templates" ? (
                            <div className="flex min-h-10 items-center border-b border-dls-border px-3 py-2 text-sm font-medium text-dls-text">
                              {t("composer.prompt_templates")}
                            </div>
                          ) : toolMenuSection === "skills" ? (
                            <div className="space-y-2 border-b border-dls-border px-3 py-2">
                              {/* Match connectors panel: title + quiet configure, then search */}
                              <div className="flex min-h-8 items-center justify-between gap-3">
                                <div className="text-sm font-medium text-dls-text">
                                  {t("dashboard.skills")}
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  className="shrink-0 gap-1 text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-text"
                                  onClick={() => {
                                    setToolMenuOpen(false);
                                    openToolMenuSettings();
                                  }}
                                >
                                  <Settings className="size-3.5" />
                                  {t("composer.configure")}
                                </Button>
                              </div>
                              <InputGroup controlSize="sm" radius="md" tone="surface">
                                <InputGroupAddon align="inline-start">
                                  <Search aria-hidden="true" className="size-3.5" />
                                </InputGroupAddon>
                                <InputGroupInput
                                  value={skillSearchQuery}
                                  onChange={(event) => setSkillSearchQuery(event.currentTarget.value)}
                                  placeholder={t("composer.search_skills")}
                                  aria-label={t("composer.search_skills")}
                                  className="text-sm text-dls-text placeholder:text-dls-secondary/70"
                                />
                              </InputGroup>
                            </div>
                          ) : toolMenuSection === "mcps" ? (
                            <div className="space-y-2 border-b border-dls-border px-3 py-2">
                              <div className="flex min-h-8 items-center text-sm font-medium text-dls-text">
                                {t("composer.connectors_label")}
                              </div>
                              <InputGroup controlSize="sm" radius="md" tone="surface">
                                <InputGroupAddon align="inline-start">
                                  <Search aria-hidden="true" className="size-3.5" />
                                </InputGroupAddon>
                                <InputGroupInput
                                  value={connectorSearchQuery}
                                  onChange={(event) => setConnectorSearchQuery(event.currentTarget.value)}
                                  placeholder={t("composer.search_connectors")}
                                  aria-label={t("composer.search_connectors")}
                                  className="text-sm text-dls-text placeholder:text-dls-secondary/70"
                                />
                              </InputGroup>
                            </div>
                          ) : toolMenuSection === "modes" && collaborationVariant !== "office" ? (
                            <div className="flex min-h-10 items-center border-b border-dls-border px-3 py-2 text-sm font-medium text-dls-text">
                              {t("composer.collaboration_choose_mode")}
                            </div>
                          ) : null}
                          <div className="max-h-72 overflow-x-hidden overflow-y-auto p-2">
                            {toolMenuSection === "templates" ? (
                              <div className="grid gap-0.5">
                                {promptTemplates.map((template) => {
                                  const Icon = template.icon;
                                  return (
                                    <MenuRowButton
                                      key={template.id}
                                      type="button"
                                      align="center"
                                      density="compact"
                                      active={selectedPromptTemplate?.id === template.id}
                                      className="justify-between gap-2"
                                      onMouseEnter={() => setSelectedPromptTemplateId(template.id)}
                                      onFocus={() => setSelectedPromptTemplateId(template.id)}
                                      onClick={() => setSelectedPromptTemplateId(template.id)}
                                    >
                                      <span className="flex min-w-0 items-center gap-2">
                                        <Icon className="size-3.5 shrink-0 text-dls-secondary" />
                                        <span className="truncate text-sm text-dls-text">
                                          {template.label}
                                        </span>
                                      </span>
                                      <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" />
                                    </MenuRowButton>
                                  );
                                })}
                              </div>
                            ) : null}
                            {toolMenuSection === "modes" ? (
                              collaborationVariant === "office" ? (
                                <div className="space-y-3 px-1 py-1">
                                  <p className="text-sm leading-5 text-dls-secondary">
                                    {(
                                      modeOptions.find((option) => option.key === (selectedModeKey ?? "craft")) ??
                                      modeOptions[0]
                                    )?.description}
                                  </p>
                                  <div className="h-px bg-dls-border" />
                                  <div className="grid gap-3">
                                    {(
                                      [
                                        {
                                          key: "plan" as const,
                                          label: t("composer.collaboration_plan_toggle"),
                                        },
                                        {
                                          key: "ask" as const,
                                          label: t("composer.collaboration_ask_toggle"),
                                        },
                                      ] as const
                                    ).map((item) => {
                                      const checked = selectedModeKey === item.key;
                                      return (
                                        <div
                                          key={item.key}
                                          className="flex items-center justify-between gap-3"
                                        >
                                          <span className="text-sm text-dls-text">{item.label}</span>
                                          <Switch
                                            size="sm"
                                            checked={checked}
                                            onCheckedChange={(next) => {
                                              if (next) {
                                                applyCollaborationModeSelection(
                                                  modeOptions.find((option) => option.key === item.key)!,
                                                  { keepMenuOpen: true },
                                                );
                                                return;
                                              }
                                              applyCollaborationModeSelection(
                                                modeOptions.find((option) => option.key === "craft")!,
                                                { keepMenuOpen: true },
                                              );
                                            }}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div className="grid gap-0.5">
                                  {modeOptions.map((option) => {
                                    const checked = selectedModeKey === option.key;
                                    const Icon = option.Icon;
                                    return (
                                      <MenuRowButton
                                        key={option.key}
                                        type="button"
                                        align="center"
                                        density="compact"
                                        active={checked}
                                        className="gap-3"
                                        onClick={() => applyCollaborationModeSelection(option)}
                                        role="menuitemradio"
                                        aria-checked={checked}
                                      >
                                        <Icon className="size-3.5 shrink-0 text-dls-secondary" />
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-sm font-medium text-dls-text">
                                            {option.label}
                                          </div>
                                          <div className="truncate text-xs text-dls-secondary">
                                            {option.description}
                                          </div>
                                        </div>
                                        {checked ? (
                                          <Check className="size-3.5 shrink-0 text-dls-text" />
                                        ) : null}
                                      </MenuRowButton>
                                    );
                                  })}
                                </div>
                              )
                            ) : null}
                            {toolMenuSection === "skills" ? (
                              hasSkillMatches ? (
                                <div className="grid min-w-0 gap-0.5">
                                  {filteredSkillItems.map((command) => {
                                    const description = skillMenuDescription(command.description);
                                    return (
                                      <MenuRowButton
                                        key={command.id}
                                        type="button"
                                        align="center"
                                        className="w-full min-w-0 max-w-full gap-3 overflow-hidden"
                                        onClick={() => applyCommandSelection(command)}
                                      >
                                        {/* Same icon tile language as connector extension rows */}
                                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dls-border bg-dls-surface">
                                          <Zap className="size-3.5 text-dls-secondary" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0 flex-1 overflow-hidden">
                                          <div className="truncate text-sm font-medium text-dls-text">
                                            {command.name}
                                          </div>
                                          {description ? (
                                            <div className="truncate text-xs text-dls-secondary">
                                              {description}
                                            </div>
                                          ) : null}
                                        </div>
                                      </MenuRowButton>
                                    );
                                  })}
                                  {filteredPluginSkillFiles.map((file) => (
                                    <MenuRowButton
                                      key={`${file.configObjectId}:${file.path}`}
                                      type="button"
                                      align="center"
                                      className="w-full min-w-0 max-w-full gap-3 overflow-hidden"
                                      onClick={() => applyPluginFileSelection(file)}
                                    >
                                      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dls-border bg-dls-surface">
                                        <FileText className="size-3.5 text-dls-secondary" aria-hidden="true" />
                                      </div>
                                      <div className="min-w-0 flex-1 overflow-hidden">
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                          <div className="min-w-0 truncate text-sm font-medium text-dls-text">
                                            {file.title}
                                          </div>
                                          <StatusBadge size="tiny" tone="neutral" shape="soft" className="shrink-0">
                                            {formatPluginObjectType(file.objectType)}
                                          </StatusBadge>
                                        </div>
                                      </div>
                                    </MenuRowButton>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-3 py-2 text-xs text-dls-secondary">
                                  {(!skillsLoaded && skillsLoading) || (!commandsLoaded && commandsLoading)
                                    ? t("composer.loading_commands")
                                    : hasSkills
                                      ? t("composer.no_matching_skills")
                                      : t("context_panel.no_skills")}
                                </div>
                              )
                            ) : null}
                            {toolMenuSection === "mcps" ? (
                              hasConnectorMatches ? (
                                <div className="grid gap-1">
                                  {filteredMcpItems.map(({ entry, status }) => (
                                    <MenuRowSurface key={entry.name}>
                                      <Plug size={14} className="mt-0.5 shrink-0 text-dls-secondary" />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="truncate text-xs font-medium text-dls-secondary">{entry.name}</div>
                                          <StatusBadge size="tiny" tone={mcpStatusBadgeTone(status)}>
                                            {formatMcpStatusLabel(status)}
                                          </StatusBadge>
                                        </div>
                                        <div className="truncate text-xs text-dls-secondary">{mcpServerDescription(entry)}</div>
                                      </div>
                                    </MenuRowSurface>
                                  ))}
                                  {filteredComposerExtensions.map((entry) => (
                                    <MenuRowButton
                                      key={entry.id ?? entry.serverName ?? entry.name}
                                      type="button"
                                      active={selectedComposerExtension === entry}
                                      onMouseEnter={() => setSelectedComposerExtension(
                                        entry.suggestedPrompts?.length ? entry : null,
                                      )}
                                      onFocus={() => setSelectedComposerExtension(
                                        entry.suggestedPrompts?.length ? entry : null,
                                      )}
                                      onClick={() => {
                                        if (entry.suggestedPrompts?.length) {
                                          setSelectedComposerExtension(entry);
                                          return;
                                        }
                                        applyExtensionSelection(entry);
                                      }}
                                    >
                                      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-dls-border bg-dls-surface">
                                        {extensionIcon(entry, 16)}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="truncate text-xs font-medium text-dls-secondary">{entry.name}</div>
                                          {entry.defaultEnabled ? (
                                            <StatusBadge size="tiny" tone="accent">{t("plugins.enabled")}</StatusBadge>
                                          ) : null}
                                        </div>
                                        <div className="truncate text-xs text-dls-secondary">{entry.description}</div>
                                      </div>
                                      {entry.suggestedPrompts?.length ? (
                                        <ChevronRight size={14} className="shrink-0 text-dls-secondary" />
                                      ) : null}
                                    </MenuRowButton>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-3 py-2 text-xs text-dls-secondary">
                                  {!mcpLoaded && mcpLoading
                                    ? t("composer.loading_commands")
                                    : hasConnectors
                                      ? t("composer.no_matching_connectors")
                                      : (mcpStatus ?? t("context_panel.no_mcp"))}
                                </div>
                              )
                            ) : null}
                          </div>
                        </div>
                      )}
                      {toolMenuSection === "templates" && selectedPromptTemplate ? (
                        <div
                          className="absolute bottom-0 left-[calc(11rem+20rem-2px)] flex w-[min(calc(100vw-33.5rem),18rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid"
                          style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
                        >
                          <div className="flex min-h-10 items-center border-b border-dls-border px-3 py-2 text-sm font-medium text-dls-text">
                            <span className="truncate">{selectedPromptTemplate.label}</span>
                          </div>
                          <div className="max-h-72 overflow-x-hidden overflow-y-auto p-2">
                            <div className="grid gap-0.5">
                              {selectedPromptTemplate.prompts.map((prompt) => (
                                <MenuRowButton
                                  key={prompt}
                                  type="button"
                                  align="start"
                                  density="compact"
                                  className="gap-2"
                                  onClick={() => applyPromptTemplate(selectedPromptTemplate.id, prompt)}
                                >
                                  <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-dls-secondary" />
                                  <span className="line-clamp-2 text-sm text-dls-text">{prompt}</span>
                                </MenuRowButton>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {toolMenuSection === "mcps" && selectedComposerExtension?.suggestedPrompts?.length ? (
                        <div className="absolute bottom-0 left-[calc(11rem+20rem-2px)] flex w-[min(calc(100vw-33.5rem),18rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
                          <div className="flex min-h-10 items-center border-b border-dls-border px-3 py-2 text-sm font-medium text-dls-text">
                            <span className="truncate">{selectedComposerExtension.name}</span>
                          </div>
                          <div className="max-h-72 overflow-y-auto p-2">
                            <div className="grid gap-0.5">
                              {selectedComposerExtension.suggestedPrompts.map((prompt) => (
                                <MenuRowButton
                                  key={prompt}
                                  type="button"
                                  align="start"
                                  density="compact"
                                  className="gap-2"
                                  onClick={() => applyExtensionSuggestion(selectedComposerExtension, prompt)}
                                >
                                  <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-dls-secondary" />
                                  <span className="line-clamp-2 text-sm text-dls-text">{prompt}</span>
                                </MenuRowButton>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {shouldShowCollaborationChip && selectedModeOption ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="group max-w-40 shrink-0 bg-dls-hover px-2 text-dls-text hover:bg-dls-active"
                    onClick={clearCollaborationModeSelection}
                    title={t("composer.remove_collaboration_mode", { mode: selectedModeOption.label })}
                    aria-label={t("composer.remove_collaboration_mode", { mode: selectedModeOption.label })}
                  >
                    <SelectedModeIcon size={14} className="shrink-0 group-hover:hidden" />
                    <X size={14} className="hidden shrink-0 group-hover:block" />
                    <span className="min-w-0 truncate">{selectedModeOption.label}</span>
                  </Button>
                ) : null}
                {props.hideAccessPermissionSelect ? null : (
                  <AccessPermissionSelect
                    value={props.accessMode}
                    onChange={props.onAccessModeChange}
                  />
                )}
                {props.modelUnavailable ? null : (
                  <ModelBehaviorSelect
                    value={props.modelVariant}
                    label={props.modelVariantLabel}
                    options={props.modelBehaviorOptions}
                    onChange={props.onModelVariantChange}
                    disabled={props.busy}
                  />
                )}
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                {props.modelUnavailable ? (
                  <button
                    type="button"
                    className={composerTextClass.modelUnavailable}
                    onClick={() => props.onModelPickerOpenChange(true)}
                    title={t("settings.model_change")}
                    aria-label={t("settings.model_unavailable")}
                  >
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">
                      {t("settings.model_unavailable")}
                    </span>
                  </button>
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
        {/* Secondary chrome under the card (workspace / permission), not inside it. */}
        {props.bottomAccessory ? (
          <div className="relative z-10 mt-1.5 flex min-h-8 items-center rounded-xl bg-dls-surface-muted/40 px-2 py-0.5 text-xs font-normal leading-none text-dls-secondary">
            {props.bottomAccessory}
          </div>
        ) : null}
      </div>
    </div>
  );
}
