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

export function ArtifactPluginCard(props: ArtifactPluginCardProps) {
  const { plugin } = props;
  const enabled = plugin.enabled;
  const copy = localizedPluginCopy(plugin);

  return (
    <article
      className={cn(
        "group flex cursor-pointer flex-col gap-2.5 rounded-2xl border border-transparent bg-dls-surface p-3.5 transition-colors",
        "hover:border-dls-border hover:bg-dls-hover",
        "focus-within:border-dls-border focus-within:bg-dls-hover",
        !enabled && "opacity-70",
      )}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${copy.name}. ${props.openLabel}`}
    >
      <div className="flex items-start gap-3">
        <ArtifactPluginIcon pluginId={plugin.id} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-medium leading-5 text-dls-text">
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
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
            {copy.description}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end pl-0.5">
        <span className="inline-flex items-center gap-0.5 text-xs text-dls-secondary transition-colors group-hover:text-dls-text">
          {props.openLabel}
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </article>
  );
}
