import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { AlertCircle, CheckCircle2, Loader2, Plug2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { t } from "../../i18n";
import { APP_NAME } from "../../i18n/locales/brand";
import type { ExtensionKind } from "../../app/constants";
import type { EnablementResult } from "../../app/extensions";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveExtensionIconSrc } from "./extension-icon-src";
import { ExtensionMeshAvatar } from "./extension-mesh-avatar";

export type ExtensionCardProps = {
  name: string;
  description: string;
  /** Simple Icons slug for brand icon. When set, loads from CDN. */
  iconSlug?: string;
  /** Direct icon URL (e.g. local SVG). Takes priority over iconSlug. */
  iconSrc?: string;
  /** Lucide icon fallback when no iconSlug or iconSrc is provided. */
  fallbackIcon?: LucideIcon;
  /** Extension category badge. */
  kind?: ExtensionKind;
  /** Whether the extension is already installed/connected. */
  connected?: boolean;
  connectedLabel?: string;
  /** Per-condition enablement results. When provided, overrides `connected`. */
  enablement?: EnablementResult[];
  /** Whether a connect operation is in progress. */
  connecting?: boolean;
  /** Whether interaction is disabled. */
  disabled?: boolean;
  /** Whether this item is hidden from the normal catalog view. */
  hidden?: boolean;
  /** Whether this extension is still in preview. */
  preview?: boolean;
  /** Reason this item is visible but unavailable. */
  disabledReason?: string | null;
  /** Action label shown at bottom. */
  actionLabel?: string;
  /** Click handler. */
  onClick?: () => void;
};

const kindLabel: Record<ExtensionKind, string> = {
  mcp: "MCP",
  plugin: "Plugin",
  skill: "Skill",
  "ui-control": "UI Control",
  extension: `${APP_NAME} Extension`,
};

const kindStyle: Record<ExtensionKind, string> = {
  mcp: "bg-dls-hover text-dls-secondary",
  plugin: "bg-violet-3 text-violet-11",
  skill: "bg-amber-3 text-amber-11",
  "ui-control": "bg-blue-3 text-blue-11",
  extension: "bg-teal-3 text-teal-11",
};

const extensionCardClass = {
  row: "group transition-all",
  connected: "border-dls-status-success-border bg-dls-status-success-soft",
  partial: "border-dls-status-warning bg-dls-status-warning-soft",
  idle: "hover:bg-dls-hover",
  hidden: "border-dashed opacity-70",
  body: "flex items-start gap-3",
  iconWrap: "relative shrink-0",
  meshAvatar: "size-7 rounded-md text-xs font-medium",
  statusDot: "absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border-2 border-dls-surface",
  content: "min-w-0 flex-1",
  titleRow: "flex flex-wrap items-center gap-1.5",
  title: "min-w-0 break-words text-sm font-medium text-dls-text",
  description: "mt-0.5 line-clamp-2 text-xs text-dls-secondary",
  disabledReason: "mt-2 text-xs font-medium text-dls-status-warning",
  action: "mt-2 text-xs font-medium text-dls-text transition-colors group-hover:opacity-80",
};

/**
 * A reusable card for displaying an extension (MCP server, plugin, or skill)
 * in the extensions directory. Supports brand icons from Simple Icons CDN,
 * Lucide icon fallbacks, kind badges, and connected/connecting states.
 */
export function ExtensionCard(props: ExtensionCardProps) {
  const {
    name,
    description,
    iconSlug,
    iconSrc,
    fallbackIcon: FallbackIcon = Plug2,
    kind = "mcp",
    connected: connectedProp = false,
    connectedLabel = t("extensions.connected"),
    enablement,
    connecting = false,
    disabled = false,
    hidden = false,
    preview = false,
    disabledReason = null,
    actionLabel,
    onClick,
  } = props;

  // When enablement results are provided, derive connected + partial state from them.
  const allMet = enablement ? enablement.every((r) => r.met) : connectedProp;
  const someMet = enablement ? enablement.some((r) => r.met) && !allMet : false;
  const connected = allMet;
  const resolvedIconSrc = iconSrc
    ? resolveExtensionIconSrc(iconSrc)
    : undefined;

  return (
    <ActionRowButton
      density="card"
      type="button"
      disabled={disabled || connecting}
      onClick={onClick}
      className={`${extensionCardClass.row} ${
        connected
          ? extensionCardClass.connected
          : someMet
            ? extensionCardClass.partial
            : extensionCardClass.idle
      } ${hidden ? extensionCardClass.hidden : ""}`}
    >
      <div className={extensionCardClass.body}>
        {/* Icon */}
        <div className={extensionCardClass.iconWrap}>
          <IconTile
            size="md"
            shape="lg"
            border
            className={
              connected
                ? extensionCardClass.connected
                : someMet
                  ? extensionCardClass.partial
                  : undefined
            }
          >
            {connecting ? (
              <LoadingSpinner size="default" className="text-dls-secondary" />
            ) : resolvedIconSrc ? (
              <img
                src={resolvedIconSrc}
                alt=""
                width={16}
                height={16}
                loading="lazy"
                style={{ display: "block" }}
              />
            ) : iconSlug ? (
              <img
                src={`https://cdn.simpleicons.org/${iconSlug}`}
                alt=""
                width={16}
                height={16}
                loading="lazy"
                style={{ display: "block" }}
              />
            ) : kind === "plugin" || kind === "skill" ? (
              <ExtensionMeshAvatar
                name={name}
                className={extensionCardClass.meshAvatar}
              />
            ) : (
              <FallbackIcon size={16} className="text-dls-secondary" />
            )}
          </IconTile>
          {connected ? (
            <div className={`${extensionCardClass.statusDot} bg-dls-status-success-fg`}>
              <CheckCircle2 size={12} className="text-white" strokeWidth={3} />
            </div>
          ) : someMet ? (
            <div className={`${extensionCardClass.statusDot} bg-dls-status-warning`}>
              <AlertCircle size={12} className="text-white" strokeWidth={3} />
            </div>
          ) : null}
        </div>

        {/* Content */}
        <div className={extensionCardClass.content}>
          <div className={extensionCardClass.titleRow}>
            <h4 className={extensionCardClass.title}>
              {name}
            </h4>
            {connected ? (
              <StatusBadge shape="soft" size="tiny" tone="success">
                {connectedLabel}
              </StatusBadge>
            ) : someMet ? (
              <StatusBadge shape="soft" size="tiny" tone="warning">
                {t("extensions.partially_set_up")}
              </StatusBadge>
            ) : (
              <StatusBadge shape="soft" size="tiny" className={kindStyle[kind]}>
                {kindLabel[kind]}
              </StatusBadge>
            )}
            {hidden ? (
              <StatusBadge shape="soft" size="tiny" tone="neutral">
                {t("extensions.hidden")}
              </StatusBadge>
            ) : null}
            {preview ? (
              <StatusBadge shape="soft" size="tiny" tone="accent">
                {t("extensions.preview")}
              </StatusBadge>
            ) : null}
            {disabledReason ? (
              <StatusBadge shape="soft" size="tiny" tone="warning">
                {t("extensions.disabled")}
              </StatusBadge>
            ) : null}
          </div>
          <p className={extensionCardClass.description}>
            {description}
          </p>
          {disabledReason ? (
            <div className={extensionCardClass.disabledReason}>
              {disabledReason}
            </div>
          ) : null}
          {!disabledReason && !connecting && actionLabel ? (
            <div className={extensionCardClass.action}>
              {actionLabel}
            </div>
          ) : null}
        </div>
      </div>
    </ActionRowButton>
  );
}
