/** @jsxImportSource react */
import type { ReactNode } from "react";
import { UserRound } from "lucide-react";
import { IconTile } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import type { AgentRegistry, AgentWizardDraft } from "./agent-registry";
import { renderAvatar } from "./agents-avatar-rendering";

export function IconCircle(props: { children: ReactNode; className?: string }) {
  return (
    <IconTile size="default" tone="surface" shape="lg" border className={props.className}>
      {props.children}
    </IconTile>
  );
}

export function ExpertCreationAvatar(props: {
  registry: AgentRegistry;
  draft: AgentWizardDraft;
  className?: string;
}) {
  if (props.draft.customAvatarDataUrl) {
    return renderAvatar(
      props.registry,
      {
        avatarStyle: props.draft.avatarStyle,
        avatarOptionId: props.draft.avatarOptionId,
        customAvatarDataUrl: props.draft.customAvatarDataUrl,
        name: props.draft.name,
      },
      props.className,
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-dls-surface-muted text-dls-secondary",
        props.className,
      )}
    >
      <UserRound className="size-1/2" strokeWidth={1.7} aria-hidden />
    </span>
  );
}
