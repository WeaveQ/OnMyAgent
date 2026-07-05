import { BriefcaseBusiness, Plus } from "lucide-react";

import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { AgentRegistry } from "./agent-registry";
import { renderAvatar } from "./agents-avatar-rendering";
import { normalizeAgentCardItem, type AgentCardItem } from "./agents-page-model";

const wizardCardTextClass = {
  cardTitle: "text-base font-medium leading-6 text-dls-text",
  rowTitle: "text-sm font-medium text-dls-text",
};

export function TemplateTile(props: {
  registry: AgentRegistry | null;
  item: AgentCardItem;
  active: boolean;
  onClick: () => void;
}) {
  const isBlankTemplate =
    props.item.kind === "template" && props.item.template.id === "blank-agent";
  const normalized = normalizeAgentCardItem(props.item);
  return (
    <ActionRowButton
      density="agentTemplate"
      type="button"
      onClick={props.onClick}
      className={cn(
        "transition-all",
        props.active
          ? "border-dls-accent bg-dls-decision-soft ring-1 ring-dls-accent"
          : "hover:border-dls-accent/30 hover:bg-dls-decision-soft",
      )}
    >
      <IconTile className="size-12" shape="xl" tone="neutral">
        {isBlankTemplate ? (
          <Plus className="size-7 text-dls-secondary" />
        ) : (
          renderAvatar(
            props.registry,
            {
              avatarStyle: normalized.avatarStyle,
              avatarOptionId: normalized.avatarOptionId,
              customAvatarDataUrl: normalized.customAvatarDataUrl,
              name: normalized.name,
            },
            "size-10 text-base",
          )
        )}
      </IconTile>
      <div className={wizardCardTextClass.cardTitle}>
        {normalized.name}
      </div>
      <div className="mt-2 line-clamp-3 text-sm leading-6 text-dls-secondary">
        {normalized.description}
      </div>
    </ActionRowButton>
  );
}

export function ToolCategoryCard(props: {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-dls-border bg-dls-surface px-3.5 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-dls-accent text-white">
            <BriefcaseBusiness className="size-4" />
          </div>
          <div>
            <div className={wizardCardTextClass.rowTitle}>
              {props.name}
            </div>
            <div className="mt-1 text-xs leading-5 text-dls-secondary">
              {props.description}
            </div>
          </div>
        </div>
        <Switch
          checked={props.enabled}
          onCheckedChange={props.onToggle}
          className="mt-1 shrink-0"
        />
      </div>
    </div>
  );
}
