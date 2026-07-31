/** @jsxImportSource react */
import { useMemo, useState } from "react";

import {
  currentLocale,
  LANGUAGE_OPTIONS,
  setLocale,
  t,
  type Language,
} from "@/i18n";
import { SelectMenu } from "../../../design-system/select-menu";
import { SettingsBlockRow } from "../settings-section";

/**
 * Language row for Personalization → Display.
 * Preference is global (same store as former account-menu control).
 */
export function LanguageBlockRow() {
  const [language, setLanguageState] = useState<Language>(() => currentLocale());

  const options = useMemo(
    () =>
      LANGUAGE_OPTIONS.map((option) => ({
        value: option.value,
        label:
          option.value === "zh"
            ? t("account_menu.language_chinese")
            : option.nativeName,
      })),
    // Recompute labels when locale changes so the row stays consistent.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- language drives t()
    [language],
  );

  return (
    <SettingsBlockRow
      title={t("settings.language")}
      description={t("settings.language.description")}
      actions={
        <div className="w-[11rem]">
          <SelectMenu
            ariaLabel={t("settings.language")}
            options={options}
            value={language}
            onChange={(next) => {
              const value = next as Language;
              setLocale(value);
              setLanguageState(value);
            }}
          />
        </div>
      }
    />
  );
}
