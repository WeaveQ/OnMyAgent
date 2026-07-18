/** @jsxImportSource react */
import { useCallback } from "react";
import { ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { OnboardingProfile } from "../../../kernel/local-provider";
import {
  roleOptions,
  industryOptions,
  toolOptions,
  taskOptions,
  mbtiOptions,
  mbtiSelectItems,
  type ProfileOption,
} from "./onboarding-profile-shared";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

// Shared width for trailing inputs + selects so the right column aligns.
// !justify-between: SettingsBlockRow applies [&_button]:justify-end to trailing controls.
const fieldControlWidthClass = "w-[13.5rem] sm:w-56";
const fieldTriggerClass = cn(
  "h-9 !justify-between gap-2 px-3 font-normal",
  fieldControlWidthClass,
);
const fieldInputClass = cn("h-9 text-sm", fieldControlWidthClass);

export type MemoryViewProps = {
  draft: OnboardingProfile;
  onDraftChange: (draft: OnboardingProfile) => void;
};

export function MemoryView(props: MemoryViewProps) {
  const { draft, onDraftChange } = props;

  const setListValue = useCallback(
    (key: "roles" | "industries" | "tools" | "tasks", next: string[]) => {
      onDraftChange({ ...draft, [key]: next });
    },
    [draft, onDraftChange],
  );

  const updateField = useCallback(
    <K extends keyof OnboardingProfile>(key: K, value: OnboardingProfile[K]) => {
      onDraftChange({ ...draft, [key]: value });
    },
    [draft, onDraftChange],
  );

  return (
    <LayoutStack className="gap-y-8">
      <SettingsPageSection
        title={t("settings.memory_personal_info")}
        description={t("settings.memory_personal_info_desc")}
      >
        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.memory_user_name")}
            description={t("settings.memory_user_name_desc")}
            actions={
              <Input
                value={draft.userName}
                onChange={(e) => updateField("userName", e.target.value)}
                placeholder={t("settings.memory_user_name_placeholder")}
                variant="dls"
                className={fieldInputClass}
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.memory_assistant_name")}
            description={t("settings.memory_assistant_name_desc")}
            actions={
              <Input
                value={draft.assistantName}
                onChange={(e) => updateField("assistantName", e.target.value)}
                placeholder="OnMyAgent"
                variant="dls"
                className={fieldInputClass}
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.memory_mbti")}
            description={t("settings.memory_mbti_desc")}
            actions={
              <Select
                value={draft.mbti || null}
                items={mbtiSelectItems}
                onValueChange={(value) =>
                  updateField("mbti", typeof value === "string" ? value : "")
                }
              >
                <SelectTrigger
                  className={cn(
                    fieldTriggerClass,
                    "rounded-lg border-dls-border bg-dls-surface text-sm text-dls-text data-[size=default]:h-9",
                  )}
                  aria-label={t("settings.memory_mbti")}
                >
                  <SelectValue placeholder={t("settings.memory_select_placeholder")} />
                </SelectTrigger>
                <SelectContent align="end" className="rounded-xl">
                  {mbtiOptions.map((value) => (
                    <SelectItem key={value} value={value} className="rounded-lg text-sm">
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </SettingsBlock>
      </SettingsPageSection>

      <SettingsPageSection
        title={t("settings.memory_work_profile")}
        description={t("settings.memory_work_profile_desc")}
      >
        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.memory_roles")}
            description={t("settings.memory_roles_desc")}
            actions={
              <MultiSelectField
                options={roleOptions}
                selected={draft.roles}
                onChange={(next) => setListValue("roles", next)}
                ariaLabel={t("settings.memory_roles")}
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.memory_industries")}
            description={t("settings.memory_industries_desc")}
            actions={
              <MultiSelectField
                options={industryOptions}
                selected={draft.industries}
                onChange={(next) => setListValue("industries", next)}
                ariaLabel={t("settings.memory_industries")}
              />
            }
          />
        </SettingsBlock>
      </SettingsPageSection>

      <SettingsPageSection title={t("settings.memory_work_habits")}>
        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.memory_tools")}
            description={t("settings.memory_tools_desc")}
            actions={
              <MultiSelectField
                options={toolOptions}
                selected={draft.tools}
                onChange={(next) => setListValue("tools", next)}
                ariaLabel={t("settings.memory_tools")}
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.memory_tasks")}
            description={t("settings.memory_tasks_desc")}
            actions={
              <MultiSelectField
                options={taskOptions}
                selected={draft.tasks}
                onChange={(next) => setListValue("tasks", next)}
                ariaLabel={t("settings.memory_tasks")}
              />
            }
          />
        </SettingsBlock>
      </SettingsPageSection>
    </LayoutStack>
  );
}

function MultiSelectField(props: {
  options: ProfileOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
}) {
  const selectedLabels = props.options
    .filter((option) => props.selected.includes(option.value))
    .map((option) => option.label);

  const summary =
    selectedLabels.length === 0
      ? null
      : selectedLabels.length <= 2
        ? selectedLabels.join("、")
        : t("settings.memory_selected_count", { count: selectedLabels.length });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={fieldTriggerClass}
            aria-label={props.ariaLabel}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left text-sm",
                !summary && "text-dls-secondary",
              )}
            >
              {summary ?? t("settings.memory_select_placeholder")}
            </span>
            <ChevronDown className="size-4 shrink-0 text-dls-secondary" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        className={cn("max-h-72", "min-w-[13.5rem] sm:min-w-56")}
      >
        {props.options.map((option) => {
          const checked = props.selected.includes(option.value);
          return (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={checked}
              onCheckedChange={(next) => {
                const on = next === true;
                if (on) {
                  if (checked) return;
                  props.onChange([...props.selected, option.value]);
                  return;
                }
                props.onChange(props.selected.filter((v) => v !== option.value));
              }}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
