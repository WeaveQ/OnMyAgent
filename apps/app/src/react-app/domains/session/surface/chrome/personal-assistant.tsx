/** @jsxImportSource react */
import type { ReactNode } from "react";
import { Folder, FolderOpen, Settings2, Trash2, X } from "lucide-react";

import { t } from "../../../../../i18n";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { Button } from "@/components/ui/button";
import { ActionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import {
  ONMYAGENT_ASSISTANT_AVATAR,
  PERSONAL_ASSISTANT_CATEGORIES,
  type AssistantCategoryId,
  type AssistantScenario,
} from "../personal-assistant-config";
import { sessionSurfaceStateClass, sessionSurfaceTextClass } from "../surface-styles";
import type { SessionError } from "../session-surface-support";

export function PersonalAssistantHero() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 pb-6 pt-14 text-center">
      <img
        src={resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR)}
        alt=""
        className="size-36 rounded-xl object-cover"
        draggable={false}
      />
      <h2 className={sessionSurfaceTextClass.assistantHeroTitle}>
        {t("session.assistant_intro")}
      </h2>
    </div>
  );
}

export function AssistantScenarioPill(props: {
  scenario: AssistantScenario;
  active?: boolean;
  onClick: () => void;
}) {
  const Icon = props.scenario.icon;
  return (
    <Button
      type="button"
      variant={props.active ? "default" : "outline"}
      size="sm"
      onClick={props.onClick}
      className={cn(
        "h-8 shrink-0 rounded-lg text-xs",
        props.active
          ? "text-dls-accent-foreground"
          : "text-dls-secondary hover:border-dls-border-strong hover:bg-dls-hover hover:text-dls-text",
      )}
    >
      <Icon className="size-3.5" />
      <span className="whitespace-nowrap">{props.scenario.label}</span>
    </Button>
  );
}

export function assistantScenarioDraftToken(id: string) {
  return `[[assistant-scenario:${id}]]`;
}

export function removeAssistantScenarioDraftTokens(value: string) {
  return value.replace(/\[\[assistant-scenario:[^\]]+\]\]\s*/g, "");
}

export function PersonalAssistantAccessory(props: {
  categoryId: AssistantCategoryId;
  selectedScenario: AssistantScenario | null;
  showPrompts: boolean;
  onSelectScenario: (scenario: AssistantScenario) => void;
  onSelectPrompt: (prompt: string) => void;
}) {
  const category =
    PERSONAL_ASSISTANT_CATEGORIES.find(
      (item) => item.id === props.categoryId,
    ) ?? PERSONAL_ASSISTANT_CATEGORIES[1];
  const prompts = props.selectedScenario?.prompts ?? [];

  return (
    <div className="px-1 pt-2">
      {!props.selectedScenario ? (
        <div className="flex justify-center gap-2 px-0 pt-0">
          {category.scenarios.slice(0, 4).map((scenario) => (
            <AssistantScenarioPill
              key={scenario.id}
              scenario={scenario}
              onClick={() => props.onSelectScenario(scenario)}
            />
          ))}
        </div>
      ) : null}
      {props.selectedScenario && props.showPrompts ? (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {prompts.slice(0, 6).map((prompt) => (
            <ActionRowButton
              density="compact"
              key={prompt}
              type="button"
              onClick={() => props.onSelectPrompt(prompt)}
              className="w-auto items-center gap-1.5 rounded-lg border-transparent bg-dls-surface-muted px-3 py-2 text-xs leading-4 text-dls-text hover:border-transparent hover:bg-dls-hover"
            >
              <span className="max-w-56 truncate">{prompt}</span>
              <span className="shrink-0 text-dls-text">↗</span>
            </ActionRowButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function isUserCancelledError(error: SessionError) {
  return /\b(aborted|abort|cancelled|canceled)\b/i.test(error.message);
}

export function SessionErrorCard({
  error,
  onDismiss,
  onChangeModel,
  onOpenModelPicker,
}: {
  error: SessionError;
  onDismiss: () => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onOpenModelPicker?: () => void;
}) {
  if (isUserCancelledError(error)) {
    return (
      <div className="mx-auto max-w-3xl px-3 py-2 sm:px-5">
        <div className="text-sm text-dls-secondary">
          {t("session.user_cancelled")}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-3 py-3 sm:px-5">
      <div className={sessionSurfaceStateClass.errorPanel}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className={sessionSurfaceStateClass.errorText}>
              {error.message}
            </div>
            {error.kind === "model-not-found" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {error.suggestions && error.suggestions.length > 0
                  ? error.suggestions.map((s) => (
                      <Button
                        key={`${s.providerID}/${s.modelID}`}
                        type="button"
                        variant="outline"
                        size="xs"
                        className="rounded-full text-dls-text hover:bg-dls-hover"
                        onClick={() => {
                          onChangeModel?.(s);
                          onDismiss();
                        }}
                      >
                        Use {s.providerID}/{s.modelID}
                      </Button>
                    ))
                  : null}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-full text-dls-text hover:bg-dls-hover"
                  onClick={() => {
                    onOpenModelPicker?.();
                    onDismiss();
                  }}
                >
                  Change model
                </Button>
              </div>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-xs"
            type="button"
            className={sessionSurfaceStateClass.errorDismiss}
            onClick={onDismiss}
            aria-label={t("session.dismiss_error")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}

