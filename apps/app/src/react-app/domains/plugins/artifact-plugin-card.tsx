/** @jsxImportSource react */
import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { ArtifactPluginIcon } from "./artifact-plugin-detail";

export type ArtifactPluginCardProps = {
  plugin: ArtifactPluginCatalogItem;
  enabledLabel: string;
  disabledLabel: string;
  openLabel: string;
  toggleLabel: string;
  onOpen: () => void;
  onEnabledChange: (enabled: boolean) => Promise<void>;
};

const LOCALIZED_PLUGIN_COPY: Record<string, { nameKey: string; descKey: string }> = {
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
        "group flex flex-col gap-3 rounded-xl border border-dls-border bg-dls-surface p-3.5 transition-colors",
        "hover:border-dls-border-strong hover:bg-dls-surface",
        !enabled && "opacity-80",
      )}
    >
      <div className="flex items-start gap-3">
        <ArtifactPluginIcon pluginId={plugin.id} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-medium leading-5 text-dls-text">
              {copy.name}
            </h3>
            <Switch
              checked={enabled}
              aria-label={props.toggleLabel}
              className="shrink-0"
              onCheckedChange={(next) => void props.onEnabledChange(next)}
            />
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
            {copy.description}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pl-0.5">
        <span
          className={cn(
            "text-xs font-medium",
            enabled ? "text-dls-status-success-fg" : "text-dls-secondary",
          )}
        >
          {enabled ? props.enabledLabel : props.disabledLabel}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-0.5 px-2 text-xs text-dls-secondary hover:text-dls-text"
          onClick={props.onOpen}
        >
          {props.openLabel}
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}
