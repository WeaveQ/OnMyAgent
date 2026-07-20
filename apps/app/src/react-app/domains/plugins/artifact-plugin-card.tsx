/** @jsxImportSource react */
import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";
import { ChevronRight } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { ArtifactPluginIcon } from "./artifact-plugin-detail";

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
 * Horizontal shell aligned with connector preview cards.
 * Switch toggles enable; 「查看详情」 / card click opens the detail dialog.
 */
export function ArtifactPluginCard(props: ArtifactPluginCardProps) {
  const { plugin } = props;
  const enabled = plugin.enabled;
  const copy = localizedPluginCopy(plugin);

  return (
    <article
      className={cn(
        "group flex h-full min-h-20 items-center gap-2.5 rounded-xl border border-dls-border/50 bg-dls-surface px-3.5 py-3 transition-colors",
        "hover:border-dls-border hover:bg-dls-hover/60",
        "focus-within:border-dls-border focus-within:bg-dls-hover/60",
        !enabled && "opacity-80",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        onClick={props.onOpen}
        aria-label={`${copy.name}. ${props.openLabel}`}
      >
        <ArtifactPluginIcon pluginId={plugin.id} size="sm" className="size-9 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-dls-text">
              {copy.name}
            </h3>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
            {copy.description}
          </p>
          <span className="mt-1 inline-flex items-center gap-0.5 text-xs text-dls-secondary transition-colors group-hover:text-dls-text">
            {props.openLabel}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </span>
        </div>
      </button>
      <div className="shrink-0 self-start pt-0.5">
        <Switch
          checked={enabled}
          aria-label={props.toggleLabel}
          onCheckedChange={(next) => void props.onEnabledChange(next)}
        />
      </div>
    </article>
  );
}
