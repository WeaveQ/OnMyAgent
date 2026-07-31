/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";

import {
  getInitialThemeMode,
  setThemeMode as setAppThemeMode,
  subscribeToTheme,
  type ThemeMode,
} from "../../../../app/theme";
import { t } from "@/i18n";
import { SelectMenu } from "../../../design-system/select-menu";
import { SettingsBlockRow } from "../settings-section";

/**
 * Theme row for Personalization → Interface.
 * Same store as the former account-menu control.
 */
export function ThemeBlockRow() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() =>
    getInitialThemeMode(),
  );

  useEffect(
    () => subscribeToTheme(() => setThemeModeState(getInitialThemeMode())),
    [],
  );

  const options = useMemo(
    () => [
      { value: "light", label: t("settings.theme_light") },
      { value: "dark", label: t("settings.theme_dark") },
      { value: "system", label: t("settings.theme_system") },
    ],
    // Labels re-resolve when locale changes via parent re-render after setLocale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeMode],
  );

  return (
    <SettingsBlockRow
      title={t("settings.theme_title")}
      description={t("settings.theme_system_hint")}
      actions={
        <div className="w-[11rem]">
          <SelectMenu
            ariaLabel={t("settings.theme_title")}
            options={options}
            value={themeMode}
            onChange={(next) => {
              const value = next as ThemeMode;
              if (value !== "light" && value !== "dark" && value !== "system") {
                return;
              }
              setAppThemeMode(value);
              setThemeModeState(value);
            }}
          />
        </div>
      }
    />
  );
}
