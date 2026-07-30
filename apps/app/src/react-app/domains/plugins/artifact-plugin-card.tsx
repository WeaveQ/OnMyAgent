/** @jsxImportSource react */
import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";
import { ChevronRight } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { ArtifactPluginIcon } from "./artifact-plugin-detail";
import {
  connectorTileClassName,
  connectorTileDescClassName,
  connectorTileEnabledClass,
  connectorTileFooterClassName,
  connectorTileHeaderClassName,
  connectorTileOrderClass,
} from "./connector-tile";

export type ArtifactPluginCardProps = {
  plugin: ArtifactPluginCatalogItem;
  openLabel: string;
  toggleLabel: string;
  onOpen: () => void;
  onEnabledChange: (enabled: boolean) => Promise<void>;
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
 * Skill-style vertical card: icon + title + switch, description, bottom
 * “view detail”. Whole card opens detail (cursor + hover like 我的技能).
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
          <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
            {copy.name}
          </h3>
          <div
            className="shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Switch
              checked={enabled}
              aria-label={props.toggleLabel}
              onCheckedChange={(next) => void props.onEnabledChange(next)}
            />
          </div>
        </div>
      </div>
      <p className={connectorTileDescClassName} title={copy.description}>
        {copy.description || "\u00a0"}
      </p>
      <div className={connectorTileFooterClassName}>
        <span className="inline-flex items-center gap-0.5 text-xs text-dls-secondary transition-colors group-hover:text-dls-text">
          {props.openLabel}
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </article>
  );
}
