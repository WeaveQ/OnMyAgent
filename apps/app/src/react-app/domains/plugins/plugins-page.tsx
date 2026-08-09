/** @jsxImportSource react */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  FolderOpen,
  MessageCircle,
  Plus,
  Search,
  ShoppingBag,
  Upload,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CodeToken } from "@/components/ui/code-token";
import { FilterChip, IconTile, SegmentedTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { MARKETPLACE_CARD_GRID_COMPACT } from "@/components/ui/skill-marketplace-card";
import { CountBadge, StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OnMyAgentServerClient } from "@/app/lib/onmyagent-server";
import { listLocalSkills } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import {
  getMcpServerName,
  isBuiltInOnMyAgentExtension,
  ONMYAGENT_EXTENSION_CATALOG,
  type McpDirectoryInfo,
} from "@/app/constants";
import {
  isOnMyAgentExtensionEnabled,
  isOnMyAgentExtensionHidden,
  ONMYAGENT_EXTENSION_STATE_CHANGED,
  setOnMyAgentExtensionEnabled,
} from "@/react-app/domains/shared";
import { extensionIcon, extensionIconTileClassName } from "./extension-icon";
import { classifySkillScope, classifyLocalOrigin, SKILL_SCOPE_LABELS, LOCAL_ORIGIN_LABELS, type SkillScope, type LocalSkillOrigin } from "./skill-scope";
import { resolveBundledSkillDisplay } from "./bundled-skill-locale";
import { ArtifactPluginCard } from "./artifact-plugin-card";
import {
  connectorTileClassName,
  connectorTileDescClassName,
  connectorTileEnabledClass,
  connectorTileHeaderClassName,
  connectorTileOrderClass,
} from "./connector-tile";
import { loadArtifactPluginCatalog } from "./artifact-plugin-client";
import {
  ArtifactPluginIcon,
  getArtifactPluginConnectCopy,
} from "./artifact-plugin-detail";
import { createArtifactPluginState } from "./artifact-plugin-state";
import { OfficeCliPluginCard } from "./officecli-plugin";
import { LarkCliPluginCard } from "./larkcli-plugin";
import { TencentDocsPluginCard } from "./tencent-docs-plugin";
import { BaiduDrivePluginCard } from "./baidu-drive-plugin";
import { KdocsPluginCard } from "./kdocs-plugin";
import { DingtalkPluginCard } from "./dingtalk-plugin";
import { WecomPluginCard } from "./wecom-plugin";
import { TencentMeetingPluginCard } from "./tencent-meeting-plugin";
import { recommendedManagedConnectorIds } from "./capability-shelf";
import { ConnectorConnectDialog } from "./connector-connect-dialog";

/** Recommended plugin cards keyed by capability-shelf id. */
const RECOMMENDED_PLUGIN_CARDS: Record<
  string,
  (props: { onTryPrompt: (prompt: string) => void }) => ReactNode
> = {
  officecli: (props) => <OfficeCliPluginCard onTryPrompt={props.onTryPrompt} />,
  "lark-cli": (props) => <LarkCliPluginCard onTryPrompt={props.onTryPrompt} />,
  "tencent-docs": (props) => (
    <TencentDocsPluginCard onTryPrompt={props.onTryPrompt} />
  ),
  "baidu-drive": (props) => (
    <BaiduDrivePluginCard onTryPrompt={props.onTryPrompt} />
  ),
  kdocs: (props) => <KdocsPluginCard onTryPrompt={props.onTryPrompt} />,
  dingtalk: (props) => <DingtalkPluginCard onTryPrompt={props.onTryPrompt} />,
  wecom: (props) => <WecomPluginCard onTryPrompt={props.onTryPrompt} />,
  "tencent-meeting": (props) => (
    <TencentMeetingPluginCard onTryPrompt={props.onTryPrompt} />
  ),
};

/** Render recommended connector cards in shelf registry order. */
export function renderRecommendedPluginCards(input: {
  onTryPrompt: (pluginId: string) => (prompt: string) => void;
}): ReactNode[] {
  return recommendedManagedConnectorIds().flatMap((id) => {
    const render = RECOMMENDED_PLUGIN_CARDS[id];
    if (!render) return [];
    return [
      <span key={id} className="contents">
        {render({ onTryPrompt: input.onTryPrompt(id) })}
      </span>,
    ];
  });
}
import {
  getExtensionConfigSlot,
  type ExtensionConfigContext,
} from "@/react-app/domains/shared";
import { useLocal } from "@/react-app/kernel/local-provider";

/** Matches local provider install shape used by Ollama / OpenAI-compatible panels. */
type LocalProviderInstallInput = {
  providerId: string;
  name: string;
  baseURL: string;
  modelId: string;
  modelName: string;
  setDefault: boolean;
};

function describeInstallError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export type ArtifactPluginPromptSelection = {
  pluginId: string;
  skillId: string;
  prompt: string;
};

type PluginsPageProps = {
  workspaceId: string;
  workspaceRoot?: string | null;
  client?: OnMyAgentServerClient | null;
  marketOnly?: boolean;
  searchQuery?: string;
  onSelectArtifactPrompt?: (selection: ArtifactPluginPromptSelection) => void;
};



const pluginsTextClass = {
  cardTitle: "truncate text-sm font-medium leading-5 text-dls-text",
  featuredTitle: "truncate text-sm font-medium leading-5 text-dls-text",
  cardDescription: "mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary",
  cardDescriptionClamp: "mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary",
  statusMeta: "flex items-center gap-1 pt-0.5 text-xs font-medium text-dls-secondary",
  sectionTitle: "mb-2 text-sm font-medium leading-5 text-dls-text",
  // text-balance reduces mid-phrase wraps in long section hints.
  sectionLead: "max-w-3xl text-pretty text-xs leading-5 text-dls-secondary",
  emptyTitle: "text-sm font-medium text-dls-text",
  emptyDescription: "mt-1.5 text-xs text-dls-secondary",
  helper: "text-xs text-dls-secondary",
  pathHint: "truncate text-xs text-dls-secondary opacity-0 transition-opacity group-hover:opacity-100",
  categoryTitle: "mb-2 text-xs font-medium uppercase tracking-wide text-dls-secondary",
};

/**
 * Built-in product + file tools share one continuous 4-col grid
 * (equal card heights via auto-rows-fr + h-full tiles).
 */
const PRODUCT_CONNECTOR_GRID =
  "grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/** Coming-soon / recommend catalog can stay denser (shared columns + equal-height rows). */
const PLUGIN_CARD_GRID = cn(MARKETPLACE_CARD_GRID_COMPACT, "auto-rows-fr");

/** File-processing plugins: browser + Office suite in product order. */
const ARTIFACT_PLUGIN_DISPLAY_ORDER = [
  "browser",
  "documents",
  "spreadsheets",
  "pdf",
] as const;

/** Built-in extensions: product priority when enablement is equal. */
const BUILTIN_EXTENSION_DISPLAY_ORDER = [
  "computer-use",
  "browser-skill",
] as const;

/** Connector market filter strip (matches expert/skills category chips). */
type ConnectorFilterId = "all" | "builtin" | "recommended";

const CONNECTOR_FILTERS: ReadonlyArray<{
  id: ConnectorFilterId;
  labelKey:
    | "plugins.filter_all"
    | "plugins.filter_builtin"
    | "plugins.filter_recommended";
}> = [
  { id: "all", labelKey: "plugins.filter_all" },
  { id: "recommended", labelKey: "plugins.filter_recommended" },
  { id: "builtin", labelKey: "plugins.filter_builtin" },
];

function rankById(order: readonly string[], id: string): number {
  const index = order.indexOf(id);
  return index === -1 ? order.length : index;
}

const pluginsLayoutClass = {
  page: "flex h-full min-h-0 flex-col bg-dls-background",
  // No `flex` here: stretched flex children swallow bottom padding on scroll.
  // Match skills market — padding lives on the scroll surface itself.
  scrollArea: "min-h-0 flex-1 overflow-y-auto",
  // Match expert/skills: no max-w-6xl so side gutters match px-6 only.
  pageContainer: "w-full px-6 pb-16 pt-5",
  pluginPageContainer: "w-full space-y-8 px-6 pb-16 pt-5",
  section: "space-y-3",
  sectionHeader: "space-y-1",
  sectionTitle: "text-base font-medium leading-6 text-dls-text",
  sectionDivider: "border-t border-dls-border/50 pt-8",
  card: "rounded-2xl border border-transparent bg-dls-surface px-4 py-3.5 transition-colors",
  cardRow: "flex items-center gap-3",
  cardColumn: "flex flex-col",
  cardDisabled: "opacity-80",
  cardInteractive: "hover:border-dls-border hover:bg-dls-hover",
  cardMd: "min-h-36",
  cardLg: "min-h-36",
  iconButton: "rounded-lg text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
  disabledIconButton: "rounded-lg text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text disabled:pointer-events-none",
  cardGrid: PLUGIN_CARD_GRID,
  artifactCardGrid: PRODUCT_CONNECTOR_GRID,
  connectorCardGrid: PRODUCT_CONNECTOR_GRID,
  skillSectionTitle: "mb-2 flex items-baseline gap-2",
  skillSectionDescription: "mb-3 pl-6",
  originTabs: "mb-3 flex flex-wrap gap-0.5 pl-6",
};

function PluginStoreCard(props: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  layout?: "row" | "column";
  minHeight?: "sm" | "md" | "lg";
  title?: string;
}) {
  return (
    <div
      className={cn(
        pluginsLayoutClass.card,
        props.layout === "column" ? pluginsLayoutClass.cardColumn : pluginsLayoutClass.cardRow,
        props.minHeight === "sm" && "min-h-20",
        (props.minHeight === "md" || !props.minHeight) && pluginsLayoutClass.cardMd,
        props.minHeight === "lg" && pluginsLayoutClass.cardLg,
        props.disabled ? pluginsLayoutClass.cardDisabled : pluginsLayoutClass.cardInteractive,
        props.className,
      )}
      title={props.title}
    >
      {props.children}
    </div>
  );
}

function ArtifactPluginsCatalog(
  props: PluginsPageProps & {
    /** When true, omit section chrome — parent band provides title (Built-in). */
    embedded?: boolean;
  },
) {
  const [pluginState] = useState(() => createArtifactPluginState([]));
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);

  useEffect(
    () => pluginState.subscribe(() => setRevision((revision) => revision + 1)),
    [pluginState],
  );

  useEffect(() => {
    let cancelled = false;
    if (!props.client || !props.workspaceId) {
      setLoading(false);
      setLoadError(true);
      return;
    }

    setLoading(true);
    setLoadError(false);
    void loadArtifactPluginCatalog(props.client, props.workspaceId)
      .then(({ items }) => {
        if (!cancelled) pluginState.replace(items);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pluginState, props.client, props.workspaceId]);

  const plugins = useMemo(() => {
    // Enabled first, then product order: 浏览器 → 文档 → 表格 → PDF.
    void revision;
    const items = pluginState.list();
    return [...items].sort((left, right) => {
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
      const byOrder =
        rankById(ARTIFACT_PLUGIN_DISPLAY_ORDER, left.id) -
        rankById(ARTIFACT_PLUGIN_DISPLAY_ORDER, right.id);
      if (byOrder !== 0) return byOrder;
      return left.id.localeCompare(right.id);
    });
  }, [pluginState, revision]);
  const selectedPlugin = selectedPluginId
    ? pluginState.get(selectedPluginId)
    : undefined;

  const setPluginEnabled = async (pluginId: string, enabled: boolean) => {
    if (!props.client) return;
    setMutationError(false);
    try {
      await pluginState.setPluginEnabled(pluginId, enabled, async () => {
        await props.client?.setArtifactPluginEnabled(
          props.workspaceId,
          pluginId,
          enabled,
        );
      });
    } catch {
      setMutationError(true);
    }
  };

  const closePluginDetail = () => {
    setSelectedPluginId(null);
  };

  const openPlugin = (pluginId: string) => {
    setSelectedPluginId(pluginId);
  };

  const connectCopy =
    selectedPlugin != null
      ? getArtifactPluginConnectCopy(selectedPlugin)
      : null;
  const primarySkillId =
    selectedPlugin?.skills.find((s) => s.id === selectedPlugin.id)?.id ??
    selectedPlugin?.skills[0]?.id ??
    selectedPlugin?.id ??
    "";

  const cards =
    loading || loadError || plugins.length === 0
      ? null
      : plugins.map((plugin) => {
          const copy = getArtifactPluginConnectCopy(plugin);
          const skillId =
            plugin.skills.find((s) => s.id === plugin.id)?.id ??
            plugin.skills[0]?.id ??
            plugin.id;
          const tryPrompt = copy.prompts[0] ?? copy.longDescription ?? plugin.id;
          return (
            <ArtifactPluginCard
              key={plugin.id}
              plugin={plugin}
              openLabel={t("plugins.artifact_open")}
              onOpen={() => openPlugin(plugin.id)}
              onTry={
                plugin.enabled && props.onSelectArtifactPrompt
                  ? () => {
                      props.onSelectArtifactPrompt?.({
                        pluginId: plugin.id,
                        skillId,
                        prompt: tryPrompt,
                      });
                    }
                  : undefined
              }
            />
          );
        });

  // Same Feishu-style shell as recommend connectors (dual logo + try-this).
  const detailDialog = (
    <ConnectorConnectDialog
      open={Boolean(selectedPluginId)}
      onOpenChange={(open) => {
        if (!open) closePluginDetail();
      }}
      name={connectCopy?.title ?? t("plugins.artifact_open")}
      description={connectCopy?.longDescription ?? ""}
      serviceIconNode={
        selectedPlugin ? (
          <ArtifactPluginIcon pluginId={selectedPlugin.id} size="sm" />
        ) : null
      }
      connected={Boolean(selectedPlugin?.enabled)}
      connectLabel={t("plugins.artifact_enable_action")}
      onConnect={
        selectedPlugin
          ? () => void setPluginEnabled(selectedPlugin.id, true)
          : undefined
      }
      tryItLabel={t("plugins.connector_try_it")}
      onTryIt={
        selectedPlugin &&
        props.onSelectArtifactPrompt &&
        connectCopy?.prompts[0]
          ? () => {
              props.onSelectArtifactPrompt?.({
                pluginId: selectedPlugin.id,
                skillId: primarySkillId,
                prompt: connectCopy.prompts[0],
              });
              closePluginDetail();
            }
          : undefined
      }
      unbindLabel={t("plugins.artifact_disable_action")}
      onUnbind={
        selectedPlugin
          ? () => void setPluginEnabled(selectedPlugin.id, false)
          : undefined
      }
      tryThisPrompts={connectCopy?.prompts}
      promptsDisabled={
        !props.onSelectArtifactPrompt || !selectedPlugin?.enabled
      }
      onSelectPrompt={
        selectedPlugin && props.onSelectArtifactPrompt
          ? (prompt) => {
              props.onSelectArtifactPrompt?.({
                pluginId: selectedPlugin.id,
                skillId: primarySkillId,
                prompt,
              });
              closePluginDetail();
            }
          : undefined
      }
    />
  );

  // Embedded: cards only into parent 4-col grid (no File tools subtitle).
  if (props.embedded) {
    return (
      <>
        {mutationError ? (
          <div className="col-span-full">
            <NoticeBox tone="error" role="alert">
              {t("plugins.artifact_update_error")}
            </NoticeBox>
          </div>
        ) : null}
        {loading ? (
          <div
            className="col-span-full flex min-h-16 items-center justify-center"
            role="status"
            aria-label={t("plugins.artifact_loading")}
          >
            <LoadingSpinner />
          </div>
        ) : loadError ? (
          <div className="col-span-full">
            <NoticeBox tone="error" role="alert">
              {t("plugins.artifact_load_error")}
            </NoticeBox>
          </div>
        ) : (
          cards
        )}
        {detailDialog}
      </>
    );
  }

  return (
    <section
      className={cn(pluginsLayoutClass.section, pluginsLayoutClass.sectionDivider)}
      aria-labelledby="artifact-plugins-heading"
    >
      <div className={pluginsLayoutClass.sectionHeader}>
        <h2 id="artifact-plugins-heading" className={pluginsLayoutClass.sectionTitle}>
          {t("plugins.artifact_title")}
        </h2>
        <p className={pluginsTextClass.sectionLead}>
          {t("plugins.artifact_description")}
        </p>
      </div>
      {mutationError ? (
        <NoticeBox tone="error" role="alert">
          {t("plugins.artifact_update_error")}
        </NoticeBox>
      ) : null}
      {loading ? (
        <div
          className="flex min-h-16 items-center justify-center"
          role="status"
          aria-label={t("plugins.artifact_loading")}
        >
          <LoadingSpinner />
        </div>
      ) : loadError ? (
        <NoticeBox tone="error" role="alert">
          {t("plugins.artifact_load_error")}
        </NoticeBox>
      ) : plugins.length === 0 ? (
        <EmptyStateBox size="comfortable">{t("plugins.artifact_empty")}</EmptyStateBox>
      ) : (
        <div className={pluginsLayoutClass.artifactCardGrid}>{cards}</div>
      )}
      {detailDialog}
    </section>
  );
}

const COMPUTER_USE_MCP_NAME = "computer-use";
const COMPUTER_USE_MCP_FALLBACK_COMMAND = ["npx", "-y", "@onmyagent/handsfree", "mcp"] as const;

async function resolveComputerUseMcpCommand(entry: McpDirectoryInfo): Promise<string[]> {
  try {
    const command = await window.__ONMYAGENT_ELECTRON__?.invokeDesktop?.(
      "getComputerUseMcpCommand",
    );
    if (
      Array.isArray(command) &&
      command.length > 0 &&
      command.every((part) => typeof part === "string")
    ) {
      return command;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    throw new Error(
      message.trim() || t("extensions.computer_use_helper_unavailable"),
    );
  }
  if (entry.command?.length) return entry.command;
  // Windows must use staged Cua, not HandsFree npx fallback.
  if (
    typeof navigator !== "undefined" &&
    /Windows/i.test(navigator.userAgent)
  ) {
    throw new Error(t("extensions.computer_use_cua_unavailable"));
  }
  return [...COMPUTER_USE_MCP_FALLBACK_COMMAND];
}

function BuiltinExtensionsSection(props: {
  workspaceId: string;
  client?: OnMyAgentServerClient | null;
  /** When true, omit section chrome — parent band provides title (Built-in). */
  embedded?: boolean;
  onSelectArtifactPrompt?: PluginsPageProps["onSelectArtifactPrompt"];
}) {
  const local = useLocal();
  const [revision, setRevision] = useState(0);
  const [detailEntry, setDetailEntry] = useState<McpDirectoryInfo | null>(null);
  const [localProviderBusy, setLocalProviderBusy] = useState(false);
  const [localProviderStatus, setLocalProviderStatus] = useState<string | null>(null);
  const [localProviderError, setLocalProviderError] = useState<string | null>(null);
  const [computerUseConnected, setComputerUseConnected] = useState(false);
  const [computerUseConnecting, setComputerUseConnecting] = useState(false);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
    return () => window.removeEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
  }, []);

  const refreshComputerUseMcp = useCallback(async () => {
    const client = props.client;
    const workspaceId = props.workspaceId.trim();
    if (!client || !workspaceId) {
      setComputerUseConnected(false);
      return;
    }
    try {
      const result = await client.listMcp(workspaceId);
      setComputerUseConnected(
        result.items.some((item) => {
          const name = item.name;
          return (
            name === COMPUTER_USE_MCP_NAME ||
            name === "computer-use-mcp"
          );
        }),
      );
    } catch {
      setComputerUseConnected(false);
    }
  }, [props.client, props.workspaceId]);

  useEffect(() => {
    void refreshComputerUseMcp();
  }, [refreshComputerUseMcp]);

  const connectComputerUseMcp = useCallback(
    async (entry: McpDirectoryInfo) => {
      const client = props.client;
      const workspaceId = props.workspaceId.trim();
      if (!client || !workspaceId) {
        throw new Error(t("extensions.local_provider_server_not_connected"));
      }
      if (!isDesktopRuntime()) {
        throw new Error(t("mcp.desktop_required"));
      }

      setComputerUseConnecting(true);
      try {
        const command = await resolveComputerUseMcpCommand(entry);
        const slug = entry.id ?? getMcpServerName(entry);
        await client.addMcp(workspaceId, {
          name: slug,
          config: {
            type: "local",
            command,
            enabled: true,
          },
        });
        try {
          await client.reloadEngine(workspaceId);
        } catch {
          // Config is already written; user can retry reload from workspace actions.
        }
        setOnMyAgentExtensionEnabled(entry, true);
        setComputerUseConnected(true);
        setRevision((value) => value + 1);
      } finally {
        setComputerUseConnecting(false);
        void refreshComputerUseMcp();
      }
    },
    [props.client, props.workspaceId, refreshComputerUseMcp],
  );

  const installLocalProvider = useCallback(
    async (input: LocalProviderInstallInput) => {
      const client = props.client;
      const workspaceId = props.workspaceId.trim();
      const modelId = input.modelId.trim();
      if (!client || !workspaceId) {
        setLocalProviderError(t("extensions.local_provider_server_not_connected"));
        return;
      }
      if (!modelId) {
        setLocalProviderError(t("extensions.local_provider_model_required"));
        return;
      }

      setLocalProviderBusy(true);
      setLocalProviderStatus(null);
      setLocalProviderError(null);
      try {
        await client.patchConfig(workspaceId, {
          opencode: {
            provider: {
              [input.providerId]: {
                npm: "@ai-sdk/openai-compatible",
                name: input.name,
                options: { baseURL: input.baseURL },
                models: { [modelId]: { name: input.modelName.trim() || modelId } },
              },
            },
          },
        });
        if (input.setDefault) {
          local.setPrefs((previous) => ({
            ...previous,
            defaultModel: { providerID: input.providerId, modelID: modelId },
            modelVariant: null,
          }));
        }
        try {
          await client.reloadEngine(workspaceId);
        } catch {
          // User can retry via refresh; provider block is already written.
        }
        try {
          window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
        } catch {
          // ignore
        }
        setLocalProviderStatus(
          t("extensions.local_provider_added_status", {
            name: input.name,
            modelId,
          }),
        );
      } catch (error) {
        setLocalProviderError(describeInstallError(error));
      } finally {
        setLocalProviderBusy(false);
      }
    },
    [local, props.client, props.workspaceId],
  );

  const extensionConfigCtx = useMemo<ExtensionConfigContext>(
    () => ({
      onmyagentServerClient: props.client ?? null,
      computerUse: {
        connected: computerUseConnected,
        connecting: computerUseConnecting,
        onConnect: () => {
          const entry =
            detailEntry ??
            ONMYAGENT_EXTENSION_CATALOG.find(
              (item) => (item.id ?? item.serverName) === COMPUTER_USE_MCP_NAME,
            ) ??
            null;
          if (!entry) {
            throw new Error(t("mcp.connect_failed"));
          }
          return connectComputerUseMcp(entry);
        },
        onRefresh: () => refreshComputerUseMcp(),
      },
      imageExtension: {
        busy: false,
        status: null,
        error: null,
        envKeyDetected: false,
        onInstall: async () => undefined,
        onTestGenerate: async () => undefined,
      },
      localProvider: {
        busy: localProviderBusy,
        status: localProviderStatus,
        error: localProviderError,
        onInstall: installLocalProvider,
      },
    }),
    [
      computerUseConnected,
      computerUseConnecting,
      connectComputerUseMcp,
      detailEntry,
      installLocalProvider,
      localProviderBusy,
      localProviderError,
      localProviderStatus,
      props.client,
      refreshComputerUseMcp,
    ],
  );

  const entries = useMemo(() => {
    void revision;
    const visible = ONMYAGENT_EXTENSION_CATALOG.filter(
      (entry) => !isOnMyAgentExtensionHidden(entry),
    );
    // Enabled / on first; off / unavailable last. Then product order.
    return [...visible].sort((left, right) => {
      const leftOn = isOnMyAgentExtensionEnabled(left);
      const rightOn = isOnMyAgentExtensionEnabled(right);
      if (leftOn !== rightOn) return leftOn ? -1 : 1;
      const leftId = left.id ?? left.serverName ?? left.name;
      const rightId = right.id ?? right.serverName ?? right.name;
      const byOrder =
        rankById(BUILTIN_EXTENSION_DISPLAY_ORDER, leftId) -
        rankById(BUILTIN_EXTENSION_DISPLAY_ORDER, rightId);
      if (byOrder !== 0) return byOrder;
      return left.name.localeCompare(right.name);
    });
  }, [revision]);

  if (entries.length === 0) return null;

  const detailConfig =
    detailEntry != null
      ? getExtensionConfigSlot(detailEntry, extensionConfigCtx)
      : null;
  const detailEnabled =
    detailEntry != null ? isOnMyAgentExtensionEnabled(detailEntry) : false;
  const detailManifest = detailEntry?.extensionManifest;
  const detailId =
    detailEntry?.id ??
    detailEntry?.serverName ??
    detailEntry?.name ??
    "";
  const detailLongDescription =
    detailManifest?.longDescription?.trim() ||
    detailEntry?.description?.trim() ||
    detailEntry?.name ||
    "";
  const detailTryPrompts =
    detailManifest?.composer?.suggestions?.filter(Boolean) ??
    detailEntry?.suggestedPrompts?.filter(Boolean) ??
    [];

  const cards = entries.map((entry) => {
    const entryId = entry.id ?? entry.serverName ?? entry.name ?? "";
    const tryPrompts =
      entry.extensionManifest?.composer?.suggestions?.filter(Boolean) ??
      entry.suggestedPrompts?.filter(Boolean) ??
      [];
    const tryPrompt =
      tryPrompts[0] ||
      entry.extensionManifest?.composer?.prompt?.trim() ||
      entry.description?.trim() ||
      entry.name;
    return (
      <BuiltinExtensionCard
        key={entryId}
        entry={entry}
        onOpenDetails={() => setDetailEntry(entry)}
        onTry={
          props.onSelectArtifactPrompt
            ? () => {
                props.onSelectArtifactPrompt?.({
                  pluginId: entryId,
                  skillId: entryId,
                  prompt: tryPrompt,
                });
              }
            : undefined
        }
      />
    );
  });

  const detailModal = detailEntry ? (
    <ConnectorConnectDialog
      open
      // Wide shell when embedding the full Computer Use settings card.
      size={detailConfig ? "wide" : "default"}
      onOpenChange={(open) => {
        if (!open) setDetailEntry(null);
      }}
      name={detailEntry.name}
      description={detailLongDescription}
      serviceIconNode={
        <span
          className={cn(
            "flex size-full items-center justify-center rounded-full bg-white",
            extensionIconTileClassName,
          )}
        >
          {extensionIcon(detailEntry, 22)}
        </span>
      }
      connected={detailEnabled}
      connectLabel={t("plugins.artifact_enable_action")}
      onConnect={() => {
        setOnMyAgentExtensionEnabled(detailEntry, true);
        setRevision((v) => v + 1);
      }}
      tryItLabel={t("plugins.connector_try_it")}
      onTryIt={
        props.onSelectArtifactPrompt && detailTryPrompts[0]
          ? () => {
              props.onSelectArtifactPrompt?.({
                pluginId: detailId,
                skillId: detailId,
                prompt: detailTryPrompts[0],
              });
              setDetailEntry(null);
            }
          : props.onSelectArtifactPrompt
            ? () => {
                const prompt =
                  detailManifest?.composer?.prompt?.trim() ||
                  detailLongDescription ||
                  detailEntry.name;
                props.onSelectArtifactPrompt?.({
                  pluginId: detailId,
                  skillId: detailId,
                  prompt,
                });
                setDetailEntry(null);
              }
            : undefined
      }
      unbindLabel={t("plugins.artifact_disable_action")}
      onUnbind={() => {
        setOnMyAgentExtensionEnabled(detailEntry, false);
        setRevision((v) => v + 1);
      }}
      // Keep try-this light when the body is a full settings card.
      tryThisPrompts={detailConfig ? [] : detailTryPrompts}
      promptsDisabled={!props.onSelectArtifactPrompt || !detailEnabled}
      onSelectPrompt={
        props.onSelectArtifactPrompt
          ? (prompt) => {
              props.onSelectArtifactPrompt?.({
                pluginId: detailId,
                skillId: detailId,
                prompt,
              });
              setDetailEntry(null);
            }
          : undefined
      }
      footerNote={
        // Built-ins are already installed — never show third-party preview copy.
        detailEntry.preview && !isBuiltInOnMyAgentExtension(detailEntry)
          ? t("plugins.connector_connect_preview_note")
          : null
      }
    >
      {detailConfig ? (
        detailConfig
      ) : detailManifest?.setup?.instructions ? (
        <p className="text-sm leading-relaxed text-dls-secondary">
          {detailManifest.setup.instructions}
        </p>
      ) : null}
    </ConnectorConnectDialog>
  ) : null;

  // Embedded: only cards (parent owns the continuous 4-col grid).
  if (props.embedded) {
    return (
      <>
        {cards}
        {detailModal}
      </>
    );
  }

  return (
    <section className={pluginsLayoutClass.section}>
      <div className={pluginsLayoutClass.sectionHeader}>
        <h2 className={pluginsLayoutClass.sectionTitle}>
          {t("plugins.builtin_section_title")}
        </h2>
        <p className={pluginsTextClass.sectionLead}>
          {t("plugins.builtin_section_hint")}
        </p>
      </div>
      <div className={pluginsLayoutClass.connectorCardGrid}>{cards}</div>
      {detailModal}
    </section>
  );
}

/**
 * Recommend-style tile: logo + title·dot + bubble/+, 2-line desc.
 * Matches ConnectorStatusCard actions (not Switch).
 * Whole card opens setup / connect detail.
 */
function BuiltinExtensionCard(props: {
  entry: McpDirectoryInfo;
  onOpenDetails: () => void;
  /** When enabled — chat bubble “go try”; falls back to open details. */
  onTry?: () => void;
}) {
  // Bump when extension enablement changes outside this card (detail dialog).
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
    return () => window.removeEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
  }, []);
  void revision;
  const enabled = isOnMyAgentExtensionEnabled(props.entry);
  const description = props.entry.description?.trim() ?? "";

  return (
    <article
      role="button"
      tabIndex={0}
      data-enabled={enabled ? "true" : "false"}
      className={cn(
        connectorTileClassName,
        connectorTileOrderClass(enabled),
        connectorTileEnabledClass(enabled),
      )}
      onClick={props.onOpenDetails}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpenDetails();
        }
      }}
      aria-label={`${props.entry.name}. ${t("plugins.artifact_open")}`}
    >
      <div className={connectorTileHeaderClassName}>
        <IconTile
          size="default"
          shape="xl"
          tone="surface"
          border
          className={cn("overflow-hidden", extensionIconTileClassName)}
        >
          {extensionIcon(props.entry, 18)}
        </IconTile>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
              {props.entry.name}
            </h3>
            {enabled ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                aria-hidden
              />
            ) : null}
          </div>
          <div
            className="shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {enabled ? (
              <button
                type="button"
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-xl",
                  "bg-dls-surface-muted text-dls-text/90",
                  "transition-colors hover:bg-dls-hover hover:text-dls-text",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
                )}
                aria-label={t("plugins.connector_try_it")}
                onClick={() => {
                  if (props.onTry) props.onTry();
                  else props.onOpenDetails();
                }}
              >
                <MessageCircle className="size-4" strokeWidth={2} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-xl",
                  "bg-dls-surface-muted text-dls-text",
                  "shadow-sm ring-1 ring-dls-border/60",
                  "transition-colors hover:bg-dls-hover hover:ring-dls-border",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
                )}
                aria-label={t("plugins.add")}
                onClick={props.onOpenDetails}
              >
                <Plus className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className={connectorTileDescClassName} title={description || undefined}>
        {description || "\u00a0"}
      </p>
      <div className="mt-auto h-0 shrink-0" aria-hidden />
    </article>
  );
}

export function PluginsPage(props: PluginsPageProps) {
  const [filterId, setFilterId] = useState<ConnectorFilterId>("all");

  const showBuiltin = filterId === "all" || filterId === "builtin";
  const showRecommended = filterId === "all" || filterId === "recommended";

  const tryConnectorPrompt = useCallback(
    (pluginId: string) => (prompt: string) => {
      props.onSelectArtifactPrompt?.({
        pluginId,
        skillId: pluginId,
        prompt,
      });
    },
    [props.onSelectArtifactPrompt],
  );

  return (
    <div
      className={pluginsLayoutClass.page}
      data-workspace-id={props.workspaceId}
    >
      {/*
        Market-style layout (same chip strip as experts/skills):
        top filter chips → single scrollable card grid.
      */}
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-6 py-2.5">
        {CONNECTOR_FILTERS.map((filter) => (
          <FilterChip
            key={filter.id}
            label={t(filter.labelKey)}
            selected={filterId === filter.id}
            onClick={() => setFilterId(filter.id)}
            className="mac:titlebar-no-drag"
          />
        ))}
      </div>

      {/* Padding on the scroll surface (skills market pattern) so bottom gap is real. */}
      <div className={cn(pluginsLayoutClass.scrollArea, "px-6 pb-16 pt-1")}>
        <div className={pluginsLayoutClass.connectorCardGrid}>
          {showRecommended
            ? renderRecommendedPluginCards({ onTryPrompt: tryConnectorPrompt })
            : null}
          {showBuiltin ? (
            <>
              <BuiltinExtensionsSection
                workspaceId={props.workspaceId}
                client={props.client}
                onSelectArtifactPrompt={props.onSelectArtifactPrompt}
                embedded
              />
              <ArtifactPluginsCatalog {...props} embedded />
            </>
          ) : null}
        </div>
      </div>

    </div>
  );
}

// Store sub-tab: mine = locally installed, marketplace = full catalog / not installed.
type StoreSubTab = "mine" | "marketplace";

// Skills scanned via OnMyAgent server. Increment refreshKey when switching to
// the Mine tab so the list is re-scanned.
type ScannedSkill = {
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
  origin: LocalSkillOrigin;
  trigger?: string;
  displayNameZh?: string;
  displayNameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
};

const SKILL_SCOPE_META: Record<
  SkillScope,
  { subtitle: string; icon: typeof FileText; order: number }
> = {
  builtin: {
    get subtitle() { return t("store.scope_builtin_desc"); },
    icon: FolderOpen,
    order: 0,
  },
  onmyagent: {
    get subtitle() { return t("store.scope_onmyagent_desc"); },
    icon: FileText,
    order: 1,
  },
  local: {
    get subtitle() { return t("store.scope_local_desc"); },
    icon: Users,
    order: 2,
  },
};

function isSkillScanRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readSkillScanString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeSkillScanResponse(response: unknown, workspaceRoot: string | null | undefined): ScannedSkill[] {
  const records = Array.isArray(response)
    ? response.filter(isSkillScanRecord)
    : isSkillScanRecord(response) && Array.isArray(response.items)
      ? response.items.filter(isSkillScanRecord)
      : [];

  return records.flatMap((entry) => {
    const name = readSkillScanString(entry, "name")?.trim();
    if (!name) return [];
    const description = readSkillScanString(entry, "description") ?? name;
    return [{
      name,
      description,
      path: readSkillScanString(entry, "path") ?? "",
      scope: classifySkillScope(entry, workspaceRoot),
      origin: classifyLocalOrigin(entry),
      trigger: readSkillScanString(entry, "trigger"),
      displayNameZh: readSkillScanString(entry, "displayNameZh"),
      displayNameEn: readSkillScanString(entry, "displayNameEn"),
      descriptionZh: readSkillScanString(entry, "descriptionZh"),
      descriptionEn: readSkillScanString(entry, "descriptionEn"),
    }];
  });
}

function useScannedSkills(
  workspaceId: string | undefined,
  workspaceRoot: string | null | undefined,
  client: OnMyAgentServerClient | null | undefined,
  refreshKey: number,
): { items: ScannedSkill[]; raw: unknown; error: unknown } {
  const [state, setState] = useState<{
    items: ScannedSkill[];
    raw: unknown;
    error: unknown;
  }>({ items: [], raw: null, error: null });

  useEffect(() => {
    let cancelled = false;

    const loadSkills = async () => {
      try {
        const response = isDesktopRuntime()
          ? await listLocalSkills(workspaceRoot || "")
          : client
            ? await client.listSkills(workspaceId || "", {
                includeGlobal: true,
              })
            : { items: [] };

        if (cancelled) return;

        const items = normalizeSkillScanResponse(response, workspaceRoot);

        setState({
          raw: response,
          error: null,
          items,
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            items: [],
            raw: null,
            error:
              err instanceof Error
                ? { message: err.message, stack: err.stack }
                : err,
          });
        }
      }
    };

    if (!workspaceId && !workspaceRoot) {
      setState({
        items: [],
        raw: null,
        error: { message: t("plugins.missing_workspace") },
      });
      return;
    }
    if (!isDesktopRuntime() && !client) {
      setState({ items: [], raw: null, error: { message: t("plugins.missing_client") } });
      return;
    }

    loadSkills();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, workspaceRoot, client, refreshKey]);

  return state;
}

function StoreSubTabs(props: {
  value: StoreSubTab;
  onChange: (value: StoreSubTab) => void;
  items: Array<{ value: StoreSubTab; label: string; count?: number }>;
}) {
  return (
    <SegmentedTabGroup density="filter">
      {props.items.map(({ value, label, count }) => (
        <SegmentedTabButton
          key={value}
          type="button"
          onClick={() => props.onChange(value)}
          active={props.value === value}
          size="compact"
          width="hug"
          className="items-center gap-1.5"
        >
          <span>{label}</span>
          {count !== undefined ? (
            <span className="text-xs text-dls-secondary">{count}</span>
          ) : null}
        </SegmentedTabButton>
      ))}
    </SegmentedTabGroup>
  );
}

export function SkillsPage(props: PluginsPageProps) {
  const [query, setQuery] = useState("");
  const effectiveQuery = props.searchQuery ?? query;
  const [subTab, setSubTab] = useState<StoreSubTab>(
    props.marketOnly ? "marketplace" : "mine",
  );
  // Increment refreshKey when switching to Mine to force a re-scan.
  const [refreshKey, setRefreshKey] = useState(0);

  const {
    items: scannedSkills,
    raw: scannedRaw,
    error: scannedError,
  } = useScannedSkills(
    props.workspaceId,
    props.workspaceRoot,
    props.client,
    refreshKey,
  );
  // Tab switch: every click on Mine re-scans even if already on that tab.
  const handleSubTabChange = (value: StoreSubTab) => {
    if (value === "mine") {
      setRefreshKey((k) => k + 1);
    }
    setSubTab(value);
  };

  const scannedByScope = useMemo(() => {
    const lowered = effectiveQuery.trim().toLowerCase();
    const groups: Record<SkillScope, ScannedSkill[]> = {
      builtin: [],
      onmyagent: [],
      local: [],
    };
    for (const s of scannedSkills) {
      if (lowered) {
        const haystack =
          `${s.name} ${s.description} ${s.trigger ?? ""}`.toLowerCase();
        if (!haystack.includes(lowered)) continue;
      }
      groups[s.scope].push(s);
    }
    return groups;
  }, [scannedSkills, effectiveQuery]);

  const mineCount = scannedSkills.length;
  const activeSubTab = props.marketOnly ? "marketplace" : subTab;

  return (
    <div
      className={pluginsLayoutClass.page}
      data-workspace-id={props.workspaceId}
    >
      <div className={cn(pluginsLayoutClass.scrollArea, "px-6 pb-16 pt-5")}>
        <div className="w-full">
          <div className="space-y-10">
            {!props.marketOnly ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <StoreSubTabs
                  value={subTab}
                  onChange={handleSubTabChange}
                  items={[
                    { value: "mine", label: t("store.my_skills"), count: mineCount },
                    {
                      value: "marketplace",
                      label: t("store.skills_marketplace"),
                    },
                  ]}
                />
                <div className="flex items-center gap-2.5">
                  <InputGroup controlSize="lg" radius="full" tone="surface" className="w-56">
                    <InputGroupAddon align="inline-start">
                      <Search className="size-3.5" />
                    </InputGroupAddon>
                    <InputGroupInput
                      value={query}
                      onChange={(event) => setQuery(event.currentTarget.value)}
                      placeholder={t("store.search_skills")}
                      className="text-sm text-dls-text"
                    />
                  </InputGroup>
                  <Button size="lg">
                    <Upload className="size-3.5" />
                    {t("store.upload")}
                  </Button>
                </div>
              </div>
            ) : null}

            {activeSubTab === "mine" ? (
              <ScannedSkillsView
                scannedByScope={scannedByScope}
                raw={scannedRaw}
                error={scannedError}
                total={scannedSkills.length}
                workspaceId={props.workspaceId}
                workspaceRoot={props.workspaceRoot}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center space-y-2">
                  <ShoppingBag className="size-10 text-dls-secondary" />
                  <div className={pluginsTextClass.sectionTitle}>
                    {t("store.skills_marketplace")}
                  </div>
                  <div className="text-sm text-dls-secondary">
                    {t("common.coming_soon")}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScannedSkillsView(props: {
  scannedByScope: Record<SkillScope, ScannedSkill[]>;
  raw: unknown;
  error: unknown;
  total: number;
  workspaceId?: string;
  workspaceRoot?: string | null;
}) {
  const { builtin, onmyagent, local } = props.scannedByScope;
  const hasAny = builtin.length + onmyagent.length + local.length > 0;

  if (!hasAny) {
    return (
      <>
        <EmptyStateBox size="spacious">
          <div className={pluginsTextClass.emptyTitle}>
            {t("store.no_skills_installed")}
          </div>
          <div className={pluginsTextClass.emptyDescription}>
            {t("store.place_skill_prefix")}{" "}
            <CodeToken tone="muted">
              .opencode/skills/&lt;name&gt;/
            </CodeToken>{" "}
            {t("store.place_skill_suffix")}
          </div>
        </EmptyStateBox>
      </>
    );
  }

  const scopeOrder: SkillScope[] = ["builtin", "onmyagent", "local"];
  const groups = scopeOrder
    .map((scope) => ({ scope, skills: props.scannedByScope[scope] }))
    .filter((g) => g.skills.length > 0);

  return (
    <>
      {groups.map(({ scope, skills }) => (
        <ScannedSkillSection key={scope} scope={scope} skills={skills} />
      ))}
    </>
  );
}

function ScannedSkillSection(props: {
  scope: SkillScope;
  skills: ScannedSkill[];
}) {
  const meta = SKILL_SCOPE_META[props.scope];
  const Icon = meta.icon;

  if (props.scope === "local") {
    return <LocalSkillsSection skills={props.skills} />;
  }

  return (
    <section>
      <div className={pluginsLayoutClass.skillSectionTitle}>
        <Icon className="size-4.5 text-dls-secondary" />
        <span className={pluginsTextClass.featuredTitle}>
          {SKILL_SCOPE_LABELS[props.scope]}
        </span>
        <CountBadge>
          {props.skills.length}
        </CountBadge>
      </div>
      <div className={cn(pluginsLayoutClass.skillSectionDescription, pluginsTextClass.helper)}>
        {meta.subtitle}
      </div>
      <div className={pluginsLayoutClass.cardGrid}>
        {props.skills.map((skill) => (
          <ScannedSkillCard key={skill.path + "/" + skill.name} skill={skill} />
        ))}
      </div>
    </section>
  );
}

const LOCAL_ORIGIN_ORDER: LocalSkillOrigin[] = [
  "all",
  "opencode",
  "claude",
  "agents",
  "codex",
  "cursor",
  "windsurf",
  "imported",
];

function LocalSkillsSection(props: { skills: ScannedSkill[] }) {
  const [activeOrigin, setActiveOrigin] = useState<LocalSkillOrigin>("all");

  const byOrigin = useMemo(() => {
    const groups: Record<LocalSkillOrigin, ScannedSkill[]> = {
      all: [],
      opencode: [],
      claude: [],
      agents: [],
      codex: [],
      cursor: [],
      windsurf: [],
      imported: [],
    };
    for (const s of props.skills) {
      groups.all.push(s);
      if (s.origin !== "all") {
        groups[s.origin].push(s);
      }
    }
    return groups;
  }, [props.skills]);

  const visibleOrigins = LOCAL_ORIGIN_ORDER.filter(
    (o) => byOrigin[o].length > 0,
  );

  const displaySkills = byOrigin[activeOrigin] ?? byOrigin.all;

  return (
    <section>
      <div className={pluginsLayoutClass.skillSectionTitle}>
        <Users className="size-4.5 text-dls-secondary" />
        <span className={pluginsTextClass.featuredTitle}>
          {t("skills.scope_local")}
        </span>
        <CountBadge>
          {props.skills.length}
        </CountBadge>
      </div>
      <div className={cn(pluginsLayoutClass.skillSectionDescription, pluginsTextClass.helper)}>
        {t("store.local_skills_desc")}
      </div>

      {visibleOrigins.length > 1 ? (
        <div className={pluginsLayoutClass.originTabs}>
          {visibleOrigins.map((origin) => (
            <FilterChip
              key={origin}
              selected={activeOrigin === origin}
              onClick={() => setActiveOrigin(origin)}
              label={
                <>
                  {LOCAL_ORIGIN_LABELS[origin]}
                  {origin !== "all" ? (
                    <span className="ml-1 text-xs opacity-70">
                      {byOrigin[origin].length}
                    </span>
                  ) : null}
                </>
              }
            />
          ))}
        </div>
      ) : null}

      <div className={pluginsLayoutClass.cardGrid}>
        {displaySkills.map((skill) => (
          <ScannedSkillCard key={skill.path + "/" + skill.name} skill={skill} />
        ))}
      </div>
    </section>
  );
}

function ScannedSkillCard(props: { skill: ScannedSkill }) {
  const { skill } = props;
  const display = resolveBundledSkillDisplay({
    name: skill.name,
    description: skill.description,
    displayNameZh: skill.displayNameZh,
    displayNameEn: skill.displayNameEn,
    descriptionZh: skill.descriptionZh,
    descriptionEn: skill.descriptionEn,
  });
  const dirPath = skill.path.replace(/[/\\]SKILL\.md$/i, "");
  const scopeLabel = SKILL_SCOPE_LABELS[skill.scope];
  return (
    <PluginStoreCard className="group gap-2" layout="column" title={t("session.plugins_scanned_source_prefix", { path: dirPath })}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={pluginsTextClass.cardTitle}>
            {display.name}
          </div>
          <div className={pluginsTextClass.cardDescriptionClamp}>
            {display.description || display.name}
          </div>
        </div>
        <StatusBadge tone="neutral" shape="soft" size="tiny">
          {scopeLabel}
        </StatusBadge>
      </div>
      {skill.trigger && (
        <div
          className={pluginsTextClass.helper}
          title={skill.trigger}
        >
          {t("session.plugins_scanned_trigger", { trigger: skill.trigger })}
        </div>
      )}
      <div
        className={pluginsTextClass.pathHint}
        title={dirPath}
      >
        📁 {dirPath}
      </div>
    </PluginStoreCard>
  );
}

export function ConnectorsPage(props: PluginsPageProps) {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-dls-background"
      data-workspace-id={props.workspaceId}
    >
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-8 pb-10 pt-7">
          <div className="space-y-6">
            <EmptyStateBox size="spacious">
              <div className={pluginsTextClass.emptyTitle}>
                {t("store.no_connectors_installed")}
              </div>
              <div className={pluginsTextClass.emptyDescription}>
                {t("store.no_connectors_hint")}
              </div>
            </EmptyStateBox>
          </div>
        </div>
      </div>
    </div>
  );
}
