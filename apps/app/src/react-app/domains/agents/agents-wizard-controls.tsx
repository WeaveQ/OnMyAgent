import { NavTabButton } from "@/components/ui/action-row";
import { t } from "@/i18n";

import { STEP_PERCENT, type WizardStep } from "./agents-page-model";

const wizardControlClass = {
  compactFieldStack: "space-y-2.5",
  pickerChip: "border border-dls-border px-3.5 py-1.5 text-xs data-[active=true]:border-dls-accent data-[active=true]:bg-dls-accent data-[active=true]:text-white",
};

export function PickerChip(props: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <NavTabButton
      type="button"
      onClick={props.onClick}
      active={props.active}
      className={wizardControlClass.pickerChip}
      data-active={props.active}
    >
      {props.label}
    </NavTabButton>
  );
}

export function StepProgress(props: { step: Exclude<WizardStep, 0> }) {
  const percent = STEP_PERCENT[props.step];
  return (
    <div className={wizardControlClass.compactFieldStack}>
      <div className="flex items-center justify-between text-xs text-dls-secondary">
        <span>{t("agents.step_of_total", { step: props.step, total: 5 })}</span>
        <span>{t("agents.percent_complete", { percent })}</span>
      </div>
      <div className="h-1.5 rounded-full bg-dls-hover">
        <div
          className="h-full rounded-full bg-dls-accent"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
