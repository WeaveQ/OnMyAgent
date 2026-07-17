/** @jsxImportSource react */
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { OnboardingProfile } from "../../../kernel/local-provider";
import {
  roleOptions,
  industryOptions,
  toolOptions,
  taskOptions,
  ToggleChip,
  FieldLabel,
} from "./onboarding-profile-shared";
import {
  SettingsBlock,
  SettingsPageSection,
} from "../settings-section";

export type MemoryViewProps = {
  draft: OnboardingProfile;
  onDraftChange: (draft: OnboardingProfile) => void;
};

export function MemoryView(props: MemoryViewProps) {
  const { draft, onDraftChange } = props;

  const toggleListValue = useCallback(
    (key: "roles" | "industries" | "tools" | "tasks", value: string) => {
      const list = draft[key];
      const next = list.includes(value)
        ? list.filter((v) => v !== value)
        : [...list, value];
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <SettingsPageSection
        title={t("settings.memory_personal_info")}
        description={t("settings.memory_personal_info_desc")}
      >
        <SettingsBlock>
          <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-3">
            <FieldLabel>
              {t("settings.memory_user_name")}
              <Input
                value={draft.userName}
                onChange={(e) => updateField("userName", e.target.value)}
                placeholder={t("settings.memory_user_name_placeholder")}
                variant="dls"
                className="mt-1.5"
              />
            </FieldLabel>
            <FieldLabel>
              {t("settings.memory_assistant_name")}
              <Input
                value={draft.assistantName}
                onChange={(e) => updateField("assistantName", e.target.value)}
                placeholder="OnMyAgent"
                variant="dls"
                className="mt-1.5"
              />
            </FieldLabel>
            <FieldLabel>
              {t("settings.memory_mbti")}
              <Input
                value={draft.mbti}
                onChange={(e) => updateField("mbti", e.target.value)}
                placeholder="ENTJ"
                variant="dls"
                className="mt-1.5"
              />
            </FieldLabel>
          </div>
        </SettingsBlock>
      </SettingsPageSection>

      <SettingsPageSection title={t("settings.memory_work_profile")}>
        <SettingsBlock>
          <ChipGroup
            label={t("settings.memory_roles")}
            options={roleOptions}
            selected={draft.roles}
            onToggle={(value) => toggleListValue("roles", value)}
          />
          <ChipGroup
            label={t("settings.memory_industries")}
            options={industryOptions}
            selected={draft.industries}
            onToggle={(value) => toggleListValue("industries", value)}
          />
        </SettingsBlock>
      </SettingsPageSection>

      <SettingsPageSection title={t("settings.memory_work_habits")}>
        <SettingsBlock>
          <ChipGroup
            label={t("settings.memory_tools")}
            options={toolOptions}
            selected={draft.tools}
            onToggle={(value) => toggleListValue("tools", value)}
          />
          <ChipGroup
            label={t("settings.memory_tasks")}
            options={taskOptions}
            selected={draft.tasks}
            onToggle={(value) => toggleListValue("tasks", value)}
          />
        </SettingsBlock>
      </SettingsPageSection>
    </div>
  );
}

function ChipGroup(props: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="text-xs font-medium text-dls-secondary">{props.label}</div>
      <div className="flex flex-wrap gap-1.5">
        {props.options.map((option) => (
          <ToggleChip
            key={option.value}
            label={option.label}
            selected={props.selected.includes(option.value)}
            onClick={() => props.onToggle(option.value)}
          />
        ))}
      </div>
    </div>
  );
}
