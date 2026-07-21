/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { AlertCircle, Camera, Check, ChevronRight, ClipboardList, FileText, MessageCircle, Paperclip, Pin, PinOff, Plus, Plug, Rocket, Search, Settings, Sparkles, Square, Target, Terminal, X } from "lucide-react";
import { SkillGlyphIcon } from "../../../../design-system/skill-glyph-icon";
import fuzzysort from "fuzzysort";
import { ONMYAGENT_EXTENSION_CATALOG, type McpDirectoryInfo } from "../../../../../app/constants";
import { desktopBridge } from "../../../../../app/lib/desktop";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { IconTile, MenuRowButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { SendButton } from "@/components/ui/send-button";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CloudImportedPlugin, CloudImportedPluginFile } from "../../../../../app/cloud/import-state";
import type { ComposerAccessMode, ComposerAttachment, ComposerCollaborationMode, McpServerEntry, McpStatusMap, ModelRef, SkillCard, SlashCommandOption } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import {
  isOnMyAgentExtensionEnabled,
  isOnMyAgentExtensionHidden,
  ONMYAGENT_EXTENSION_STATE_CHANGED,
  setOnMyAgentExtensionEnabled,
  useDesktopRestriction,
} from "../../../shared";
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
  FLUSH_PROMPT_EVENT,
  FOCUS_PROMPT_EVENT,
  MAX_ATTACHMENT_BYTES,
  parseClipboardUriList,
  formatBytes,
  isImageAttachment,
  compressImageFile,
  toReactMcpStatus,
  mcpServerDescription,
  COMPOSER_CONTAIN_STYLE,
  extensionIcon,
  extensionIconTileClassName,
  pluginSlashCommandName,
} from "./composer-helpers";
import { ComposerSlashMenu, ComposerMentionMenu } from "./slash-mention-menus";
import {
  readPinnedSkillIds,
  sortWithPinnedFirst,
  writePinnedSkillIds,
} from "./pinned-skills";

/** Client platform for Appshot naming / availability (Electron + browser). */
function detectClientPlatform(): "macos" | "windows" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";
  if (/Mac|Macintosh|Darwin/i.test(platform) || /Mac OS X|Macintosh/i.test(ua)) {
    return "macos";
  }
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return "linux";
  return "unknown";
}

/** Reject Swift debug dumps / control junk so notice + chips stay readable. */
function isSafeAttachmentDisplayName(name: string): boolean {
  const value = name.trim();
  if (!value || value.length > 96) return false;
  if (/JoinedSequence|ArraySlice|ContiguousArray|_base|_separator|Array</i.test(value)) {
    return false;
  }
  // No control chars / newlines; allow normal unicode file names.
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return !value.includes("\n") && !value.includes("\r");
}

/**
 * Cross-platform Appshot basename.
 * - macOS: strips Swift JoinedSequence dumps from the native helper
 * - Windows: strips reserved device names and illegal path characters
 * - Linux / fallback: same safe basename rules
 */
function sanitizeAppshotFileName(
  raw: string,
  platform: "macos" | "windows" | "linux" | "unknown" = detectClientPlatform(),
): string {
  const value = raw.trim().replace(/\\/g, "/");
  const base = value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
  let candidate = base
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const reservedWin =
    platform === "windows" &&
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(candidate);

  const looksBad =
    !candidate ||
    !isSafeAttachmentDisplayName(candidate) ||
    reservedWin ||
    !/^Appshot[-_\w. ()]+\.(jpe?g|png|webp)$/i.test(candidate);

  if (!looksBad) {
    return candidate.replace(/\.jpeg$/i, ".jpg");
  }

  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stampText = [
    stamp.getFullYear(),
    pad(stamp.getMonth() + 1),
    pad(stamp.getDate()),
    "-",
    pad(stamp.getHours()),
    pad(stamp.getMinutes()),
    pad(stamp.getSeconds()),
  ].join("");
  return `Appshot-${stampText}.jpg`;
}

/** Native Appshot helper is macOS-only today (Swift HandsFree). */
function isAppshotCaptureSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.__ONMYAGENT_ELECTRON__?.computerUse) return false;
  return detectClientPlatform() === "macos";
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
  const [selectedComposerExtension, setSelectedComposerExtension] = useState<McpDirectoryInfo | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [connectorSearchQuery, setConnectorSearchQuery] = useState("");
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>(() => readPinnedSkillIds());
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

  // Open slash menu whenever the caret-side draft ends with `/` or `/partial`.
  // Previous regex required the *entire* draft to be a slash token, so after a
  // skill chip (`/12306 `) a second `/` never opened the menu again.
  const slashMatch = props.draft.match(/\/([^\s/]*)$/);
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
    // Never treat an empty list as a permanent cache — first paint often races
    // the OpenCode client / skill catalog and would stick on "未找到命令".
    if (commandsCacheRef.current !== null && commandsCacheRef.current.length > 0) {
      return Promise.resolve(commandsCacheRef.current);
    }
    if (commandsRequestRef.current) {
      return commandsRequestRef.current;
    }
    const version = commandsLoadVersionRef.current;
    const request = (async (): Promise<SlashCommandOption[]> => {
      // Slash menu needs both OpenCode command.list and OnMyAgent skills.
      // Skills alone used to live only in the + tool flyout, so typing `/`
      // looked empty even when many skills were installed.
      const listSkills = listSkillsRef.current;
      const [cmdResult, skillResult] = await Promise.allSettled([
        listCommandsRef.current(),
        listSkills ? listSkills() : Promise.resolve([] as SkillCard[]),
      ]);
      const cmds =
        cmdResult.status === "fulfilled" && Array.isArray(cmdResult.value)
          ? cmdResult.value
          : [];
      const skillCards =
        skillResult.status === "fulfilled" && Array.isArray(skillResult.value)
          ? skillResult.value
          : [];

      const byName = new Map<string, SlashCommandOption>();
      for (const skill of skillCards) {
        const name = String(skill.name ?? "").trim();
        if (!name) continue;
        byName.set(name, {
          id: `skill:${name}`,
          name,
          description: skill.description ? String(skill.description) : undefined,
          source: "skill",
        });
      }
      for (const cmd of cmds) {
        const name = String(cmd.name ?? "").trim();
        if (!name) continue;
        byName.set(name, cmd);
      }
      // Preserve SkillCard.scope so OnMyAgent installs can sort ahead of the rest.
      if (skillCards.length) {
        setSkills(skillCards);
        setSkillsLoaded(true);
      }
      return Array.from(byName.values());
    })()
      .then((next) => {
        if (commandsLoadVersionRef.current === version && next.length > 0) {
          commandsCacheRef.current = next;
        }
        return next;
      })
      .finally(() => {
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
    } else {
      // WorkBuddy-style cascade: open the 3rd flyout as soon as prompts section is active.
      const templates = props.promptTemplates ?? [];
      setSelectedPromptTemplateId((current) => {
        if (current && templates.some((template) => template.id === current)) {
          return current;
        }
        return templates[0]?.id ?? null;
      });
    }
    if (!toolMenuOpen || toolMenuSection !== "mcps") {
      setSelectedComposerExtension(null);
    }
  }, [toolMenuOpen, toolMenuSection, props.promptTemplates]);

  useEffect(() => {
    // Closing the menus must clear loading; otherwise a cancelled in-flight
    // listCommands leaves commandsLoading=true and the slash panel stuck on
    // "正在加载命令…" the next time `/` is typed (or even while still open).
    if (!slashOpen && !toolMenuOpen) {
      setCommandsLoading(false);
      return;
    }
    const openId = toolMenuLoadRef.current.openId;
    if (toolMenuOpen && toolMenuLoadRef.current.commands) return;
    if (toolMenuOpen) toolMenuLoadRef.current.commands = true;
    let cancelled = false;
    const cached = commandsCacheRef.current;
    if (cached !== null && cached.length > 0) {
      setCommands(cached);
      setCommandsLoading(false);
      setCommandsLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    setCommandsLoading(true);
    // Soft deadline: stop the spinner if backends stall, but do not wipe a
    // partial catalog or cache an empty failure forever.
    const timeoutMs = 12_000;
    let timeoutId: number | undefined;
    let settled = false;
    timeoutId = window.setTimeout(() => {
      if (cancelled || settled) return;
      settled = true;
      setCommandsLoading(false);
      setCommandsLoaded(true);
    }, timeoutMs);
    void loadCommands()
      .then((next) => {
        if (cancelled) return;
        settled = true;
        setCommands(next);
        setCommandsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        settled = true;
        // Leave any previously shown list; only mark loaded so UI exits spinner.
        setCommandsLoaded(true);
      })
      .finally(() => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        if (!cancelled) setCommandsLoading(false);
      });
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [slashOpen, toolMenuOpen, loadCommands]);

  useEffect(() => {
    // @ menu is files-only (workspace / recent). Agent pick lives in its own menu, not @.
    if (!mentionOpen) return;
    let cancelled = false;
    void props
      .searchFiles(mentionQuery)
      .then((files) => {
        if (cancelled) return;
        const recent = props.recentFiles.slice(0, 8);
        const recentSet = new Set(recent);
        const next: MentionItem[] = [
          ...recent.map((file) => ({
            id: `file:${file}`,
            kind: "file" as const,
            value: file,
            label: file,
          })),
          ...files
            .filter((file) => !recentSet.has(file))
            .map((file) => ({
              id: `file:${file}`,
              kind: "file" as const,
              value: file,
              label: file,
            })),
        ];
        setMentionItems(next);
      })
      .catch(() => {
        if (!cancelled) setMentionItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, mentionQuery, props.recentFiles, props.searchFiles]);

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

  const mentionFiltered = useMemo(() => {
    if (!mentionOpen) return [];
    if (!mentionQuery) return mentionItems.slice(0, 8);
    return fuzzysort.go(mentionQuery, mentionItems, { keys: ["label"], limit: 8 }).map((entry) => entry.obj);
  }, [mentionItems, mentionOpen, mentionQuery]);
  // Shared skill catalog for `+` skills flyout and `/` slash menu so count + order match.
  // Prefer OpenCode command.list rows when both sources have the same name, but keep
  // the OnMyAgent install set so those can sort first after pins.
  const onmyagentInstalledNames = useMemo(() => {
    const names = new Set<string>();
    for (const skill of skills) {
      if (skill.scope === "onmyagent") {
        const name = String(skill.name ?? "").trim();
        if (name) names.add(name);
      }
    }
    return names;
  }, [skills]);
  const combinedSkillItems = useMemo(() => {
    const byName = new Map<string, SlashCommandOption>();
    for (const skill of skills) {
      const name = String(skill.name ?? "").trim();
      if (!name) continue;
      byName.set(name, {
        id: `skill:${name}`,
        name,
        description: skill.description,
        source: "skill",
      });
    }
    for (const command of commands) {
      if (command.source === "mcp") continue;
      const name = String(command.name ?? "").trim();
      if (!name) continue;
      // Stable pin key: skill:<name> so + menu pins still match slash rows.
      byName.set(name, {
        ...command,
        id: command.source === "skill" || !command.source ? `skill:${name}` : command.id,
        name,
      });
    }
    const alpha = (left: SlashCommandOption, right: SlashCommandOption) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    // OnMyAgent-installed first (alpha), then everything else (alpha).
    const installed: SlashCommandOption[] = [];
    const rest: SlashCommandOption[] = [];
    for (const item of byName.values()) {
      if (onmyagentInstalledNames.has(item.name)) installed.push(item);
      else rest.push(item);
    }
    installed.sort(alpha);
    rest.sort(alpha);
    return [...installed, ...rest];
  }, [commands, onmyagentInstalledNames, skills]);
  const skillCatalogOrdered = useMemo(
    () =>
      sortWithPinnedFirst(combinedSkillItems, pinnedSkillIds, (item) => {
        // Accept either skill:<name> or cmd:<name> pins from older builds.
        if (pinnedSkillIds.includes(item.id)) return item.id;
        const skillId = `skill:${item.name}`;
        if (pinnedSkillIds.includes(skillId)) return skillId;
        const cmdId = `cmd:${item.name}`;
        if (pinnedSkillIds.includes(cmdId)) return cmdId;
        return item.id;
      }),
    [combinedSkillItems, pinnedSkillIds],
  );
  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    // Slash menu is skills/commands only — connectors live under + → connectors.
    return slashQuery.trim()
      ? filterToolMenuItems(
          skillCatalogOrdered,
          slashQuery,
          (item) => `${item.name} ${item.description ?? ""}`,
        )
      : skillCatalogOrdered;
  }, [skillCatalogOrdered, slashOpen, slashQuery]);
  const activeMenu = slashOpen ? "slash" : mentionOpen ? "mention" : null;
  const activeItems = activeMenu === "slash" ? slashFiltered : activeMenu === "mention" ? mentionFiltered : [];
  const pluginSkillFiles = importedPlugins.flatMap((plugin) =>
    plugin.files.filter((file) => file.objectType === "command" || file.objectType === "skill"),
  );
  // List all non-hidden built-ins so toggles match market built-in extensions; hide only product-hidden.
  const composerExtensions = ONMYAGENT_EXTENSION_CATALOG.filter(
    (entry) => !builtInExtensionsDisabled && !isOnMyAgentExtensionHidden(entry),
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
    const insertion = `/${command.name} `;
    const draft = props.draft;
    // Replace only the trailing `/` or `/partial` so an existing skill chip is kept.
    if (/\/[^\s/]*$/.test(draft)) {
      props.onDraftChange(draft.replace(/\/[^\s/]*$/, insertion));
    } else {
      const needsSpace = draft.length > 0 && !/\s$/.test(draft);
      props.onDraftChange(`${draft}${needsSpace ? " " : ""}${insertion}`);
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
      // Compact composer notice — never dump long/corrupted native names into the card.
      if (accepted.length === 1) {
        const name = accepted[0]?.name?.trim() || "";
        const displayName = isSafeAttachmentDisplayName(name)
          ? name.length > 40
            ? `${name.slice(0, 37)}…`
            : name
          : null;
        props.onNotice({
          title: t("composer.upload_success_title"),
          description: displayName
            ? t("composer.uploaded_single_file_short", { name: displayName })
            : null,
          tone: "success",
        });
      } else {
        props.onNotice({
          title: t("composer.upload_success_title"),
          description: t("composer.uploaded_multiple_files", { count: accepted.length }),
          tone: "success",
        });
      }
    }

    if (oversize.length) {
      props.onNotice({
        title:
          oversize.length === 1
            ? t("composer.file_exceeds_limit", {
                name: isSafeAttachmentDisplayName(oversize[0] ?? "")
                  ? oversize[0]
                  : t("composer.file_kind"),
              })
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
    // Guard against native bugs that stringify Swift String as JoinedSequence debug text.
    const safeName = sanitizeAppshotFileName(payload.name);
    const binary = atob(payload.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    await addAttachments([
      new File([bytes], safeName, {
        type: payload.mimeType,
        lastModified: Date.now(),
      }),
    ]);
    // Dedicated short notice — no filename dump (attachment chip already shows it).
    props.onNotice({
      title: t("composer.appshot_success"),
      tone: "success",
    });
  };

  // Appshot requires the macOS Computer Use helper; hide the action elsewhere.
  const canCaptureAppshot = isAppshotCaptureSupported();

  const captureAppshot = async () => {
    if (!props.attachmentsEnabled || !canCaptureAppshot) return;
    setToolMenuOpen(false);
    try {
      await attachAppshot(await desktopBridge.captureComputerUseAppshot());
    } catch (error) {
      const platform = detectClientPlatform();
      const fallback =
        platform === "windows"
          ? t("composer.appshot_unsupported_windows")
          : platform === "linux"
            ? t("composer.appshot_unsupported_linux")
            : t("composer.appshot_failed");
      props.onNotice({
        title: error instanceof Error ? error.message : fallback,
        tone: "warning",
      });
    }
  };

  useEffect(() => {
    if (!canCaptureAppshot) return;
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
  // + menu reuses the same catalog/order as `/` (already pin-sorted).
  const filteredSkillItems = filterToolMenuItems(
    skillCatalogOrdered,
    skillSearchQuery,
    (item) => `${item.name} ${item.description ?? ""}`,
  );

  const handleTogglePinnedSkill = useCallback((command: SlashCommandOption) => {
    // Normalize to skill:<name> and drop legacy cmd:/skill: aliases for the same name.
    const primaryId = `skill:${command.name}`;
    const aliases = new Set([primaryId, command.id, `cmd:${command.name}`, `skill:${command.name}`]);
    setPinnedSkillIds((current) => {
      const had = current.some((id) => aliases.has(id));
      const stripped = current.filter((id) => !aliases.has(id));
      const next = had ? stripped : [primaryId, ...stripped].slice(0, 24);
      writePinnedSkillIds(next);
      return next;
    });
  }, []);
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

  const hasBottomAccessory = Boolean(props.bottomAccessory);
  // When workspace/permission bar sits under the card, share the outer silhouette:
  // full width + square joint (no top corners on the bar, no bottom corners on the card).
  const panelRoundedClass =
    mentionOpen || slashOpen
      ? "rounded-t-[18px] border-t-transparent"
      : hasBottomAccessory
        ? "rounded-t-xl rounded-b-none"
        : "rounded-xl";

  const homeLayout = Boolean(props.homeLayout);

  return (
    <div
      ref={rootRef}
      className={`sticky bottom-0 mac:titlebar-no-drag ${toolMenuOpen ? "z-50" : "z-20"} ${
        homeLayout
          ? "bg-transparent px-0 pb-0 pt-0"
          : `bg-gradient-to-t from-dls-background via-dls-background/95 to-transparent px-4 md:px-8 pb-5 ${props.compactTopSpacing ? "pt-0" : "pt-3"}`
      }`}
      style={COMPOSER_CONTAIN_STYLE}
      onKeyDownCapture={handleKeyDownCapture}
      onCompositionStart={() => {
        imeComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        imeComposingRef.current = false;
      }}
    >
      {/* Same max-w as session transcript column (session-surface contentRef). */}
      <div
        className={
          homeLayout
            ? "mx-auto w-full max-w-none"
            : "mx-auto w-full max-w-[1120px]" /* SESSION_CONTENT_MAX_WIDTH_CLASS */
        }
      >
        {/* Main composer panel — input + primary toolbar only (WorkBuddy layout). */}
        <div
          className={`relative overflow-visible bg-dls-surface-solid ${props.showOuterBorder ? `border border-dls-border shadow-sm${hasBottomAccessory ? " border-b-0" : ""}` : ""} ${panelRoundedClass}`}
        >
          {props.topAccessory ? <div className="relative z-10">{props.topAccessory}</div> : null}
          <ReactComposerNotice notice={props.notice} />

          <ComposerMentionMenu
            open={mentionOpen}
            filtered={mentionFiltered}
            activeMenu={activeMenu}
            menuIndex={menuIndex}
            menuItemRefs={menuItemRefs}
            setMenuIndex={setMenuIndex}
            onSelect={(item) => {
              props.onInsertMention(item.kind, item.value);
              setMentionOpen(false);
            }}
          />
          <ComposerSlashMenu
            open={slashOpen}
            filtered={slashFiltered}
            commandsLoaded={commandsLoaded}
            commandsLoading={commandsLoading}
            activeMenu={activeMenu}
            menuIndex={menuIndex}
            menuItemRefs={menuItemRefs}
            setMenuIndex={setMenuIndex}
            onSelect={applyCommandSelection}
          />

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
              props.attachments.length > 0
                ? homeLayout
                  ? "px-3.5 pb-1.5 pt-2"
                  : "px-4 pb-2 pt-2"
                : homeLayout
                  ? // Same tight empty height as assistant in-session composer.
                    "px-3.5 pb-1.5 pt-2.5"
                  : "px-4 pb-2 pt-3"
            }
          >
            {/* Editor */}
            <LexicalPromptEditor
              value={props.draft}
              mentions={props.mentions}
              scenarioTags={props.scenarioTags}
              disabled={props.disabled}
              compact={homeLayout}
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
            <div
              className={
                homeLayout
                  ? "mt-1 flex items-center justify-between gap-1.5"
                  : "mt-2 flex items-end justify-between gap-1.5"
              }
            >
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
                            // Match 2nd-column skill titles: primary text, not muted gray.
                            className="justify-between gap-2 text-dls-text hover:text-dls-text"
                            disabled={!props.attachmentsEnabled}
                            onMouseEnter={() => setToolMenuSection("files")}
                            onFocus={() => setToolMenuSection("files")}
                            onClick={openFilePicker}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Paperclip className="size-3.5 shrink-0 text-dls-text" />
                              <span className="truncate text-sm leading-5 text-dls-text">{t("composer.add_file")}</span>
                            </span>
                          </MenuRowButton>
                          {canCaptureAppshot ? (
                            <MenuRowButton
                              type="button"
                              align="center"
                              density="compact"
                              className="gap-2 text-dls-text hover:text-dls-text"
                              disabled={!props.attachmentsEnabled}
                              onClick={() => void captureAppshot()}
                            >
                              <Camera className="size-3.5 shrink-0 text-dls-text" />
                              <span className="truncate text-sm leading-5 text-dls-text">{t("composer.capture_appshot")}</span>
                            </MenuRowButton>
                          ) : null}
                          <div
                            className="my-1 h-px bg-dls-border/80"
                            role="separator"
                          />
                          {([
                            ["modes", t("composer.collaboration_mode"), Sparkles] as const,
                            ...(promptTemplates.length > 0
                              ? ([["templates", t("composer.prompt_templates_short"), ClipboardList]] as const)
                              : []),
                            ["skills", t("dashboard.skills"), SkillGlyphIcon] as const,
                            ["mcps", t("composer.connectors_label"), Plug] as const,
                          ]).map(([section, label, Icon]) => (
                            <MenuRowButton
                              key={section}
                              type="button"
                              align="center"
                              density="compact"
                              active={toolMenuSection === section}
                              className="justify-between gap-2 text-dls-text hover:text-dls-text"
                              onMouseEnter={() => {
                                setToolMenuSection(section);
                                // WorkBuddy-style: open first template category so the 3rd flyout appears.
                                if (section === "templates" && promptTemplates[0]) {
                                  setSelectedPromptTemplateId(promptTemplates[0].id);
                                }
                              }}
                              onFocus={() => {
                                setToolMenuSection(section);
                                if (section === "templates" && promptTemplates[0]) {
                                  setSelectedPromptTemplateId(promptTemplates[0].id);
                                }
                              }}
                              onClick={() => {
                                setToolMenuSection(section);
                                if (section === "templates" && promptTemplates[0]) {
                                  setSelectedPromptTemplateId(promptTemplates[0].id);
                                }
                              }}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <Icon className="size-3.5 shrink-0 text-dls-text" />
                                <span className="truncate text-sm leading-5 text-dls-text">{label}</span>
                              </span>
                              <ChevronRight className="size-3.5 shrink-0 text-dls-text/50" />
                            </MenuRowButton>
                          ))}
                        </div>
                      </div>
                      {toolMenuSection === "files" ? null : (
                        <div
                          className={cn(
                            // Shared 2nd-column width for modes / prompts / skills / connectors.
                            "absolute bottom-0 left-[calc(11rem-1px)] flex w-[min(calc(100vw-13.5rem),17.5rem)] max-w-[17.5rem] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid",
                          )}
                          style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
                        >
                          {toolMenuSection === "templates" ? (
                            <div className="flex min-h-9 shrink-0 items-center border-b border-dls-border px-3 py-1.5 text-sm font-medium text-dls-text">
                              {t("composer.prompt_templates")}
                            </div>
                          ) : toolMenuSection === "skills" ? (
                            <div className="space-y-1.5 px-3 pt-2 pb-1">
                              {/* Match connectors panel: title + quiet configure, then search */}
                              <div className="flex min-h-7 items-center justify-between gap-3">
                                <div className="text-sm font-medium text-dls-text">
                                  {t("dashboard.skills")}
                                  <span className="tabular-nums font-medium text-dls-secondary">
                                    {" "}
                                    ({filteredSkillItems.length + filteredPluginSkillFiles.length})
                                  </span>
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
                              <InputGroup
                                controlSize="sm"
                                radius="lg"
                                tone="surfaceMuted"
                                className="border-dls-border/50"
                              >
                                <InputGroupAddon align="inline-start" inset="compact">
                                  <Search aria-hidden="true" className="size-3.5 text-dls-secondary" />
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
                            <div className="space-y-1.5 px-3 pt-2 pb-1">
                              {/* WorkBuddy-like: title + count, configure, then search */}
                              <div className="flex min-h-7 items-center justify-between gap-3">
                                <div className="text-sm font-medium text-dls-text">
                                  {t("composer.connectors_label")}
                                  <span className="tabular-nums font-medium text-dls-secondary">
                                    {" "}
                                    ({filteredMcpItems.length + filteredComposerExtensions.length})
                                  </span>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  className="shrink-0 gap-1 text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-text"
                                  onClick={openConnectorsConfigure}
                                  title={t("composer.configure")}
                                  aria-label={t("composer.configure")}
                                >
                                  <Settings className="size-3.5" />
                                  {t("composer.configure")}
                                </Button>
                              </div>
                              <InputGroup
                                controlSize="sm"
                                radius="lg"
                                tone="surfaceMuted"
                                className="border-dls-border/50"
                              >
                                <InputGroupAddon align="inline-start" inset="compact">
                                  <Search aria-hidden="true" className="size-3.5 text-dls-secondary" />
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
                          <div
                            className={cn(
                              "overflow-x-hidden overflow-y-auto px-1.5 pb-1.5",
                              // Skills/connectors already pad under search — avoid double gap.
                              toolMenuSection === "skills" || toolMenuSection === "mcps"
                                ? "pt-0"
                                : "pt-1.5",
                              // Templates list is short (≤3) — keep panel compact so the 3rd flyout fits.
                              toolMenuSection === "templates" ? "max-h-48" : "max-h-56",
                            )}
                          >
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
                                  <p className="whitespace-nowrap text-sm leading-5 text-dls-secondary">
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
                                <TooltipProvider delay={280}>
                                  <div className="grid min-w-0 gap-0.5">
                                    {filteredSkillItems.map((command) => {
                                      const description = skillMenuDescription(command.description);
                                      const isPinned =
                                        pinnedSkillIds.includes(command.id) ||
                                        pinnedSkillIds.includes(`skill:${command.name}`) ||
                                        pinnedSkillIds.includes(`cmd:${command.name}`);
                                      const rowBody = (
                                        <div className="group/skill flex min-w-0 items-stretch gap-0.5 rounded-xl hover:bg-dls-surface-muted/70">
                                          <MenuRowButton
                                            type="button"
                                            align="center"
                                            className="min-w-0 flex-1 gap-2 overflow-hidden bg-transparent hover:bg-transparent"
                                            onClick={() => applyCommandSelection(command)}
                                          >
                                            <div className="min-w-0 flex-1 overflow-hidden text-left">
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
                                          <button
                                            type="button"
                                            className={cn(
                                              "inline-flex size-8 shrink-0 !w-8 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                                              isPinned
                                                ? "text-dls-accent hover:bg-dls-surface-muted"
                                                : "text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-text",
                                            )}
                                            title={
                                              isPinned
                                                ? t("composer.unpin_skill")
                                                : t("composer.pin_skill")
                                            }
                                            aria-label={
                                              isPinned
                                                ? t("composer.unpin_skill")
                                                : t("composer.pin_skill")
                                            }
                                            aria-pressed={isPinned}
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              handleTogglePinnedSkill(command);
                                            }}
                                          >
                                            {isPinned ? (
                                              <PinOff className="size-3.5" aria-hidden />
                                            ) : (
                                              <Pin className="size-3.5" aria-hidden />
                                            )}
                                          </button>
                                        </div>
                                      );
                                      if (!description) {
                                        return <div key={command.id}>{rowBody}</div>;
                                      }
                                      return (
                                        <Tooltip key={command.id}>
                                          <TooltipTrigger
                                            render={<div className="min-w-0" />}
                                            className="min-w-0"
                                          >
                                            {rowBody}
                                          </TooltipTrigger>
                                          <TooltipContent
                                            side="bottom"
                                            align="start"
                                            sideOffset={6}
                                            className="max-w-[18rem] whitespace-normal text-left leading-5"
                                          >
                                            {description}
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    })}
                                    {filteredPluginSkillFiles.map((file) => (
                                      <MenuRowButton
                                        key={`${file.configObjectId}:${file.path}`}
                                        type="button"
                                        align="center"
                                        className="w-full min-w-0 max-w-full gap-2 overflow-hidden"
                                        onClick={() => applyPluginFileSelection(file)}
                                      >
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
                                </TooltipProvider>
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
                                <TooltipProvider delay={280}>
                                  <div className="grid min-w-0 gap-0.5">
                                    {filteredComposerExtensions.length > 0 ? (
                                      <>
                                        <div className="px-2 pb-0.5 pt-1 text-2xs font-medium uppercase tracking-wide text-dls-secondary">
                                          {t("composer.connectors_group_builtin")}
                                        </div>
                                        {filteredComposerExtensions.map((entry) => {
                                          const description = entry.description?.trim() ?? "";
                                          const enabled = isOnMyAgentExtensionEnabled(entry);
                                          const hasPrompts = Boolean(entry.suggestedPrompts?.length);
                                          const rowKey = entry.id ?? entry.serverName ?? entry.name;
                                          const rowBody = (
                                            <div
                                              className={cn(
                                                "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-dls-hover",
                                                selectedComposerExtension === entry && "bg-dls-hover",
                                              )}
                                              onMouseEnter={() =>
                                                setSelectedComposerExtension(hasPrompts ? entry : null)
                                              }
                                            >
                                              <IconTile
                                                size="sm"
                                                shape="lg"
                                                tone="surface"
                                                border
                                                className={extensionIconTileClassName}
                                              >
                                                {extensionIcon(entry, 16)}
                                              </IconTile>
                                              <button
                                                type="button"
                                                className="min-w-0 flex-1 overflow-hidden text-left"
                                                onClick={() => {
                                                  if (hasPrompts) {
                                                    setSelectedComposerExtension(entry);
                                                    return;
                                                  }
                                                  if (!enabled) {
                                                    setOnMyAgentExtensionEnabled(entry, true);
                                                    setExtensionStateVersion((v) => v + 1);
                                                  }
                                                  applyExtensionSelection(entry);
                                                }}
                                              >
                                                <div className="truncate text-sm font-medium text-dls-text">
                                                  {entry.name}
                                                </div>
                                                {description ? (
                                                  <div className="truncate text-xs text-dls-secondary">
                                                    {description}
                                                  </div>
                                                ) : null}
                                              </button>
                                              <Switch
                                                size="sm"
                                                className="shrink-0"
                                                checked={enabled}
                                                onCheckedChange={(next) => {
                                                  setOnMyAgentExtensionEnabled(entry, next);
                                                  setExtensionStateVersion((v) => v + 1);
                                                }}
                                                aria-label={entry.name}
                                              />
                                            </div>
                                          );
                                          if (!description) {
                                            return <div key={rowKey}>{rowBody}</div>;
                                          }
                                          return (
                                            <Tooltip key={rowKey}>
                                              <TooltipTrigger
                                                render={<div className="min-w-0" />}
                                                className="min-w-0"
                                              >
                                                {rowBody}
                                              </TooltipTrigger>
                                              <TooltipContent
                                                side="bottom"
                                                align="start"
                                                sideOffset={6}
                                                className="max-w-[18rem] whitespace-normal text-left leading-5"
                                              >
                                                {description}
                                              </TooltipContent>
                                            </Tooltip>
                                          );
                                        })}
                                      </>
                                    ) : null}
                                    {filteredMcpItems.length > 0 ? (
                                      <>
                                        <div className="px-2 pb-0.5 pt-2 text-2xs font-medium uppercase tracking-wide text-dls-secondary">
                                          {t("composer.connectors_group_mcp")}
                                        </div>
                                        {filteredMcpItems.map(({ entry, status }) => {
                                          const description = mcpServerDescription(entry);
                                          const ready = status === "connected";
                                          const rowBody = (
                                            <div className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-dls-hover">
                                              <IconTile
                                                size="sm"
                                                shape="lg"
                                                tone="surface"
                                                border
                                                className={extensionIconTileClassName}
                                              >
                                                <Plug
                                                  className="size-3.5 text-neutral-900"
                                                  strokeWidth={2}
                                                  aria-hidden="true"
                                                />
                                              </IconTile>
                                              <div className="min-w-0 flex-1 overflow-hidden">
                                                <div className="truncate text-sm font-medium text-dls-text">
                                                  {entry.name}
                                                </div>
                                                {description ? (
                                                  <div className="truncate text-xs text-dls-secondary">
                                                    {description}
                                                  </div>
                                                ) : null}
                                              </div>
                                              <Switch
                                                size="sm"
                                                className="shrink-0"
                                                checked={ready}
                                                onCheckedChange={() => {
                                                  // MCP enable/disable lives in opencode config — open the editor.
                                                  openCustomConnectorOrMarketplace();
                                                }}
                                                aria-label={entry.name}
                                              />
                                            </div>
                                          );
                                          if (!description) {
                                            return <div key={entry.name}>{rowBody}</div>;
                                          }
                                          return (
                                            <Tooltip key={entry.name}>
                                              <TooltipTrigger
                                                render={<div className="min-w-0" />}
                                                className="min-w-0"
                                              >
                                                {rowBody}
                                              </TooltipTrigger>
                                              <TooltipContent
                                                side="bottom"
                                                align="start"
                                                sideOffset={6}
                                                className="max-w-[18rem] whitespace-normal text-left leading-5"
                                              >
                                                {description}
                                              </TooltipContent>
                                            </Tooltip>
                                          );
                                        })}
                                      </>
                                    ) : null}
                                  </div>
                                </TooltipProvider>
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
                          className="absolute bottom-0 left-[calc(11rem+17.5rem-2px)] flex w-[min(calc(100vw-30rem),16rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid"
                          style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
                        >
                          <div className="flex min-h-9 shrink-0 items-center border-b border-dls-border px-3 py-1.5 text-sm font-medium text-dls-text">
                            <span className="truncate">{selectedPromptTemplate.label}</span>
                          </div>
                          <div className="max-h-48 overflow-x-hidden overflow-y-auto p-1.5">
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
                                  <span className="line-clamp-2 text-sm leading-5 text-dls-text">{prompt}</span>
                                </MenuRowButton>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {toolMenuSection === "mcps" && selectedComposerExtension?.suggestedPrompts?.length ? (
                        <div
                          className="absolute bottom-0 left-[calc(11rem+17.5rem-2px)] flex w-[min(calc(100vw-30rem),16rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid"
                          style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
                        >
                          <div className="flex min-h-9 shrink-0 items-center border-b border-dls-border px-3 py-1.5 text-sm font-medium text-dls-text">
                            <span className="truncate">{selectedComposerExtension.name}</span>
                          </div>
                          <div className="max-h-48 overflow-x-hidden overflow-y-auto p-1.5">
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
                                  <span className="line-clamp-2 text-sm leading-5 text-dls-text">{prompt}</span>
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
                    className="max-w-40 shrink-0 gap-1.5 bg-dls-hover px-2 text-dls-text hover:bg-dls-active"
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
        {/* Secondary chrome: full-width bar flush under card, square top corners. */}
        {props.bottomAccessory ? (
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
