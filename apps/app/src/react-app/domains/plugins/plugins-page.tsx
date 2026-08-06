/** @jsxImportSource react */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Blocks,
  ChevronRight,
  Cloud,
  Database,
  FileText,
  FolderOpen,
  Mail,
  Search,
  ShoppingBag,
  Upload,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CodeToken } from "@/components/ui/code-token";
import { FilterChip, IconTile, SegmentedTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { BadgeDot, CountBadge, StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import {
  hasLobePluginBrandIcon,
  LobePluginBrandIcon,
} from "@/react-app/design-system/lobe-brand-icons";
import type { OnMyAgentServerClient } from "@/app/lib/onmyagent-server";
import { listLocalSkills } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import {
  getMcpServerName,
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
  connectorTileFooterClassName,
  connectorTileHeaderClassName,
  connectorTileOrderClass,
} from "./connector-tile";
import {
  loadArtifactPluginCatalog,
  loadArtifactPluginDetail,
  type ArtifactPluginDetail as ArtifactPluginDetailModel,
} from "./artifact-plugin-client";
import {
  ArtifactPluginDetail,
  type ArtifactPluginDetailLabels,
} from "./artifact-plugin-detail";
import { createArtifactPluginState } from "./artifact-plugin-state";
import { OfficeCliPluginCard } from "./officecli-plugin";
import { ExtensionDetailModal } from "@/react-app/design-system/extension-detail-modal";
import {
  getExtensionConfigSlot,
  hasExtensionConfig,
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

type PluginCategory =
  | "commerce"
  | "productivity"
  | "social"
  | "communication"
  | "developer";

type PluginItem = {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  iconKey: string;
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

/** Coming-soon / recommend catalog can stay denser. */
const PLUGIN_CARD_GRID =
  "grid auto-rows-fr grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

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
  "onmyagent-voice",
] as const;

function rankById(order: readonly string[], id: string): number {
  const index = order.indexOf(id);
  return index === -1 ? order.length : index;
}

const pluginsLayoutClass = {
  page: "flex h-full min-h-0 flex-col bg-dls-background",
  scrollArea: "flex min-h-0 flex-1 overflow-y-auto",
  // Match expert/skills: no max-w-6xl so side gutters match px-6 only.
  pageContainer: "w-full px-6 pb-10 pt-5",
  pluginPageContainer: "w-full space-y-8 px-6 pb-10 pt-5",
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

function getSamplePlugins(): PluginItem[] {
  // Recommended catalog: keep Feishu only for now.
  return [
    {
      id: "feishu",
      name: t("session.plugins_name_feishu"),
      description: t("session.plugins_desc_feishu"),
      category: "communication",
      iconKey: "feishu",
    },
  ];
}

const CONNECTOR_ICON_SRC: Partial<Record<string, string>> = {
  "tencent-docs": "/connector-icons/tencent-docs.png",
  "tencent-meeting": "/connector-icons/tencent-meeting.png",
  wecom: "/connector-icons/wecom.png",
  "tencent-questionnaire": "/connector-icons/tencent-questionnaire.png",
  wps: "/connector-icons/wps.png",
  github: "/connector-icons/github.png",
  feishu: "/connector-icons/feishu.png",
  "netease-mail": "/connector-icons/netease-mail.png",
  "baidu-drive": "/connector-icons/baidu-drive.png",
};

function PluginLogoLobeOrFallback(props: {
  iconKey: string;
  className?: string;
  shared: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={cn(props.shared, "bg-dls-surface-muted text-dls-text", props.className)}>
        <Blocks className="size-5" aria-hidden />
      </div>
    );
  }
  return (
    <div className={cn(props.shared, "bg-dls-surface p-1.5", props.className)}>
      <LobePluginBrandIcon
        iconKey={props.iconKey}
        className="size-7"
        onFailed={() => setFailed(true)}
      />
    </div>
  );
}

function PluginLogo(props: { iconKey: string; className?: string }) {
  // size-9 matches connector tile header (IconTile default / ArtifactPluginIcon sm).
  const shared =
    "flex size-9 shrink-0 items-center justify-center rounded-xl border border-black/5";
  const uploadedIconSrc = CONNECTOR_ICON_SRC[props.iconKey];
  if (uploadedIconSrc) {
    return (
      <div className={cn(shared, "bg-dls-surface p-1.5", props.className)}>
        <img
          src={resolvePublicAssetUrl(uploadedIconSrc)}
          alt=""
          className="size-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  // Lobe brand marks for connectors we no longer hand-draw (Notion / M365 / GH / …).
  if (hasLobePluginBrandIcon(props.iconKey)) {
    return (
      <PluginLogoLobeOrFallback
        iconKey={props.iconKey}
        className={props.className}
        shared={shared}
      />
    );
  }

  switch (props.iconKey) {
    case "wordpress":
      return (
        <div className={cn(shared, "bg-dls-surface text-dls-text", props.className)}>
          <BadgeDot tone="currentOutline" size="logo" className="border-2 font-semibold">
            W
          </BadgeDot>
        </div>
      );
    case "yuque":
      return (
        <div
          className={cn(shared, "bg-dls-surface text-transparent", props.className)}
        >
          <div className="relative size-8">
            <div className="absolute inset-0 rounded-lg bg-dls-plugin-gradient [clip-path:polygon(0_70%,34%_25%,58%_25%,33%_75%)]" />
            <div className="absolute inset-0 rounded-lg bg-dls-plugin-gradient [clip-path:polygon(36%_24%,88%_24%,56%_73%,20%_73%)] opacity-90" />
          </div>
        </div>
      );
    case "x":
      return (
        <div className={cn(shared, "bg-dls-surface text-black", props.className)}>
          <span className="text-2xl font-semibold tracking-[-0.06em]">
            X
          </span>
        </div>
      );
    case "linkedin":
      return (
        <div className={cn(shared, "bg-dls-brand-linkedin text-white", props.className)}>
          <span className="text-xl font-semibold">in</span>
        </div>
      );
    case "gmail":
      return (
        <div className={cn(shared, "bg-dls-surface", props.className)}>
          <Mail className="size-6 text-dls-brand-gmail" />
        </div>
      );
    case "instagram":
      return (
        <div
          className={cn(
            shared,
            "bg-dls-instagram-gradient text-white",
            props.className,
          )}
        >
          <div className="flex size-7 items-center justify-center rounded-lg border-2 border-current">
            <div className="relative size-3.5 rounded-full border-2 border-current">
              <span className="absolute right-[-1px] top-[-1px] size-1.5 rounded-full bg-current" />
            </div>
          </div>
        </div>
      );
    case "supabase":
      return (
        <div
          className={cn(shared, "bg-dls-brand-notion text-dls-brand-vercel", props.className)}
        >
          <Database className="size-6" />
        </div>
      );
    case "cloudflare":
      return (
        <div className={cn(shared, "bg-dls-surface text-dls-brand-cloudflare", props.className)}>
          <Cloud className="size-6" />
        </div>
      );
    case "vercel":
      return (
        <div className={cn(shared, "bg-black text-white", props.className)}>
          <div className="size-0 border-x-[10px] border-b-[18px] border-x-transparent border-b-white" />
        </div>
      );
    case "huggingface":
      return (
        <div
          className={cn(shared, "bg-dls-brand-replit-bg text-dls-brand-replit-fg", props.className)}
        >
          <span className="text-2xl">🤗</span>
        </div>
      );
    case "higgsfield":
      return (
        <div className={cn(shared, "bg-dls-signal text-black", props.className)}>
          <span className="text-2xl font-semibold tracking-[-0.08em]">
            ∞
          </span>
        </div>
      );
    case "clarity":
      return (
        <div
          className={cn(shared, "bg-dls-brand-web-soft text-dls-brand-web-fg", props.className)}
        >
          <div className="size-0 border-x-[12px] border-b-[20px] border-x-transparent border-b-current opacity-90" />
        </div>
      );
    case "calendar":
      return (
        <div className={cn(shared, "bg-dls-surface text-dls-brand-google-text", props.className)}>
          <div className="overflow-hidden rounded-lg border border-dls-brand-google-border">
            <div className="bg-dls-brand-drive px-2 py-0.5 text-xs font-medium text-white">
              31
            </div>
            <div className="bg-dls-surface px-2 py-1 text-xs font-medium">
              {t("session.plugins_calendar_label")}
            </div>
          </div>
        </div>
      );
    case "youtube":
      return (
        <div className={cn(shared, "bg-dls-surface text-dls-brand-linear", props.className)}>
          <div className="flex h-6 w-9 items-center justify-center rounded-md bg-current">
            <div className="ml-0.5 size-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
          </div>
        </div>
      );
    case "drive":
      return (
        <div className={cn(shared, "bg-dls-surface", props.className)}>
          <div className="relative size-7">
            <span className="absolute left-0 top-2 size-0 border-l-[8px] border-r-[8px] border-b-[14px] border-l-transparent border-r-transparent border-b-[#34a853]" />
            <span className="absolute right-0 top-2 size-0 border-l-[8px] border-r-[8px] border-b-[14px] border-l-transparent border-r-transparent border-b-[#4285f4]" />
            <span className="absolute left-[6px] top-0 size-0 border-l-[8px] border-r-[8px] border-b-[14px] border-l-transparent border-r-transparent border-b-[#fbbc04]" />
          </div>
        </div>
      );
    case "cafe24":
      return (
        <div
          className={cn(shared, "bg-dls-brand-zapier-soft text-dls-secondary", props.className)}
        >
          <span className="text-xs font-semibold tracking-[-0.03em]">
            cafe24
          </span>
        </div>
      );
    case "coupang":
      return (
        <div
          className={cn(shared, "bg-dls-brand-aws-soft text-dls-brand-aws-fg", props.className)}
        >
          <span className="text-xs font-semibold tracking-[-0.03em]">
            coupang
          </span>
        </div>
      );
    case "kakao":
      return (
        <div
          className={cn(shared, "bg-dls-brand-figma-yellow text-dls-brand-coupang", props.className)}
        >
          <div className="flex flex-col items-center text-xs font-bold leading-none">
            <span>TALK</span>
          </div>
        </div>
      );
    case "line":
      return (
        <div className={cn(shared, "bg-dls-brand-figma-green text-white", props.className)}>
          <span className="text-xs font-bold">LINE</span>
        </div>
      );
    case "reddit":
      return (
        <div
          className={cn(shared, "bg-dls-brand-orange-soft text-dls-brand-orange-fg", props.className)}
        >
          <span className="text-xl">⭘</span>
        </div>
      );
    case "tiktok":
      return (
        <div className={cn(shared, "bg-dls-surface text-dls-text", props.className)}>
          <span className="text-2xl font-black">♪</span>
        </div>
      );
    case "odoo":
      return (
        <div
          className={cn(shared, "bg-dls-brand-lovable-soft text-dls-brand-lovable-fg", props.className)}
        >
          <span className="text-base font-semibold">odoo</span>
        </div>
      );
    case "shopify":
      return (
        <div
          className={cn(shared, "bg-dls-status-success-soft text-dls-brand-raycast", props.className)}
        >
          <span className="text-2xl font-bold">S</span>
        </div>
      );
    case "shopline":
      return (
        <div className={cn(shared, "bg-dls-surface text-dls-secondary", props.className)}>
          <span className="text-xl font-bold">◔</span>
        </div>
      );
    default:
      return (
        <div
          className={cn(shared, "bg-dls-surface-muted text-dls-text", props.className)}
        >
          <Blocks className="size-5" />
        </div>
      );
  }
}

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

function PluginCard(props: { item: PluginItem }) {
  // Preview-only under Recommended — same size recipe, no interactive hover/cursor.
  return (
    <div
      className={cn(
        connectorTileClassName,
        "cursor-default border-dashed border-dls-border/60 bg-dls-surface/50 shadow-none",
        "hover:border-dls-border/60 hover:bg-dls-surface/50 hover:shadow-none",
        "dark:hover:border-dls-border/60 dark:hover:bg-dls-surface/50 dark:hover:shadow-none",
      )}
    >
      <div className={connectorTileHeaderClassName}>
        <PluginLogo iconKey={props.item.iconKey} className="size-9 rounded-xl" />
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className={cn(pluginsTextClass.featuredTitle, "min-w-0 font-semibold")}>
            {props.item.name}
          </div>
          <StatusBadge tone="neutral" size="tiny" className="shrink-0">
            {t("plugins.recommend_badge")}
          </StatusBadge>
        </div>
      </div>
      <p className={connectorTileDescClassName} title={props.item.description}>
        {props.item.description || "\u00a0"}
      </p>
      {/* Spacer matches View details footer on built-in cards. */}
      <div className={connectorTileFooterClassName} aria-hidden />
    </div>
  );
}

function artifactPluginLabels(): ArtifactPluginDetailLabels {
  return {
    pluginEnabled: t("plugins.artifact_plugin_toggle"),
    skillEnabled: (name) => t("plugins.artifact_skill_toggle", { name }),
    starterPrompts: t("plugins.artifact_starter_prompts"),
    skills: t("plugins.artifact_skills"),
    unavailable: t("plugins.artifact_excel_unavailable"),
    enabled: t("plugins.artifact_enabled"),
    disabled: t("plugins.artifact_disabled"),
  };
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
  const [selectedDetail, setSelectedDetail] = useState<ArtifactPluginDetailModel | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

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
  const selectedPlugin = selectedPluginId ? pluginState.get(selectedPluginId) : undefined;
  const labels = artifactPluginLabels();

  const setPluginEnabled = async (pluginId: string, enabled: boolean) => {
    if (!props.client) return;
    setMutationError(false);
    try {
      await pluginState.setPluginEnabled(pluginId, enabled, async () => {
        await props.client?.setArtifactPluginEnabled(props.workspaceId, pluginId, enabled);
      });
    } catch {
      setMutationError(true);
    }
  };

  const setSkillEnabled = async (pluginId: string, skillId: string, enabled: boolean) => {
    if (!props.client) return;
    setMutationError(false);
    try {
      await pluginState.setSkillEnabled(pluginId, skillId, enabled, async () => {
        await props.client?.setArtifactPluginSkillEnabled(
          props.workspaceId,
          pluginId,
          skillId,
          enabled,
        );
      });
    } catch {
      setMutationError(true);
    }
  };

  const closePluginDetail = () => {
    setSelectedPluginId(null);
    setSelectedDetail(null);
    setDetailLoading(false);
    setDetailError(false);
  };

  const openPlugin = async (pluginId: string) => {
    if (!props.client) return;
    setSelectedPluginId(pluginId);
    setSelectedDetail(null);
    setDetailLoading(true);
    setDetailError(false);
    try {
      const detail = await loadArtifactPluginDetail(props.client, props.workspaceId, pluginId);
      setSelectedDetail(detail);
    } catch {
      setDetailError(true);
    } finally {
      setDetailLoading(false);
    }
  };

  const detailTitle =
    selectedPlugin?.id === "browser"
      ? t("plugins.artifact_plugin_browser_name")
      : selectedPlugin?.manifest.interface.displayName
        ?? selectedDetail?.manifest.interface.displayName
        ?? t("plugins.artifact_open");

  const detailDescription =
    selectedDetail?.manifest.interface.longDescription
    ?? selectedPlugin?.manifest.interface.shortDescription
    ?? t("plugins.artifact_detail_loading");

  const cards =
    loading || loadError || plugins.length === 0
      ? null
      : plugins.map((plugin) => (
          <ArtifactPluginCard
            key={plugin.id}
            plugin={plugin}
            openLabel={t("plugins.artifact_open")}
            toggleLabel={t("plugins.artifact_card_toggle", {
              name: plugin.manifest.interface.displayName,
            })}
            onOpen={() => void openPlugin(plugin.id)}
            onEnabledChange={(enabled) => setPluginEnabled(plugin.id, enabled)}
          />
        ));

  const detailDialog = (
    <Dialog
      open={Boolean(selectedPluginId)}
      onOpenChange={(open) => {
        if (!open) closePluginDetail();
      }}
    >
      <DialogContent
        className="flex max-h-[min(88vh,40rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{detailTitle}</DialogTitle>
          <DialogDescription>{detailDescription}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 pr-12">
          {detailLoading ? (
            <div
              className="flex min-h-32 items-center justify-center"
              role="status"
              aria-label={t("plugins.artifact_detail_loading")}
            >
              <LoadingSpinner />
            </div>
          ) : detailError ? (
            <NoticeBox tone="error" role="alert">
              {t("plugins.artifact_load_error")}
            </NoticeBox>
          ) : selectedPlugin && selectedDetail ? (
            <ArtifactPluginDetail
              plugin={{ ...selectedPlugin, connection: selectedDetail.connection }}
              labels={labels}
              onSelectPrompt={(pluginId, skillId, prompt) => {
                props.onSelectArtifactPrompt?.({ pluginId, skillId, prompt });
                closePluginDetail();
              }}
              starterPromptsDisabled={!props.onSelectArtifactPrompt}
              onPluginEnabledChange={(enabled) => setPluginEnabled(selectedPlugin.id, enabled)}
              onSkillEnabledChange={(skillId, enabled) =>
                setSkillEnabled(selectedPlugin.id, skillId, enabled)
              }
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
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
      voiceExtension: {
        busy: false,
        status: null,
        error: null,
        envKeyDetected: false,
        onSaveApiKey: async () => undefined,
        onTestSession: async () => undefined,
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

  const cards = entries.map((entry) => (
    <BuiltinExtensionCard
      key={entry.id ?? entry.serverName ?? entry.name}
      entry={entry}
      onOpenDetails={() => setDetailEntry(entry)}
    />
  ));

  const detailModal = detailEntry ? (
    <ExtensionDetailModal
      open
      onClose={() => setDetailEntry(null)}
      name={detailEntry.name}
      description={detailEntry.description?.trim() || detailEntry.name}
      kind="extension"
      preview={detailEntry.preview === true}
      connected={detailEnabled}
      connectedLabel={t("plugins.artifact_enabled")}
      disconnectedLabel={t("plugins.artifact_disabled")}
      setupInstructions={
        detailConfig
          ? undefined
          : detailEntry.extensionManifest?.setup?.instructions
      }
      showEnablementCard={false}
      showDetailsCard={!detailConfig}
      size="wide"
      configSlot={detailConfig}
    />
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
 * Match ArtifactPluginCard chrome: icon + title + switch, description,
 * and “View details” when a settings panel is registered (e.g. BrowserSkill).
 */
function BuiltinExtensionCard(props: {
  entry: McpDirectoryInfo;
  onOpenDetails: () => void;
}) {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
    return () => window.removeEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
  }, []);
  const enabled = isOnMyAgentExtensionEnabled(props.entry);
  const description = props.entry.description?.trim() ?? "";
  const canOpenDetails = hasExtensionConfig(props.entry);

  const openDetails = canOpenDetails ? props.onOpenDetails : undefined;

  return (
    <article
      role={openDetails ? "button" : undefined}
      tabIndex={openDetails ? 0 : undefined}
      data-enabled={enabled ? "true" : "false"}
      className={cn(
        connectorTileClassName,
        connectorTileOrderClass(enabled),
        connectorTileEnabledClass(enabled),
        // No detail panel: keep hover lift but default cursor (switch still works).
        !openDetails && "cursor-default",
      )}
      onClick={openDetails}
      onKeyDown={
        openDetails
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openDetails();
              }
            }
          : undefined
      }
      aria-label={
        openDetails
          ? `${props.entry.name}. ${t("plugins.artifact_open")}`
          : props.entry.name
      }
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
          <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
            {props.entry.name}
          </h3>
          <div
            className="shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Switch
              checked={enabled}
              onCheckedChange={(next) => {
                setOnMyAgentExtensionEnabled(props.entry, next);
                setRevision((value) => value + 1);
              }}
              aria-label={props.entry.name}
            />
          </div>
        </div>
      </div>
      <p className={connectorTileDescClassName} title={description || undefined}>
        {description || "\u00a0"}
      </p>
      <div className={connectorTileFooterClassName}>
        {canOpenDetails ? (
          <span className="inline-flex items-center gap-0.5 text-xs text-dls-secondary transition-colors group-hover:text-dls-text">
            {t("plugins.artifact_open")}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-xs leading-5 text-transparent" aria-hidden>
            {t("plugins.artifact_open")}
            <ChevronRight className="size-3.5" />
          </span>
        )}
      </div>
    </article>
  );
}

export function PluginsPage(props: PluginsPageProps) {
  const samplePlugins = useMemo(() => getSamplePlugins(), []);

  return (
    <div
      className={pluginsLayoutClass.page}
      data-workspace-id={props.workspaceId}
    >
      <div className={pluginsLayoutClass.scrollArea}>
        {/*
          Two bands:
          1) Built-in — product extensions + file tools
          2) Recommended — OfficeCLI (installable) + third-party preview catalog
        */}
        <div className={cn(pluginsLayoutClass.pluginPageContainer, "space-y-10")}>
          <section
            className={pluginsLayoutClass.section}
            aria-labelledby="connectors-builtin-heading"
          >
            <div className={pluginsLayoutClass.sectionHeader}>
              <h2
                id="connectors-builtin-heading"
                className={pluginsLayoutClass.sectionTitle}
              >
                {t("plugins.builtin_section_title")}
              </h2>
              <p className={pluginsTextClass.sectionLead}>
                {t("plugins.builtin_section_hint")}
              </p>
            </div>
            {/* One continuous 4-col grid: product extensions + file tools, no sub-titles. */}
            <div className={pluginsLayoutClass.connectorCardGrid}>
              <BuiltinExtensionsSection
                workspaceId={props.workspaceId}
                client={props.client}
                embedded
              />
              <ArtifactPluginsCatalog {...props} embedded />
            </div>
          </section>

          <section
            className={cn(pluginsLayoutClass.section, pluginsLayoutClass.sectionDivider)}
            aria-labelledby="connectors-recommend-heading"
          >
            <div className={pluginsLayoutClass.sectionHeader}>
              <h2
                id="connectors-recommend-heading"
                className={pluginsLayoutClass.sectionTitle}
              >
                {t("plugins.sample_section_title")}
              </h2>
              <p className={pluginsTextClass.sectionLead}>
                {t("plugins.sample_section_hint")}
              </p>
            </div>
            <div className={pluginsLayoutClass.connectorCardGrid}>
              <OfficeCliPluginCard />
              {samplePlugins.map((item) => (
                <PluginCard key={item.id} item={item} />
              ))}
            </div>
          </section>
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
      <div className={pluginsLayoutClass.scrollArea}>
        <div className={pluginsLayoutClass.pageContainer}>
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
