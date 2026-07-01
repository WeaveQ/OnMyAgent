/** @jsxImportSource react */
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { OnboardingProfile } from "../../../kernel/local-provider";
import { roleOptions, industryOptions, toolOptions, taskOptions, ToggleChip, FieldLabel } from "./onboarding-profile-shared";

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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <section className="grid gap-4">
        <h2 className="text-base font-medium text-dls-text">{t("settings.memory_personal_info")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <FieldLabel>
            {t("settings.memory_user_name")}
            <Input
              value={draft.userName}
              onChange={(e) => updateField("userName", e.target.value)}
              placeholder={t("settings.memory_user_name_placeholder")}
              variant="dls"
              controlSize="lg"
              className="mt-1"
            />
          </FieldLabel>
          <FieldLabel>
            {t("settings.memory_assistant_name")}
            <Input
              value={draft.assistantName}
              onChange={(e) => updateField("assistantName", e.target.value)}
              placeholder="OnMyAgent"
              variant="dls"
              controlSize="lg"
              className="mt-1"
            />
          </FieldLabel>
          <FieldLabel>
            {t("settings.memory_mbti")}
            <Input
              value={draft.mbti}
              onChange={(e) => updateField("mbti", e.target.value)}
              placeholder="ENTJ"
              variant="dls"
              controlSize="lg"
              className="mt-1"
            />
          </FieldLabel>
        </div>
      </section>

      <section className="border-t border-dls-border pt-6">
        <h2 className="text-base font-medium text-dls-text">{t("settings.memory_work_profile")}</h2>
        <div className="mt-4 flex flex-col gap-5">
          <div>
            <div className="mb-2 text-xs font-medium text-dls-secondary">
              {t("settings.memory_roles")}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {roleOptions.map((role) => (
                <ToggleChip
                  key={role.value}
                  label={role.label}
                  selected={draft.roles.includes(role.value)}
                  onClick={() => toggleListValue("roles", role.value)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-dls-secondary">
              {t("settings.memory_industries")}
            </div>
            <div className="flex flex-wrap gap-2">
              {industryOptions.map((industry) => (
                <ToggleChip
                  key={industry.value}
                  label={industry.label}
                  selected={draft.industries.includes(industry.value)}
                  onClick={() => toggleListValue("industries", industry.value)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-dls-border pt-6">
        <h2 className="text-base font-medium text-dls-text">{t("settings.memory_work_habits")}</h2>
        <div className="mt-4 flex flex-col gap-5">
          <div>
            <div className="mb-2 text-xs font-medium text-dls-secondary">
              {t("settings.memory_tools")}
            </div>
            <div className="flex flex-wrap gap-2">
              {toolOptions.map((tool) => (
                <ToggleChip
                  key={tool.value}
                  label={tool.label}
                  selected={draft.tools.includes(tool.value)}
                  onClick={() => toggleListValue("tools", tool.value)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-dls-secondary">
              {t("settings.memory_tasks")}
            </div>
            <div className="flex flex-wrap gap-2">
              {taskOptions.map((task) => (
                <ToggleChip
                  key={task.value}
                  label={task.label}
                  selected={draft.tasks.includes(task.value)}
                  onClick={() => toggleListValue("tasks", task.value)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
