/** @jsxImportSource react */
/** Pure helpers, types, and styles for the session composer (mechanical extract). */
import type { ComponentType, ReactNode } from "react";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { ClipboardList, MessageCircle, Plug, Rocket, Target } from "lucide-react";
import type { McpDirectoryInfo } from "../../../../../app/constants";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import type { StatusBadgeTone } from "@/components/ui/status-badge";
import type { CloudImportedPlugin, CloudImportedPluginFile } from "../../../../../app/cloud/import-state";
import type {
  ComposerAccessMode,
  ComposerAttachment,
  ComposerCollaborationMode,
  McpServerEntry,
  McpStatusMap,
  ModelRef,
  SkillCard,
  SlashCommandOption,
} from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { isOnMyAgentExtensionEnabled } from "../../../shared";
import {
  collaborationModeOptionKeys,
  type CollaborationModeOptionKey,
} from "./tool-menu-model";
import type { ReactComposerNotice as ReactComposerNoticeData } from "./notice";

export type MentionItem = {
  id: string;
  kind: "agent" | "file";
  value: string;
  label: string;
};

export type PastedTextChip = {
  id: string;
  label: string;
  text: string;
  lines: number;
};

export type ToolMenuSettingsSection = "commands" | "skills" | "mcps" | "plugins";
export type ToolMenuSection = "files" | "templates" | "modes" | "skills" | "mcps";
export type ComposerPromptTemplate = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  prompts: string[];
};
export type CollaborationModeOption = {
  key: CollaborationModeOptionKey;
  label: string;
  description: string;
  Icon: typeof Rocket;
};
export const composerTextClass = {
  sourceBadge: "bg-dls-accent/10 text-dls-accent",
  commandBadge: "bg-dls-signal/15 text-dls-text",
  modelUnavailable:
    "inline-flex max-w-48 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-dls-status-danger-fg hover:bg-dls-status-danger-soft",
};

export const composerMenuClass = {
  anchor: "absolute bottom-full left-[-1px] right-[-1px] z-30 mb-1.5",
  // Full rounded card so the popup sits above the composer with soft corners all around.
  panel:
    "overflow-hidden rounded-2xl border border-dls-border bg-dls-surface-solid shadow-sm",
  panelWithoutBottomBorder:
    "overflow-hidden rounded-2xl border border-dls-border bg-dls-surface-solid shadow-sm",
  // Grouped 技能 / 指令 list — roomy horizontal padding, compact vertical stack.
  scrollArea: "max-h-72 overflow-y-auto px-1.5 py-2",

  itemIcon: "mt-0.5 shrink-0 text-dls-secondary",
  itemTitle: "truncate text-sm font-medium leading-5 text-dls-text",
  itemMeta: "truncate text-sm leading-5 text-dls-secondary",
  // Neutral muted wash — not blue-tinted dls-hover.
  // Match model chip weight (secondary + soft hover) so + / model sit as peers.
  toolButton: "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
  activeToolButton: "bg-dls-surface-muted text-dls-text",
};

export const EMPTY_COLLABORATION_MODE: ComposerCollaborationMode = {
  planning: false,
  pursueGoal: false,
};

export const DEFAULT_OFFICE_COLLABORATION_MODE: ComposerCollaborationMode = {
  kind: "craft",
  planning: false,
  pursueGoal: false,
};

export function collaborationModeValue(
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

export function selectedCollaborationModeKey(
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

export function collaborationModeOptions(variant: "office" | "legacy"): CollaborationModeOption[] {
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

export function isComposerExtensionAvailable(entry: McpDirectoryInfo) {
  const hasSessionSurface = entry.extensionManifest?.contributions?.some((contribution) =>
    contribution.type === "session-side-panel" || contribution.type === "session-rail-item"
  ) === true;
  if (hasSessionSurface) return isOnMyAgentExtensionEnabled(entry);
  return !entry.defaultEnabled || isOnMyAgentExtensionEnabled(entry);
}

export type ComposerProps = {
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
  /**
   * Draft-home empty state: parent owns max width; strip outer padding so the
   * card aligns with the brand title, and use a denser editor/toolbar.
   */
  homeLayout?: boolean;
  topAccessory?: ReactNode;
  bottomAccessory?: ReactNode;
  hideAccessPermissionSelect?: boolean;
};

export const FLUSH_PROMPT_EVENT = "onmyagent:flushPromptDraft";
export const FOCUS_PROMPT_EVENT = "onmyagent:focusPrompt";
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const IMAGE_COMPRESS_MAX_PX = 2048;
export const IMAGE_COMPRESS_QUALITY = 0.82;
export const IMAGE_COMPRESS_TARGET_BYTES = 1_500_000;
export const FILE_URL_RE = /^file:\/\//i;
export const HTTP_URL_RE = /^https?:\/\//i;

/**
 * Extract external file/URL drops from a clipboard. Only used when the user
 * drag-drops a file reference from another app (Finder / browser), which sets
 * the text/uri-list MIME type explicitly. Plain text pastes — even ones that
 * contain absolute paths like "/Users/..." — are NEVER treated as links here
 * because that intercepted real text pastes and made composer paste feel
 * broken. Plain text goes straight into the editor via Lexical's default.
 */
export function parseClipboardUriList(clipboard: DataTransfer) {
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

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageAttachment(attachment: ComposerAttachment) {
  return attachment.kind === "image" || attachment.mimeType.startsWith("image/");
}

export async function compressImageFile(file: File): Promise<File> {
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

export function formatMcpStatusLabel(status: McpServerStatus | undefined) {
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

export type McpServerStatus = "connected" | "needs_auth" | "needs_client_registration" | "failed" | "disabled" | "disconnected";

export function toReactMcpStatus(name: string, entry: McpServerEntry, statuses: McpStatusMap): McpServerStatus {
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

export function mcpStatusBadgeTone(status: McpServerStatus): StatusBadgeTone {
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

export function mcpServerDescription(entry: McpServerEntry) {
  return entry.config.type === "remote"
    ? entry.config.url ?? entry.config.command?.join(" ") ?? "Remote MCP"
    : entry.config.command?.join(" ") ?? "Local MCP";
}

export const COMPOSER_CONTAIN_STYLE = { contain: "layout style" };

export function extensionIcon(entry: McpDirectoryInfo, size = 16) {
  if (entry.iconSrc) {
    return <img src={resolvePublicAssetUrl(entry.iconSrc)} alt="" width={size} height={size} loading="lazy" className="block" />;
  }
  if (entry.iconSlug) {
    return <img src={`https://cdn.simpleicons.org/${entry.iconSlug}`} alt="" width={size} height={size} loading="lazy" className="block" />;
  }
  return <Plug size={size} className="text-dls-secondary" />;
}

export function pluginSlashCommandName(file: CloudImportedPluginFile) {
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
