/** @jsxImportSource react */
import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";

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

export function ArtifactPluginCard(props: ArtifactPluginCardProps) {
  const { plugin } = props;
  return (
    <article className="flex min-h-28 flex-col gap-4 rounded-xl border border-dls-border bg-dls-surface p-4 hover:border-dls-border-strong">
      <div className="flex items-start gap-3">
        <ArtifactPluginIcon pluginId={plugin.id} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-medium text-dls-text">
            {plugin.manifest.interface.displayName}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs text-dls-secondary">
            {plugin.manifest.interface.shortDescription}
          </p>
        </div>
        <Switch
          checked={plugin.enabled}
          aria-label={props.toggleLabel}
          onCheckedChange={(enabled) => void props.onEnabledChange(enabled)}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <StatusBadge tone={plugin.enabled ? "success" : "neutral"} shape="soft">
          {plugin.enabled ? props.enabledLabel : props.disabledLabel}
        </StatusBadge>
        <Button type="button" variant="ghost" size="sm" onClick={props.onOpen}>
          {props.openLabel}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}
