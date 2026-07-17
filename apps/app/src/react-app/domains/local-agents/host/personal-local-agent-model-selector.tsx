import { SelectMenu } from "../../../design-system/select-menu";
import { t } from "@/i18n";
import { useStatusToasts } from "../../shell-feedback";
import { personalLocalAgentSetAcpConfigOption, type PersonalLocalAgent } from "../../../../app/lib/desktop";
import { modelSelectorLabel } from "../local-agent-page-model";
import { useAcpModelInfo } from "../hooks/use-acp-model-info";
type AcpModelInfo = ReturnType<typeof useAcpModelInfo>;

type PersonalLocalAgentModelSelectorProps = {
  agent: PersonalLocalAgent | null;
  selectedModel: string;
  onModelChange: (model: string) => void;
  workspaceRoot: string;
  disabled: boolean;
  acpModelInfo: AcpModelInfo;
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
}: PersonalLocalAgentModelSelectorProps) {
  const { showToast } = useStatusToasts();
  const loadingModels = Boolean(agent?.status === "online" && acpModelInfo.options.length === 0);
  return (
    <div className="min-w-[160px] max-w-[220px]">
      <SelectMenu
        size="compact"
        ariaLabel={modelSelectorLabel(agent)}
        options={[
          { value: "", label: t("local_agent.use_default_config") },
          ...(loadingModels ? [{ value: "__loading", label: t("local_agent.loading_models") }] : []),
          ...acpModelInfo.options.map((option) => ({ value: option.id, label: option.label })),
        ]}
        value={selectedModel}
        onChange={(value) => {
          if (value === "__loading") return;
          onModelChange(value);
          if (value && agent && acpModelInfo.supportsModelOverride) {
            const previousModel = selectedModel;
            const optionLabel = acpModelInfo.options.find((option) => option.id === value)?.label ?? value;
            personalLocalAgentSetAcpConfigOption({
              workspaceRoot,
              agent,
              optionId: acpModelInfo.modelOptionId,
              value,
            })
              .then((result) => {
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
