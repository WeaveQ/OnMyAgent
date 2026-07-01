/** @jsxImportSource react */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NoticeBox } from "@/components/ui/notice-box";
import { TextInput } from "../../../design-system/text-input";
import { t } from "@/i18n";

const RESET_CONFIRM_PLACEHOLDER = "{resetWord}";
const RESET_CONFIRM_WORD = "RESET";

export type ResetModalProps = {
  open: boolean;
  mode: "onboarding" | "all";
  text: string;
  busy: boolean;
  canReset: boolean;
  hasActiveRuns: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onTextChange: (value: string) => void;
};

export function ResetModal(props: ResetModalProps) {
  const resetConfirmationHint = () => {
    const template = t("settings.reset_confirmation_hint");
    const parts = template.split(RESET_CONFIRM_PLACEHOLDER);
    if (parts.length === 1) return template;
    const [beforeReset, afterReset] = parts;
    return (
      <>
        {beforeReset}
        <span className="font-mono">{RESET_CONFIRM_WORD}</span>
        {afterReset}
      </>
    );
  };

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <AlertDialogContent className="w-full max-w-xl overflow-hidden sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {props.mode === "onboarding"
              ? t("settings.reset_onboarding_title")
              : t("settings.reset_app_data_title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {resetConfirmationHint()}
          </AlertDialogDescription>
        </AlertDialogHeader>

          <div className="mt-6 space-y-4">
            <NoticeBox>
              {props.mode === "onboarding"
                ? t("settings.reset_onboarding_warning")
                : t("settings.reset_app_data_warning")}
            </NoticeBox>

            {props.hasActiveRuns ? (
              <div className="text-xs text-dls-status-danger-fg">
                {t("settings.reset_stop_active_runs")}
              </div>
            ) : null}

            <TextInput
              disabled={props.busy}
              label={t("settings.reset_confirmation_label")}
              onChange={(event) => props.onTextChange(event.currentTarget.value)}
              placeholder={t("settings.reset_confirmation_placeholder")}
              type="text"
              value={props.text}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={props.busy}>
              {t("settings.reset_cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={props.onConfirm}
              disabled={!props.canReset}
            >
              {t("settings.reset_confirm_button")}
            </AlertDialogAction>
          </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
