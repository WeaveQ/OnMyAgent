/** @jsxImportSource react */
import { MessageCircle, Plus } from "lucide-react";
import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";

import { StatusDot } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { ArtifactPluginIcon } from "./artifact-plugin-detail";
import {
  connectorTileActionClassName,
  connectorTileActionPlusClassName,
  connectorTileClassName,
  connectorTileDescClassName,
  connectorTileEnabledClass,
  connectorTileHeaderClassName,
  connectorTileOrderClass,
} from "./connector-tile";

export type ArtifactPluginCardProps = {
  plugin: ArtifactPluginCatalogItem;
  openLabel: string;
  /** @deprecated Kept for call-site compatibility; action is + / chat like recommend cards. */
  toggleLabel?: string;
  onOpen: () => void;
  /** When enabled — chat bubble “go try”; falls back to onOpen. */
  onTry?: () => void;
  /** @deprecated Enable/disable is done from the detail dialog (match recommend connectors). */
  onEnabledChange?: (enabled: boolean) => Promise<void>;
};

const LOCALIZED_PLUGIN_COPY: Record<string, { nameKey: string; descKey: string }> = {
  browser: {
    nameKey: "plugins.artifact_plugin_browser_name",
    descKey: "plugins.artifact_plugin_browser_desc",
  },
  documents: {
    nameKey: "plugins.artifact_plugin_documents_name",
    descKey: "plugins.artifact_plugin_documents_desc",
  },
  pdf: {
    nameKey: "plugins.artifact_plugin_pdf_name",
    descKey: "plugins.artifact_plugin_pdf_desc",
  },
  spreadsheets: {
    nameKey: "plugins.artifact_plugin_spreadsheets_name",
    descKey: "plugins.artifact_plugin_spreadsheets_desc",
  },
};

function localizedPluginCopy(plugin: ArtifactPluginCatalogItem) {
  const keys = LOCALIZED_PLUGIN_COPY[plugin.id];
  if (!keys) {
    return {
      name: plugin.manifest.interface.displayName,
      description: plugin.manifest.interface.shortDescription,
    };
  }
  return {
    name: t(keys.nameKey),
    description: t(keys.descKey),
  };
}

/**
 * Recommend-style tile: logo + title·status-dot + bubble/+, up to 3-line desc.
 * Matches ConnectorStatusCard actions (not Switch).
 */
export function ArtifactPluginCard(props: ArtifactPluginCardProps) {
  const { plugin } = props;
  const enabled = plugin.enabled;
  const copy = localizedPluginCopy(plugin);

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
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      aria-label={`${copy.name}. ${props.openLabel}`}
    >
      <div className={connectorTileHeaderClassName}>
        <ArtifactPluginIcon pluginId={plugin.id} size="sm" />
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
              {copy.name}
            </h3>
            {enabled ? <StatusDot size="xs" tone="success" /> : null}
          </div>
          <div
            className="shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {enabled ? (
              <button
                type="button"
                className={cn(connectorTileActionClassName, "text-dls-text/90")}
                aria-label={t("plugins.connector_try_it")}
                onClick={() => {
                  if (props.onTry) props.onTry();
                  else props.onOpen();
                }}
              >
                <MessageCircle className="size-4" strokeWidth={2} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className={connectorTileActionPlusClassName}
                aria-label={t("plugins.add")}
                onClick={props.onOpen}
              >
                <Plus className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className={connectorTileDescClassName} title={copy.description}>
        {copy.description || "\u00a0"}
      </p>
      <div className="mt-auto h-0 shrink-0" aria-hidden />
    </article>
  );
}
