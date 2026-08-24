import { useLayoutEffect, useRef } from "react";
import { SelectMenu } from "../../../design-system/select-menu";
import { t } from "@/i18n";
import { useStatusToasts } from "../../shell-feedback";
import { personalLocalAgentSetAcpConfigOption, type PersonalLocalAgent } from "../../../../app/lib/desktop";
import { modelSelectorLabel } from "../local-agent-page-model";
import { useAcpModelInfo } from "../hooks/use-acp-model-info";
import { localAgentComposerClass } from "../local-agent-composer-layout";
type AcpModelInfo = ReturnType<typeof useAcpModelInfo>;

type PersonalLocalAgentModelSelectorProps = {
  agent: PersonalLocalAgent | null;
  selectedModel: string;
  onModelChange: (model: string) => void;
  workspaceRoot: string;
  disabled: boolean;
  acpModelInfo: AcpModelInfo;
  conversationId?: string | null;
  providerSessionId?: string | null;
  resumeKey?: string | null;
};

/**
 * Model selector for a personal local agent. Extracted from
 * `personal-local-agent-page.tsx` so that file stays below the god-file line
 * gate. The selector is only rendered when `acpModelInfo.supportsModelOverride`
 * is true (the parent gates on it); switching a model calls the ACP config
 * option and toasts success / rollback-on-error, identical to the original.
 */
export function PersonalLocalAgentModelSelector({
  agent,
  selectedModel,
  onModelChange,
  workspaceRoot,
  disabled,
  acpModelInfo,
  conversationId = null,
  providerSessionId = null,
  resumeKey = null,
}: PersonalLocalAgentModelSelectorProps) {
  const { showToast } = useStatusToasts();
  const latestRequestIdRef = useRef(0);

  // A conversation/provider switch invalidates all pending config writes from
  // the previous session. This keeps a late response from changing the new
  // conversation's selection or showing a stale toast.
  useLayoutEffect(() => {
    latestRequestIdRef.current += 1;
  }, [agent?.id, conversationId, providerSessionId, resumeKey, workspaceRoot]);

  const loadingModels = Boolean(agent?.status === "online" && acpModelInfo.options.length === 0);
  return (
    <div
      className="mac:titlebar-no-drag min-w-0 max-w-40 shrink @max-[32rem]/local-composer:max-w-20"
      data-testid="local-agent-model-selector"
    >
      <SelectMenu
        size="compact"
        placement="top"
        className={localAgentComposerClass.modelChip}
        ariaLabel={modelSelectorLabel(agent)}
        options={[
          { value: "", label: t("local_agent.use_default_config") },
          ...(loadingModels ? [{ value: "__loading", label: t("local_agent.loading_models") }] : []),
          ...acpModelInfo.options.map((option) => ({ value: option.id, label: option.label })),
        ]}
        value={selectedModel}
        onChange={(value) => {
          if (value === "__loading") return;
          const requestId = latestRequestIdRef.current + 1;
          latestRequestIdRef.current = requestId;
          onModelChange(value);
          if (agent && acpModelInfo.supportsModelOverride) {
            const previousModel = selectedModel;
            const optionLabel = value
              ? acpModelInfo.options.find((option) => option.id === value)?.label ?? value
              : t("local_agent.use_default_config");
            personalLocalAgentSetAcpConfigOption({
              workspaceRoot,
              agent,
              optionId: acpModelInfo.modelOptionId,
              value: value || null,
              conversationId,
              sessionId: providerSessionId ?? resumeKey,
              providerSessionId,
              resumeKey,
            })
              .then((result) => {
                if (latestRequestIdRef.current !== requestId) return;
                if (result.ok) {
                  showToast({
                    tone: "success",
                    title: t("local_agent.model_switch_success_title"),
                    description: optionLabel,
                  });
                } else {
                  onModelChange(previousModel);
                  showToast({
                    tone: "error",
                    title: t("local_agent.model_switch_error_title"),
                    description: result.error ?? t("local_agent.model_switch_error_unknown"),
                  });
                }
              })
              .catch((nextError) => {
                if (latestRequestIdRef.current !== requestId) return;
                onModelChange(previousModel);
                showToast({
                  tone: "error",
                  title: t("local_agent.model_switch_error_title"),
                  description: nextError instanceof Error ? nextError.message : String(nextError),
                });
              });
          }
        }}
        disabled={disabled}
      />
    </div>
  );
}
