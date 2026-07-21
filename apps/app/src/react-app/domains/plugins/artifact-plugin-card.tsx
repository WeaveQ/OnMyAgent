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
 * Expert/skill-style vertical card: icon + title + switch, description,
 * bottom “view detail”. Default border transparent; hover reveals edge.
 */
export function ArtifactPluginCard(props: ArtifactPluginCardProps) {
  const { plugin } = props;
  const enabled = plugin.enabled;
  const copy = localizedPluginCopy(plugin);

  return (
    <article
      className={cn(
        "group flex h-full min-h-[7.25rem] flex-col rounded-2xl border border-transparent bg-dls-surface px-3.5 py-3 text-left transition-colors",
        "hover:border-dls-border hover:bg-dls-hover",
        "focus-within:border-dls-border focus-within:bg-dls-hover",
        !enabled && "opacity-80",
        "mac:titlebar-no-drag",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <ArtifactPluginIcon pluginId={plugin.id} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
              {copy.name}
            </h3>
            <div className="shrink-0 pt-0.5">
              <Switch
                checked={enabled}
                aria-label={props.toggleLabel}
                onCheckedChange={(next) => void props.onEnabledChange(next)}
              />
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-dls-secondary">
        {copy.description}
      </p>
      <button
        type="button"
        className="mt-auto inline-flex items-center gap-0.5 pt-2 text-xs text-dls-secondary transition-colors hover:text-dls-text"
        onClick={props.onOpen}
        aria-label={`${copy.name}. ${props.openLabel}`}
      >
        {props.openLabel}
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </button>
    </article>
  );
}
