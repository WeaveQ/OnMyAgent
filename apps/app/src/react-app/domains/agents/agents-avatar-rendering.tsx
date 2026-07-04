import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  buildAgentAvatarDataUri,
  type AgentAvatarOption,
  type AgentRegistry,
} from "./agent-registry";
import {
  avatarSeed,
  createGeneratedAvatarOption,
  parseGeneratedAvatarOptionId,
} from "./agents-page-model";

export function renderGeneratedAvatar(
  option: AgentAvatarOption,
  seed: string,
  className?: string,
) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-full",
        className,
      )}
      style={{ backgroundColor: option.background }}
      aria-hidden="true"
    >
      <img
        src={buildAgentAvatarDataUri(option.style, seed)}
        alt={option.label}
        className="h-full w-full rounded-full object-cover"
        loading="lazy"
      />
    </div>
  );
}

export function renderAvatar(
  registry: AgentRegistry | null,
  input: {
    avatarStyle?: AgentAvatarOption["style"];
    avatarOptionId: string;
    customAvatarDataUrl?: string | null;
    name: string;
  },
  className?: string,
) {
  if (input.customAvatarDataUrl) {
    return (
      <img
        src={input.customAvatarDataUrl}
        alt={input.name}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  const option =
    registry?.avatars.find((item) => item.id === input.avatarOptionId) ??
    (() => {
      const generated = parseGeneratedAvatarOptionId(input.avatarOptionId);
      if (generated) {
        return createGeneratedAvatarOption(
          generated.style,
          generated.page,
          generated.index,
        );
      }
      if (!input.avatarStyle) return null;
      return createGeneratedAvatarOption(input.avatarStyle, 0, 0);
    })();
  if (!option) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-dls-surface-muted text-dls-secondary",
          className,
        )}
      >
        {input.name.slice(0, 1) || t("session.agent_initial")}
      </div>
    );
  }
  return renderGeneratedAvatar(
    option,
    avatarSeed(option, input.avatarOptionId),
    className,
  );
}
