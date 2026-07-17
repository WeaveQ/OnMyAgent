/** @jsxImportSource react */
import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  Folder,
  FolderOpen,
  Settings2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

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
        className="size-28 rounded-full object-cover shadow-sm ring-1 ring-dls-border/60"
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
  const [copied, setCopied] = useState(false);
  const formattedTime = useMemo(
    () => error.createdAt ? new Date(error.createdAt).toLocaleString() : null,
    [error.createdAt],
  );
  const errorDetails = useMemo(() => {
    const lines = [
      error.messageId
        ? `${t("session.error_message_id")}: ${error.messageId}${error.traceId ? ` / ${error.traceId}` : ""}`
        : error.traceId
          ? `${t("session.error_trace_id")}: ${error.traceId}`
          : null,
      formattedTime ? `${t("session.error_date")}: ${formattedTime}` : null,
      error.code ? `${t("session.error_code_label")}: ${error.code}` : null,
      `${t("session.error_message_label")}: ${error.message}`,
    ];
    return lines.filter((line) => line !== null).join("\n");
  }, [error.code, error.message, error.messageId, error.traceId, formattedTime]);

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
      <div className="rounded-lg border border-dls-border bg-dls-surface p-3 text-assistant">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-px size-4 shrink-0 text-dls-status-danger" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 break-words font-medium text-dls-status-danger">
                {error.message}
                {error.code ? ` (${t("session.error_code", { code: error.code })})` : ""}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                className={sessionSurfaceStateClass.errorDismiss}
                onClick={onDismiss}
                aria-label={t("session.dismiss_error")}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="space-y-1 border-t border-dls-border pt-2 text-xs leading-4 text-dls-secondary">
              {error.messageId || error.traceId ? (
                <div className="flex items-center gap-1.5 break-all text-dls-text">
                  <span className="min-w-0 flex-1">
                    {error.messageId
                      ? `${t("session.error_message_id")}: ${error.messageId}${error.traceId ? ` / ${error.traceId}` : ""}`
                      : `${t("session.error_trace_id")}: ${error.traceId}`}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title={copied ? t("common.copied") : t("session.error_copy_details")}
                    aria-label={copied ? t("common.copied") : t("session.error_copy_details")}
                    onClick={() => {
                      void navigator.clipboard.writeText(errorDetails).then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2_000);
                      });
                    }}
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </Button>
                </div>
              ) : null}
              {formattedTime ? (
                <div>{t("session.error_date")}: {formattedTime}</div>
              ) : null}
            </div>
            {error.kind === "model-not-found" ? (
              <div className="flex flex-wrap gap-2">
                {error.suggestions && error.suggestions.length > 0
                  ? error.suggestions.map((s) => (
                      <Button
                        key={`${s.providerID}/${s.modelID}`}
                        type="button"
                        variant="outline"
                        size="xs"
                        className="text-dls-text hover:bg-dls-hover"
                        onClick={() => {
                          onChangeModel?.(s);
                          onDismiss();
                        }}
                      >
                        {t("session.error_use_model", {
                          model: `${s.providerID}/${s.modelID}`,
                        })}
                      </Button>
                    ))
                  : null}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="text-dls-text hover:bg-dls-hover"
                  onClick={() => {
                    onOpenModelPicker?.();
                    onDismiss();
                  }}
                >
                  {t("session.error_change_model")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
