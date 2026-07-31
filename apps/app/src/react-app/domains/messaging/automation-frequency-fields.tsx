/** @jsxImportSource react */
/**
 * Schedule frequency controls for the automation dialog
 * (cycle / interval / once) — layout matches product reference.
 */
import { ChevronDown } from "lucide-react";
import type { MouseEvent } from "react";

import { SegmentedTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "../../../i18n";
import {
  ALL_WEEKDAYS,
  automationCycleLabel,
  automationFrequencyLabel,
  automationWeekdayLabel,
  isIntervalUnit,
  isScheduleValid,
  type AutomationFormState,
  type IntervalUnit,
} from "./automation-form-model";
import type { AutomationCycle, AutomationFrequencyMode } from "./automation-model";

const frequencyModes: AutomationFrequencyMode[] = ["weekly", "interval", "once"];
const automationCycles: AutomationCycle[] = ["daily", "weekly", "biweekly", "monthly", "yearly"];
const weekdayOptions = [...ALL_WEEKDAYS];

function openNativePicker(event: MouseEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  input.focus();
  input.showPicker?.();
}

/** Whether cycle mode exposes a weekday multi-select (weekly / biweekly). */
export function cycleUsesWeekdays(day: AutomationCycle) {
  return day === "weekly" || day === "biweekly";
}

export function weekdaysSummaryLabel(selected: number[]) {
  if (selected.length === 0) return t("automation.weekdays_placeholder");
  if (selected.length === 7) return t("automation.weekdays_all");
  const labels = [...selected]
    .sort((left, right) => left - right)
    .map((day) => automationWeekdayLabel(day));
  if (labels.length <= 4) return labels.join(t("automation.weekdays_join"));
  return `${labels.slice(0, 4).join(t("automation.weekdays_join"))}${t("automation.weekdays_more")}`;
}

function WeekdayMultiSelect(props: {
  selected: number[];
  onChange: (next: number[]) => void;
  className?: string;
}) {
  return (
    // modal=false: avoid fighting Dialog focus trap so the menu is clickable
    <div className={cn("min-w-0", props.className ?? "min-w-40 flex-1")}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full min-w-0 justify-between px-3"
              aria-label={t("automation.field_weekdays")}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">
                {weekdaysSummaryLabel(props.selected)}
              </span>
              <ChevronDown className="size-4 shrink-0 text-dls-secondary" />
            </Button>
          }
        />
        <DropdownMenuContent
          sideOffset={6}
          align="start"
          className="z-[80] min-w-44 rounded-xl border border-dls-border bg-dls-surface-solid p-1 text-dls-text"
        >
          {weekdayOptions.map((weekday) => {
            const checked = props.selected.includes(weekday);
            return (
              <DropdownMenuCheckboxItem
                key={weekday}
                checked={checked}
                closeOnClick={false}
                onCheckedChange={(next) => {
                  const on = next === true;
                  if (on) {
                    if (checked) return;
                    props.onChange(
                      [...props.selected, weekday].sort((left, right) => left - right),
                    );
                    return;
                  }
                  props.onChange(props.selected.filter((item) => item !== weekday));
                }}
              >
                {automationWeekdayLabel(weekday)}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function IntervalUnitSelect(props: {
  value: IntervalUnit;
  onChange: (unit: IntervalUnit) => void;
}) {
  const label =
    props.value === "minutes"
      ? t("automation.interval_minutes")
      : props.value === "hours"
        ? t("automation.interval_hours")
        : t("automation.interval_days");
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-24 shrink-0 justify-between px-3"
          >
            <span className="min-w-0 flex-1 truncate text-left text-sm">{label}</span>
            <ChevronDown className="size-4 shrink-0 text-dls-secondary" />
          </Button>
        }
      />
      <DropdownMenuContent
        sideOffset={6}
        className="z-[80] min-w-24 rounded-xl border border-dls-border bg-dls-surface-solid p-1 text-dls-text"
      >
        {(["minutes", "hours", "days"] as const).map((unit) => (
          <DropdownMenuItem
            key={unit}
            onClick={() => props.onChange(unit)}
            className={
              props.value === unit
                ? "rounded-lg bg-dls-text text-dls-surface focus:bg-dls-text focus:text-dls-surface"
                : "rounded-lg"
            }
          >
            {unit === "minutes"
              ? t("automation.interval_minutes")
              : unit === "hours"
                ? t("automation.interval_hours")
                : t("automation.interval_days")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FrequencyFields(props: {
  form: AutomationFormState;
  onFormChange: (form: AutomationFormState) => void;
}) {
  const setForm = (patch: Partial<AutomationFormState>) =>
    props.onFormChange({ ...props.form, ...patch });
  const showCycleWeekdays =
    props.form.frequencyMode === "weekly" && cycleUsesWeekdays(props.form.day);

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-dls-secondary">
        {t("automation.field_frequency")}
        <span aria-hidden="true" className="ml-0.5 text-dls-status-danger-fg">
          *
        </span>
      </div>
      <SegmentedTabGroup density="filter">
        {frequencyModes.map((mode) => (
          <SegmentedTabButton
            key={mode}
            type="button"
            active={props.form.frequencyMode === mode}
            size="chip"
            width="hug"
            className="whitespace-nowrap"
            onClick={() => setForm({ frequencyMode: mode })}
          >
            {automationFrequencyLabel(mode)}
          </SegmentedTabButton>
        ))}
      </SegmentedTabGroup>

      {props.form.frequencyMode === "weekly" ? (
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-28 shrink-0 justify-between px-3"
                >
                  <span className="min-w-0 flex-1 truncate text-left text-sm">
                    {automationCycleLabel(props.form.day)}
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-dls-secondary" />
                </Button>
              }
            />
            <DropdownMenuContent
              sideOffset={6}
              className="z-[80] min-w-28 rounded-xl border border-dls-border bg-dls-surface-solid p-1 text-dls-text"
            >
              {automationCycles.map((cycle) => (
                <DropdownMenuItem
                  key={cycle}
                  onClick={() => setForm({ day: cycle })}
                  className={
                    props.form.day === cycle
                      ? "rounded-lg bg-dls-text text-dls-surface focus:bg-dls-text focus:text-dls-surface"
                      : "rounded-lg"
                  }
                >
                  {automationCycleLabel(cycle)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {showCycleWeekdays ? (
            <WeekdayMultiSelect
              selected={props.form.weekdays}
              onChange={(weekdays) => setForm({ weekdays })}
              className="min-w-44 flex-1"
            />
          ) : null}
          <Input
            type="time"
            variant="dlsMono"
            value={props.form.time}
            onClick={openNativePicker}
            onChange={(event) => setForm({ time: event.currentTarget.value })}
            aria-label={t("automation.field_time")}
            className="w-32 shrink-0"
          />
        </div>
      ) : null}

      {props.form.frequencyMode === "interval" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-sm text-dls-secondary">{t("automation.interval_every")}</span>
          <Input
            type="number"
            min={1}
            variant="dls"
            value={props.form.intervalValue}
            onChange={(event) => setForm({ intervalValue: event.currentTarget.value })}
            className="w-20 shrink-0"
            aria-label={t("automation.interval_every")}
          />
          <IntervalUnitSelect
            value={props.form.intervalUnit}
            onChange={(intervalUnit) => {
              if (isIntervalUnit(intervalUnit)) setForm({ intervalUnit });
            }}
          />
          <WeekdayMultiSelect
            selected={props.form.weekdays}
            onChange={(weekdays) => setForm({ weekdays })}
            className="min-w-44 flex-1"
          />
        </div>
      ) : null}

      {props.form.frequencyMode === "once" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            type="time"
            variant="dlsMono"
            value={props.form.time}
            onClick={openNativePicker}
            onChange={(event) => setForm({ time: event.currentTarget.value })}
            aria-label={t("automation.field_time")}
          />
          <Input
            type="date"
            variant="dls"
            value={props.form.onceDate}
            onClick={openNativePicker}
            onChange={(event) => setForm({ onceDate: event.currentTarget.value })}
            aria-label={t("automation.once_date")}
          />
        </div>
      ) : null}

      {!isScheduleValid(props.form) ? (
        <div className="text-xs text-dls-status-danger-fg">{t("automation.invalid_schedule")}</div>
      ) : null}
    </div>
  );
}
