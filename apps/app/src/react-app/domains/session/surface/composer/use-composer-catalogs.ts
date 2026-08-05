/**
 * Commands / skills / MCP / plugin loading + derived tool-menu catalogs.
 * Mechanical extract from ReactSessionComposer — no behavior changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpDirectoryInfo } from "../../../../../app/constants";
import { ONMYAGENT_EXTENSION_CATALOG } from "../../../../../app/constants";
import type { CloudImportedPlugin } from "../../../../../app/cloud/import-state";
import type {
  McpServerEntry,
  McpStatusMap,
  SkillCard,
  SlashCommandOption,
} from "../../../../../app/types";
import {
  isOnMyAgentExtensionHidden,
  ONMYAGENT_EXTENSION_STATE_CHANGED,
} from "../../../shared";
import type { ComposerPromptTemplate, ToolMenuSection } from "./composer-helpers";
import { mergeSlashCommandsWithSkills } from "./slash-command-merge";
import {
  readPinnedSkillIds,
  writePinnedSkillIds,
} from "@/react-app/domains/plugins";
import {
  buildActiveMcpItems,
  buildCombinedSkillItems,
  buildOnmyagentInstalledNames,
  collectPluginSkillFiles,
  filterComposerExtensions,
  filterMcpMenuItems,
  filterPluginSkillFiles,
  filterSkillMenuItems,
  filterSlashSkillItems,
  nextPinnedSkillIds,
  orderSkillCatalog,
} from "./skill-catalog";

export type ComposerCatalogListFns = {
  listCommands: () => Promise<SlashCommandOption[]>;
  listSkills?: () => Promise<SkillCard[]>;
  listMcp?: () => Promise<{
    servers: McpServerEntry[];
    statuses: McpStatusMap;
    status: string | null;
  }>;
  listImportedPlugins?: () => Promise<CloudImportedPlugin[]>;
};

export type UseComposerCatalogsInput = ComposerCatalogListFns & {
  skillsProp?: SkillCard[];
  mcpServersProp?: McpServerEntry[];
  mcpStatusProp?: string | null;
  mcpStatusesProp?: McpStatusMap;
  importedPluginsProp?: CloudImportedPlugin[];
  promptTemplates?: ComposerPromptTemplate[];
  slashOpen: boolean;
  slashQuery: string;
  toolMenuOpen: boolean;
  toolMenuSection: ToolMenuSection;
  skillSearchQuery: string;
  connectorSearchQuery: string;
  builtInExtensionsDisabled: boolean;
  setSkillSearchQuery: (value: string) => void;
  setConnectorSearchQuery: (value: string) => void;
  setSelectedPromptTemplateId: (
    value: string | null | ((current: string | null) => string | null),
  ) => void;
  setSelectedComposerExtension: (value: McpDirectoryInfo | null) => void;
};

export function useComposerCatalogs(input: UseComposerCatalogsInput) {
  const [commands, setCommands] = useState<SlashCommandOption[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillCard[]>(input.skillsProp ?? []);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>(input.mcpServersProp ?? []);
  const [mcpStatus, setMcpStatus] = useState<string | null>(input.mcpStatusProp ?? null);
  const [mcpStatuses, setMcpStatuses] = useState<McpStatusMap>(input.mcpStatusesProp ?? {});
  const [importedPlugins, setImportedPlugins] = useState<CloudImportedPlugin[]>(
    input.importedPluginsProp ?? [],
  );
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>(() => readPinnedSkillIds());
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [skillsLoaded, setSkillsLoaded] = useState(Boolean(input.skillsProp));
  const [mcpLoaded, setMcpLoaded] = useState(Boolean(input.mcpServersProp));
  // Bumped on extension enable/hide storage changes so catalog filters re-read.
  const [extensionStateVersion, setExtensionStateVersion] = useState(0);

  const commandsCacheRef = useRef<SlashCommandOption[] | null>(null);
  const commandsRequestRef = useRef<Promise<SlashCommandOption[]> | null>(null);
  const commandsLoadVersionRef = useRef(0);
  const listCommandsRef = useRef(input.listCommands);
  const listSkillsRef = useRef(input.listSkills);
  const listMcpRef = useRef(input.listMcp);
  const listImportedPluginsRef = useRef(input.listImportedPlugins);
  const toolMenuLoadRef = useRef({
    openId: 0,
    commands: false,
    skills: false,
    mcps: false,
    plugins: false,
  });

  useEffect(() => {
    setSkills(input.skillsProp ?? []);
  }, [input.skillsProp]);

  useEffect(() => {
    setMcpServers(input.mcpServersProp ?? []);
    setMcpStatus(input.mcpStatusProp ?? null);
    setMcpStatuses(input.mcpStatusesProp ?? {});
  }, [input.mcpServersProp, input.mcpStatusProp, input.mcpStatusesProp]);

  useEffect(() => {
    setImportedPlugins(input.importedPluginsProp ?? []);
  }, [input.importedPluginsProp]);

  useEffect(() => {
    listCommandsRef.current = input.listCommands;
  }, [input.listCommands]);

  useEffect(() => {
    listSkillsRef.current = input.listSkills;
  }, [input.listSkills]);

  useEffect(() => {
    listMcpRef.current = input.listMcp;
  }, [input.listMcp]);

  useEffect(() => {
    listImportedPluginsRef.current = input.listImportedPlugins;
  }, [input.listImportedPlugins]);

  useEffect(() => {
    commandsLoadVersionRef.current += 1;
    commandsCacheRef.current = null;
    commandsRequestRef.current = null;
  }, [input.listCommands]);

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

      const merged = mergeSlashCommandsWithSkills(cmds, skillCards);
      // Preserve SkillCard.scope so OnMyAgent installs can sort ahead of the rest.
      if (merged.skillsForState) {
        setSkills(merged.skillsForState);
        setSkillsLoaded(true);
      }
      return merged.commands;
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
    if (!input.toolMenuOpen) return;
    // Invalidate slash/skill caches so marketplace installs show without restart.
    commandsLoadVersionRef.current += 1;
    commandsCacheRef.current = null;
    commandsRequestRef.current = null;
    toolMenuLoadRef.current = {
      openId: toolMenuLoadRef.current.openId + 1,
      commands: false,
      skills: false,
      mcps: false,
      plugins: false,
    };
    setCommandsLoaded(false);
    setSkillsLoaded(Boolean(input.skillsProp));
    setMcpLoaded(Boolean(input.mcpServersProp));
    // Match original deps: only re-run when the tool menu opens/closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [input.toolMenuOpen]);

  useEffect(() => {
    input.setSkillSearchQuery("");
    input.setConnectorSearchQuery("");
    if (!input.toolMenuOpen || input.toolMenuSection !== "templates") {
      input.setSelectedPromptTemplateId(null);
    } else {
      // WorkBuddy-style cascade: open the 3rd flyout as soon as prompts section is active.
      const templates = input.promptTemplates ?? [];
      input.setSelectedPromptTemplateId((current) => {
        if (current && templates.some((template) => template.id === current)) {
          return current;
        }
        return templates[0]?.id ?? null;
      });
    }
    if (!input.toolMenuOpen || input.toolMenuSection !== "mcps") {
      input.setSelectedComposerExtension(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- match original composer deps
  }, [input.toolMenuOpen, input.toolMenuSection, input.promptTemplates]);

  useEffect(() => {
    // Closing the menus must clear loading; otherwise a cancelled in-flight
    // listCommands leaves commandsLoading=true and the slash panel stuck on
    // "正在加载命令…" the next time `/` is typed (or even while still open).
    if (!input.slashOpen && !input.toolMenuOpen) {
      setCommandsLoading(false);
      return;
    }
    if (input.toolMenuOpen && toolMenuLoadRef.current.commands) return;
    if (input.toolMenuOpen) toolMenuLoadRef.current.commands = true;
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
  }, [input.slashOpen, input.toolMenuOpen, loadCommands]);

  useEffect(() => {
    if (!input.toolMenuOpen) return;
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
  }, [input.toolMenuOpen]);

  useEffect(() => {
    if (!input.toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    const listSkills = listSkillsRef.current;
    const listMcp = listMcpRef.current;
    if (input.toolMenuSection === "skills" && listSkills && !toolMenuLoadRef.current.skills) {
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
    if (input.toolMenuSection === "mcps" && listMcp && !toolMenuLoadRef.current.mcps) {
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
  }, [input.toolMenuOpen, input.toolMenuSection]);

  const onmyagentInstalledNames = useMemo(
    () => buildOnmyagentInstalledNames(skills),
    [skills],
  );
  const combinedSkillItems = useMemo(
    () => buildCombinedSkillItems(skills, commands, onmyagentInstalledNames),
    [commands, onmyagentInstalledNames, skills],
  );
  const skillCatalogOrdered = useMemo(
    () => orderSkillCatalog(combinedSkillItems, pinnedSkillIds),
    [combinedSkillItems, pinnedSkillIds],
  );
  const slashFiltered = useMemo(
    () => filterSlashSkillItems(skillCatalogOrdered, input.slashOpen, input.slashQuery),
    [skillCatalogOrdered, input.slashOpen, input.slashQuery],
  );

  const pluginSkillFiles = useMemo(
    () => collectPluginSkillFiles(importedPlugins),
    [importedPlugins],
  );
  // List all non-hidden built-ins so toggles match market built-in extensions; hide only product-hidden.
  const composerExtensions = useMemo(
    () =>
      ONMYAGENT_EXTENSION_CATALOG.filter(
        (entry) => !input.builtInExtensionsDisabled && !isOnMyAgentExtensionHidden(entry),
      ),
    // extensionStateVersion forces re-read of hide/enable flags from storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional re-filter trigger
    [input.builtInExtensionsDisabled, extensionStateVersion],
  );

  const activeMcpItems = useMemo(
    () => buildActiveMcpItems(mcpServers, mcpStatuses),
    [mcpServers, mcpStatuses],
  );
  // + menu reuses the same catalog/order as `/` (already pin-sorted).
  const filteredSkillItems = filterSkillMenuItems(skillCatalogOrdered, input.skillSearchQuery);
  const filteredPluginSkillFiles = filterPluginSkillFiles(pluginSkillFiles, input.skillSearchQuery);
  const filteredMcpItems = filterMcpMenuItems(activeMcpItems, input.connectorSearchQuery);
  const filteredComposerExtensions = filterComposerExtensions(
    composerExtensions,
    input.connectorSearchQuery,
  );
  const hasSkills = combinedSkillItems.length > 0 || pluginSkillFiles.length > 0;
  const hasSkillMatches = filteredSkillItems.length > 0 || filteredPluginSkillFiles.length > 0;
  const hasConnectors = activeMcpItems.length > 0 || composerExtensions.length > 0;
  const hasConnectorMatches =
    filteredMcpItems.length > 0 || filteredComposerExtensions.length > 0;

  const handleTogglePinnedSkill = useCallback((command: SlashCommandOption) => {
    setPinnedSkillIds((current) => {
      const next = nextPinnedSkillIds(current, command);
      writePinnedSkillIds(next);
      return next;
    });
  }, []);

  return {
    commands,
    commandsLoading,
    commandsLoaded,
    skillsLoading,
    skillsLoaded,
    skills,
    mcpLoading,
    mcpLoaded,
    mcpServers,
    mcpStatus,
    mcpStatuses,
    importedPlugins,
    pinnedSkillIds,
    combinedSkillItems,
    skillCatalogOrdered,
    slashFiltered,
    pluginSkillFiles,
    composerExtensions,
    activeMcpItems,
    filteredSkillItems,
    filteredPluginSkillFiles,
    filteredMcpItems,
    filteredComposerExtensions,
    hasSkills,
    hasSkillMatches,
    hasConnectors,
    hasConnectorMatches,
    handleTogglePinnedSkill,
    setExtensionStateVersion,
  };
}
