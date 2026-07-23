/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { ResetOnMyAgentMode } from "../../../../app/types";
import { ResetModal } from "../modals/reset-modal";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsNotice,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

export type RecoveryViewProps = {
  busy: boolean;
  anyActiveRuns: boolean;
  resetModalOpen: boolean;
  resetModalMode: ResetOnMyAgentMode;
  resetModalText: string;
  resetModalBusy: boolean;
  canReset: boolean;
  status: string | null;
  error: string | null;
  onOpenResetModal: (mode: ResetOnMyAgentMode) => void;
  onCloseResetModal: () => void;
  onResetTextChange: (value: string) => void;
  onConfirmReset: () => void;
};

export function RecoveryView(props: RecoveryViewProps) {
  const runsBlocked = props.anyActiveRuns;
  const actionDisabled = props.busy || props.resetModalBusy || runsBlocked;

  return (
    <LayoutStack>
      <SettingsPageSection
        title={t("settings.recovery_section_title")}
        description={t("settings.recovery_section_desc")}
      >
        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.reset_onboarding_title")}
            description={t("settings.reset_onboarding_description")}
            align="start"
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={actionDisabled}
                title={runsBlocked ? t("settings.stop_runs_to_reset") : undefined}
                onClick={() => props.onOpenResetModal("onboarding")}
              >
                {t("settings.reset_button")}
              </Button>
            }
          />
          <SettingsBlockRow
            title={t("settings.reset_app_data_title")}
            description={t("settings.reset_app_data_description")}
            align="start"
            actions={
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0"
                disabled={actionDisabled}
                title={runsBlocked ? t("settings.stop_runs_to_reset") : undefined}
                onClick={() => props.onOpenResetModal("all")}
              >
                {t("settings.reset_button")}
              </Button>
            }
          />
        </SettingsBlock>

        <p className="text-xs text-dls-secondary">{t("settings.reset_requires_confirm")}</p>
        {props.status ? <SettingsNotice tone="info">{props.status}</SettingsNotice> : null}
        {props.error ? <SettingsNotice tone="error">{props.error}</SettingsNotice> : null}
      </SettingsPageSection>

      <ResetModal
        open={props.resetModalOpen}
        mode={props.resetModalMode}
        text={props.resetModalText}
        busy={props.resetModalBusy}
        canReset={props.canReset}
        hasActiveRuns={props.anyActiveRuns}
        onClose={props.onCloseResetModal}
        onConfirm={props.onConfirmReset}
        onTextChange={props.onResetTextChange}
      />
    </LayoutStack>
  );
}
