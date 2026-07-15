/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { Check, ChevronRight, ClipboardList, FileText, MessageCircle, Paperclip, Plus, Plug, Rocket, Search, Settings, Sparkles, Square, Target, Terminal, X, Zap } from "lucide-react";
import fuzzysort from "fuzzysort";
import { ONMYAGENT_EXTENSION_CATALOG, type McpDirectoryInfo } from "../../../../../app/constants";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { MenuRowButton, MenuRowSurface } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { SendButton } from "@/components/ui/send-button";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
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
  type CollaborationModeOptionKey,
} from "./tool-menu-model";
import {
  ReactComposerNotice,
  type ReactComposerNotice as ReactComposerNoticeData,
} from "./notice";

type MentionItem = {
  id: string;
  kind: "agent" | "file";
  value: string;
  label: string;
};

type PastedTextChip = {
  id: string;
  label: string;
  text: string;
  lines: number;
};

type ToolMenuSettingsSection = "commands" | "skills" | "mcps" | "plugins";
type ToolMenuSection = "files" | "templates" | "modes" | "skills" | "mcps";
type ComposerPromptTemplate = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  prompts: string[];
};
type CollaborationModeOption = {
  key: CollaborationModeOptionKey;
  label: string;
  description: string;
  Icon: typeof Rocket;
};
const composerTextClass = {
  sourceBadge: "bg-dls-accent/10 text-dls-accent",
  commandBadge: "bg-dls-signal/15 text-dls-text",
  modelUnavailable: "text-xs font-medium text-dls-status-danger",
};

const composerMenuClass = {
  anchor: "absolute bottom-full left-[-1px] right-[-1px] z-30",
  panel: "overflow-hidden rounded-t-[20px] border border-dls-border bg-dls-surface",
  panelWithoutBottomBorder: "overflow-hidden rounded-t-[20px] border border-dls-border border-b-0 bg-dls-surface",
  scrollArea: "max-h-64 overflow-y-auto p-2",
  itemIcon: "mt-0.5 shrink-0 text-dls-secondary",
  itemTitle: "truncate text-xs font-medium",
  itemMeta: "truncate text-xs text-dls-secondary",
  toolButton: "text-dls-secondary hover:bg-dls-hover",
  activeToolButton: "bg-dls-hover text-dls-text",
};

const EMPTY_COLLABORATION_MODE: ComposerCollaborationMode = {
  planning: false,
  pursueGoal: false,
};

const DEFAULT_OFFICE_COLLABORATION_MODE: ComposerCollaborationMode = {
  kind: "craft",
  planning: false,
  pursueGoal: false,
};

function collaborationModeValue(
  key: CollaborationModeOption["key"],
): ComposerCollaborationMode {
  if (key === "planning" || key === "pursueGoal") {
    return {
      planning: key === "planning",
      pursueGoal: key === "pursueGoal",
    };
  }
  return {
    kind: key,
    planning: key === "plan",
    pursueGoal: key === "craft",
  };
}

function selectedCollaborationModeKey(
  value: ComposerCollaborationMode,
  variant: "office" | "legacy",
): CollaborationModeOption["key"] | null {
  if (variant === "office") {
    if (value.pursueGoal && !value.planning && value.kind !== "craft") {
      return "pursueGoal";
    }
    if (value.kind === "craft" || value.kind === "ask" || value.kind === "plan") return value.kind;
    if (value.planning) return "plan";
    return null;
  }
  if (value.planning) return "planning";
  if (value.pursueGoal) return "pursueGoal";
  return null;
}

function collaborationModeOptions(variant: "office" | "legacy"): CollaborationModeOption[] {
  const options: Record<CollaborationModeOptionKey, CollaborationModeOption> = {
    craft: {
      key: "craft",
      get label() { return t("composer.collaboration_craft"); },
      get description() { return t("composer.collaboration_craft_desc"); },
      Icon: Rocket,
    },
    ask: {
      key: "ask",
      get label() { return t("composer.collaboration_ask"); },
      get description() { return t("composer.collaboration_ask_desc"); },
      Icon: MessageCircle,
    },
    plan: {
      key: "plan",
      get label() { return t("composer.collaboration_plan"); },
      get description() { return t("composer.collaboration_plan_desc"); },
      Icon: ClipboardList,
    },
    planning: {
      key: "planning",
      get label() { return t("composer.collaboration_planning"); },
      get description() { return t("composer.collaboration_planning_desc"); },
      Icon: ClipboardList,
    },
    pursueGoal: {
      key: "pursueGoal",
      get label() { return t("composer.collaboration_pursue_goal"); },
      get description() { return t("composer.collaboration_pursue_goal_desc"); },
      Icon: Target,
    },
  };
  return collaborationModeOptionKeys(variant).map((key) => options[key]);
}

function isComposerExtensionAvailable(entry: McpDirectoryInfo) {
  const hasSessionSurface = entry.extensionManifest?.contributions?.some((contribution) =>
    contribution.type === "session-side-panel" || contribution.type === "session-rail-item"
  ) === true;
  if (hasSessionSurface) return isOnMyAgentExtensionEnabled(entry);
  return !entry.defaultEnabled || isOnMyAgentExtensionEnabled(entry);
}

type ComposerProps = {
  draft: string;
  mentions: Record<string, "agent" | "file">;
  scenarioTags?: Array<{ id: string; label: string }>;
  promptTemplates?: ComposerPromptTemplate[];
  onSelectPromptTemplate?: (templateId: string, prompt: string) => void;
  placeholder?: string;
  onDraftChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  busy: boolean;
  disabled: boolean;
  modelUnavailable?: boolean;
  accessMode: ComposerAccessMode;
  onAccessModeChange: (value: ComposerAccessMode) => void;
  collaborationMode: ComposerCollaborationMode;
  onCollaborationModeChange: (value: ComposerCollaborationMode) => void;
  collaborationModeVariant?: "office" | "legacy";
  modelPickerOpen: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  attachments: ComposerAttachment[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  agentLabel: string;
  selectedAgent: string | null;
  listAgents: () => Promise<Agent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<SlashCommandOption[]>;
  listSkills?: () => Promise<SkillCard[]>;
  skills?: SkillCard[];
  listMcp?: () => Promise<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null }>;
  mcpServers?: McpServerEntry[];
  mcpStatus?: string | null;
  mcpStatuses?: McpStatusMap;
  listImportedPlugins?: () => Promise<CloudImportedPlugin[]>;
  importedPlugins?: CloudImportedPlugin[];
  onOpenSettingsSection?: (section: ToolMenuSettingsSection) => void;
  onOpenSkillsMarketplace?: () => void;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  onInsertMention: (kind: "agent" | "file", value: string) => void;
  notice: ReactComposerNoticeData | null;
  onNotice: (notice: ReactComposerNoticeData) => void;
  onPasteText: (text: string) => void;
  onUnsupportedFileLinks: (links: string[]) => void;
  pastedText: PastedTextChip[];
  onExpandPastedText: (id: string) => void;
  onRevealPastedText: (id: string) => void;
  onRemovePastedText: (id: string) => void;
  isRemoteWorkspace: boolean;
  isSandboxWorkspace: boolean;
  onUploadInboxFiles?: ((files: File[]) => void | Promise<unknown>) | null;
  draftScopeKey?: string;
  compactTopSpacing?: boolean;
  showOuterBorder?: boolean;
  topAccessory?: ReactNode;
  bottomAccessory?: ReactNode;
  hideAccessPermissionSelect?: boolean;
};

const FLUSH_PROMPT_EVENT = "onmyagent:flushPromptDraft";
const FOCUS_PROMPT_EVENT = "onmyagent:focusPrompt";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const IMAGE_COMPRESS_MAX_PX = 2048;
const IMAGE_COMPRESS_QUALITY = 0.82;
const IMAGE_COMPRESS_TARGET_BYTES = 1_500_000;
const FILE_URL_RE = /^file:\/\//i;
const HTTP_URL_RE = /^https?:\/\//i;

/**
 * Extract external file/URL drops from a clipboard. Only used when the user
 * drag-drops a file reference from another app (Finder / browser), which sets
 * the text/uri-list MIME type explicitly. Plain text pastes — even ones that
 * contain absolute paths like "/Users/..." — are NEVER treated as links here
 * because that intercepted real text pastes and made composer paste feel
 * broken. Plain text goes straight into the editor via Lexical's default.
 */
function parseClipboardUriList(clipboard: DataTransfer) {
  const raw = clipboard.getData("text/uri-list") ?? "";
  if (!raw.trim()) return [];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!FILE_URL_RE.test(trimmed) && !HTTP_URL_RE.test(trimmed)) continue;
    const normalized = encodeURI(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(attachment: ComposerAttachment) {
  return attachment.kind === "image" || attachment.mimeType.startsWith("image/");
}

async function compressImageFile(file: File): Promise<File> {
  if (file.type === "image/gif" || file.size <= IMAGE_COMPRESS_TARGET_BYTES) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const maxDim = Math.max(width, height);
  const scale = maxDim > IMAGE_COMPRESS_MAX_PX ? IMAGE_COMPRESS_MAX_PX / maxDim : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  let blob: Blob | null = null;

  if (typeof OffscreenCanvas !== "undefined") {
    const offscreen = new OffscreenCanvas(targetW, targetH);
    const ctx = offscreen.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await offscreen.convertToBlob({
        type: "image/jpeg",
        quality: IMAGE_COMPRESS_QUALITY,
      });
    }
  }

  if (!blob) {
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", IMAGE_COMPRESS_QUALITY),
      );
    }
  }

  bitmap.close();

  if (!blob || blob.size >= file.size) {
    return file;
  }

  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
}

function formatMcpStatusLabel(status: McpServerStatus | undefined) {
  switch (status) {
    case "connected":
      return t("mcp.friendly_status_ready");
    case "needs_auth":
    case "needs_client_registration":
      return t("mcp.friendly_status_needs_signin");
    case "disabled":
      return t("mcp.friendly_status_paused");
    case "disconnected":
      return t("mcp.friendly_status_offline");
    case "failed":
    default:
      return t("mcp.friendly_status_issue");
  }
}

type McpServerStatus = "connected" | "needs_auth" | "needs_client_registration" | "failed" | "disabled" | "disconnected";

function toReactMcpStatus(name: string, entry: McpServerEntry, statuses: McpStatusMap): McpServerStatus {
  const configured = statuses[name];
  if (configured?.status === "connected") return "connected";
  if (configured?.status === "needs_auth") return "needs_auth";
  if (configured?.status === "needs_client_registration") return "needs_client_registration";
  if (configured?.status === "failed") return "failed";
  if (configured?.status === "disabled" || entry.config.enabled === false || entry.config.enabled === undefined && entry.config.type === "local" && entry.config.command?.length === 0) {
    return entry.config.enabled === false ? "disabled" : configured?.status === "disabled" ? "disabled" : "disconnected";
  }
  return "disconnected";
}

function mcpStatusBadgeTone(status: McpServerStatus): StatusBadgeTone {
  switch (status) {
    case "connected":
      return "accent";
    case "needs_auth":
    case "needs_client_registration":
      return "warning";
    case "disabled":
    case "disconnected":
      return "neutral";
    default:
      return "danger";
  }
}

function mcpServerDescription(entry: McpServerEntry) {
  return entry.config.type === "remote"
    ? entry.config.url ?? entry.config.command?.join(" ") ?? "Remote MCP"
    : entry.config.command?.join(" ") ?? "Local MCP";
}

const COMPOSER_CONTAIN_STYLE = { contain: "layout style" };

function extensionIcon(entry: McpDirectoryInfo, size = 16) {
  if (entry.iconSrc) {
    return <img src={resolvePublicAssetUrl(entry.iconSrc)} alt="" width={size} height={size} loading="lazy" className="block" />;
  }
  if (entry.iconSlug) {
    return <img src={`https://cdn.simpleicons.org/${entry.iconSlug}`} alt="" width={size} height={size} loading="lazy" className="block" />;
  }
  return <Plug size={size} className="text-dls-secondary" />;
}

function pluginSlashCommandName(file: CloudImportedPluginFile) {
  const path = file.path.trim();
  if (file.objectType === "command") {
    const command = path.match(/^\.opencode\/(?:command|commands)\/(.+)\.md$/i)?.[1];
    return command?.trim() || null;
  }
  if (file.objectType === "skill") {
    const skill = path.match(/^\.opencode\/(?:skill|skills)\/(?:[^/]+\/)?([^/]+)\/SKILL\.md$/i)?.[1];
    return skill?.trim() || null;
  }
  return null;
}

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

  const applyCollaborationModeSelection = (option: CollaborationModeOption) => {
    props.onCollaborationModeChange(collaborationModeValue(option.key));
    setShowDefaultCollaborationChip(true);
    setToolMenuOpen(false);
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
        {/* Main composer panel */}
        <div
          className={`relative overflow-visible rounded-xl bg-dls-surface ${props.showOuterBorder ? "border border-dls-mist" : ""} ${panelRoundedClass}`}
        >
          {props.topAccessory ? <div className="relative z-10">{props.topAccessory}</div> : null}
          <ReactComposerNotice notice={props.notice} />

          {renderMentionMenu()}
          {renderSlashMenu()}

          {props.attachments.length > 0 ? (
            <div className="mx-5 mt-5 flex flex-wrap gap-2 md:mx-6">
              {props.attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center gap-2 rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2 text-xs text-dls-secondary">
                  {isImageAttachment(attachment) && attachment.previewUrl ? (
                    <div className="h-10 w-10 overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
                      <img src={attachment.previewUrl} alt={attachment.name} decoding="async" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <FileText size={14} className="text-dls-secondary" />
                  )}
                  <div className="max-w-[160px] min-w-0">
                    <div className="truncate text-xs font-medium text-dls-secondary">{attachment.name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-dls-secondary">
                      <span>{isImageAttachment(attachment) ? t("composer.image_kind") : t("composer.file_kind")}</span>
                      <span>·</span>
                      <span>{formatBytes(attachment.size)}</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="ml-1 size-5 rounded-full text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                    onClick={() => props.onRemoveAttachment(attachment.id)}
                    title={t("action.remove")}
                  >
                    <X size={12} />
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

          <div className="px-4 pt-3 pb-2">
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
                      <div className="absolute bottom-0 left-0 w-36 rounded-xl border border-dls-border bg-dls-surface p-2">
                        <MenuRowButton
                          type="button"
                          align="center"
                          active={toolMenuSection === "files"}
                          className="mb-1 justify-between gap-2"
                          disabled={!props.attachmentsEnabled}
                          onMouseEnter={() => setToolMenuSection("files")}
                          onFocus={() => setToolMenuSection("files")}
                          onClick={openFilePicker}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Paperclip size={14} className="shrink-0 text-dls-secondary" />
                            <span className="truncate">{t("composer.add_file")}</span>
                          </span>
                        </MenuRowButton>
                        {promptTemplates.length > 0 ? (
                          <MenuRowButton
                            type="button"
                            align="center"
                            active={toolMenuSection === "templates"}
                            className="mb-1 justify-between gap-2"
                            onMouseEnter={() => setToolMenuSection("templates")}
                            onFocus={() => setToolMenuSection("templates")}
                            onClick={() => setToolMenuSection("templates")}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Sparkles size={14} className="shrink-0 text-dls-secondary" />
                              <span className="truncate">{t("composer.prompt_templates")}</span>
                            </span>
                            <ChevronRight size={14} className="shrink-0 text-dls-secondary" />
                          </MenuRowButton>
                        ) : null}
                        {([
                          ["modes", t("composer.collaboration_mode"), MessageCircle],
                          ["skills", t("dashboard.skills"), Zap],
                          ["mcps", t("composer.connectors_label"), Plug],
                        ] as const).map(([section, label, Icon]) => (
                          <MenuRowButton
                            key={section}
                            type="button"
                            align="center"
                            active={toolMenuSection === section}
                            className="mb-1 justify-between gap-2"
                            onMouseEnter={() => setToolMenuSection(section)}
                            onFocus={() => setToolMenuSection(section)}
                            onClick={() => setToolMenuSection(section)}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon size={14} className="shrink-0 text-dls-secondary" />
                              <span className="truncate">{label}</span>
                            </span>
                            <ChevronRight size={14} className="shrink-0 text-dls-secondary" />
                          </MenuRowButton>
                        ))}
                      </div>
                      {toolMenuSection === "files" ? null : (
                        <div className="absolute bottom-0 left-[calc(9rem-1px)] flex w-[min(calc(100vw-11.5rem),27rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
                          {toolMenuSection === "templates" ? (
                            <div className="flex min-h-12 items-center border-b border-dls-border px-3 py-2 text-xs font-medium text-dls-text">
                              {t("composer.prompt_templates")}
                            </div>
                          ) : toolMenuSection === "skills" ? (
                            <div className="space-y-2 border-b border-dls-border px-3 py-2">
                              <div className="flex min-h-8 items-center justify-between gap-3">
                                <div className="text-xs font-medium text-dls-text">{t("dashboard.skills")}</div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  className="shrink-0 text-dls-secondary hover:bg-dls-surface-muted"
                                  onClick={() => {
                                    setToolMenuOpen(false);
                                    openToolMenuSettings();
                                  }}
                                >
                                  <Settings size={12} />
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
                              <div className="flex min-h-8 items-center text-xs font-medium text-dls-text">
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
                          ) : (
                            <div className="flex min-h-12 items-center border-b border-dls-border px-3 py-2 text-xs font-medium text-dls-text">
                              {toolMenuSection === "modes" ? t("composer.collaboration_choose_mode") : null}
                            </div>
                          )}
                          <div className="max-h-72 overflow-y-auto p-2">
                            {toolMenuSection === "templates" ? (
                              <div className="grid gap-1">
                                {promptTemplates.map((template) => {
                                  const Icon = template.icon;
                                  return (
                                    <MenuRowButton
                                      key={template.id}
                                      type="button"
                                      align="center"
                                      active={selectedPromptTemplate?.id === template.id}
                                      className="justify-between gap-2"
                                      onMouseEnter={() => setSelectedPromptTemplateId(template.id)}
                                      onFocus={() => setSelectedPromptTemplateId(template.id)}
                                      onClick={() => setSelectedPromptTemplateId(template.id)}
                                    >
                                      <span className="flex min-w-0 items-center gap-2">
                                        <Icon className="size-3.5 shrink-0 text-dls-secondary" />
                                        <span className="truncate text-xs font-medium text-dls-text">
                                          {template.label}
                                        </span>
                                      </span>
                                      <ChevronRight size={14} className="shrink-0 text-dls-secondary" />
                                    </MenuRowButton>
                                  );
                                })}
                              </div>
                            ) : null}
                            {toolMenuSection === "modes" ? (
                              <div className="grid gap-1">
                                {modeOptions.map((option) => {
                                  const checked = selectedModeKey === option.key;
                                  const Icon = option.Icon;
                                  return (
                                    <MenuRowButton
                                      key={option.key}
                                      type="button"
                                      align="center"
                                      active={checked}
                                      className="gap-3"
                                      onClick={() => applyCollaborationModeSelection(option)}
                                      role="menuitemradio"
                                      aria-checked={checked}
                                    >
                                      <Icon size={16} className="shrink-0 text-dls-secondary" />
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs font-medium text-dls-text">{option.label}</div>
                                        <div className="truncate text-xs text-dls-secondary">{option.description}</div>
                                      </div>
                                      {checked ? <Check size={14} className="shrink-0 text-dls-text" /> : null}
                                    </MenuRowButton>
                                  );
                                })}
                              </div>
                            ) : null}
                            {toolMenuSection === "skills" ? (
                              hasSkillMatches ? (
                                <div className="grid gap-1">
                                  {filteredSkillItems.map((command) => (
                                    <MenuRowButton
                                      key={command.id}
                                      type="button"
                                      onClick={() => applyCommandSelection(command)}
                                    >
                                      <Zap size={14} className="mt-0.5 shrink-0 text-dls-secondary" />
                                      <div className="min-w-0">
                                        <div className="truncate text-xs font-medium text-dls-secondary">/{command.name}</div>
                                        {command.description ? <div className="truncate text-xs text-dls-secondary">{command.description}</div> : null}
                                      </div>
                                    </MenuRowButton>
                                  ))}
                                  {filteredPluginSkillFiles.map((file) => (
                                    <MenuRowButton
                                      key={`${file.configObjectId}:${file.path}`}
                                      type="button"
                                      onClick={() => applyPluginFileSelection(file)}
                                    >
                                      <FileText size={14} className="mt-0.5 shrink-0 text-dls-secondary" />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="truncate text-xs font-medium text-dls-secondary">{file.title}</div>
                                          <StatusBadge size="tiny" tone="neutral">
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
                                      onClick={() => applyExtensionSelection(entry)}
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
                        <div className="absolute bottom-0 left-[calc(36rem-2px)] flex w-[clamp(18rem,calc(100vw-38.5rem),27rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
                          <div className="flex min-h-12 items-center border-b border-dls-border px-3 py-2 text-xs font-medium text-dls-text">
                            <span className="truncate">{selectedPromptTemplate.label}</span>
                          </div>
                          <div className="max-h-72 overflow-y-auto p-2">
                            <div className="grid gap-1">
                              {selectedPromptTemplate.prompts.map((prompt) => (
                                <MenuRowButton
                                  key={prompt}
                                  type="button"
                                  align="start"
                                  className="gap-2"
                                  onClick={() => applyPromptTemplate(selectedPromptTemplate.id, prompt)}
                                >
                                  <MessageCircle size={14} className="mt-0.5 shrink-0 text-dls-secondary" />
                                  <span className="line-clamp-2 text-xs text-dls-text">{prompt}</span>
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
                {props.modelUnavailable ? (
                  <span className={composerTextClass.modelUnavailable}>
                    {t("settings.model_unavailable")}
                  </span>
                ) : null}
                <ModelBehaviorSelect
                  value={props.modelVariant}
                  label={props.modelVariantLabel}
                  options={props.modelBehaviorOptions}
                  onChange={props.onModelVariantChange}
                  disabled={props.busy}
                />
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1">
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
                    onClick={canSend ? props.onSend : props.busy ? props.onStop : undefined}
                    disabled={props.disabled || (!canSend && !props.busy)}
                    title={t("composer.send_message")}
                    aria-label={t("composer.send_message")}
                  />
                )}
              </div>
            </div>
          </div>
          {props.bottomAccessory ? (
            <div className="relative z-10  rounded-b-xl bg-dls-background px-4 py-1.5">
              {props.bottomAccessory}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
