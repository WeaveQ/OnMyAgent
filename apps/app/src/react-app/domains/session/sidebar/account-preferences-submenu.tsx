/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import {
  FONT_ZOOM_PRESETS,
  fontZoomFromPresetIndex,
  fontZoomPresetIndex,
} from "@/app/lib/font-zoom";
import {
  getInitialThemeMode,
  setThemeMode as setAppThemeMode,
  subscribeToTheme,
  type ThemeMode,
} from "@/app/theme";
import {
  currentLocale,
  LANGUAGE_OPTIONS,
  setLocale,
  t,
  type Language,
} from "@/i18n";
import { cn } from "@/lib/utils";
import { SelectMenu } from "@/react-app/design-system/select-menu";
import { useFontZoom } from "@/react-app/shell";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

const submenuTriggerClass =
  "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-sidebar-foreground outline-hidden select-none hover:!bg-dls-hover hover:!text-dls-text focus:!bg-dls-hover focus:!text-dls-text data-highlighted:!bg-dls-hover data-highlighted:!text-dls-text data-open:!bg-dls-hover data-open:!text-dls-text data-popup-open:!bg-dls-hover data-popup-open:!text-dls-text [&_svg]:text-current";

const prefRowClass =
  "flex min-h-9 items-center gap-2 rounded-md px-2 py-1 text-sm text-sidebar-foreground";

function fontSizeLabel(index: number): string {
  const zoom = FONT_ZOOM_PRESETS[index] ?? 1;
  const percent = Math.round(zoom * 100);
  if (zoom === 1) {
    return t("settings.font_size_option_default", { percent: String(percent) });
  }
  if (zoom < 1) {
    return t("settings.font_size_option_smaller", { percent: String(percent) });
  }
  return t("settings.font_size_option_larger", { percent: String(percent) });
}

/**
 * Gear-menu flyout: language / theme / chat font size with inline SelectMenu.
 * Shares the same stores as Settings → Preferences (no conversation width).
 */
export function AccountPreferencesSubmenu() {
  const [language, setLanguageState] = useState<Language>(() => currentLocale());
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() =>
    getInitialThemeMode(),
  );
  const { value: fontZoom, setValue: setFontZoom } = useFontZoom();
  const fontIndex = fontZoomPresetIndex(fontZoom);

  useEffect(
    () => subscribeToTheme(() => setThemeModeState(getInitialThemeMode())),
    [],
  );

  const languageOptions = useMemo(
    () =>
      LANGUAGE_OPTIONS.map((option) => ({
        value: option.value,
        label:
          option.value === "zh"
            ? t("account_menu.language_chinese")
            : option.nativeName,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- language drives t()
    [language],
  );

  const themeOptions = useMemo(
    () => [
      { value: "light", label: t("settings.theme_light") },
      { value: "dark", label: t("settings.theme_dark") },
      { value: "system", label: t("settings.theme_system") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, themeMode],
  );

  const fontOptions = useMemo(
    () =>
      FONT_ZOOM_PRESETS.map((_, index) => ({
        value: String(index),
        label: fontSizeLabel(index),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={submenuTriggerClass}>
        <SlidersHorizontal className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-start">
          {t("account_menu.preferences")}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        side="right"
        sideOffset={8}
        align="start"
        className="w-56 rounded-lg border-sidebar-border/70 bg-dls-surface p-1.5"
      >
        <div
          className="flex flex-col gap-0.5"
          // Keep parent menu open while interacting with inline selects.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={prefRowClass}>
            <span className="min-w-0 flex-1 truncate text-sm">
              {t("account_menu.language")}
            </span>
            <div className="w-[7.5rem] shrink-0">
              <SelectMenu
                size="compact"
                ariaLabel={t("account_menu.language")}
                options={languageOptions}
                value={language}
                onChange={(next) => {
                  const value = next as Language;
                  setLocale(value);
                  setLanguageState(value);
                }}
              />
            </div>
          </div>
          <div className={prefRowClass}>
            <span className="min-w-0 flex-1 truncate text-sm">
              {t("account_menu.theme")}
            </span>
            <div className="w-[7.5rem] shrink-0">
              <SelectMenu
                size="compact"
                ariaLabel={t("account_menu.theme")}
                options={themeOptions}
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
          </div>
          <div className={cn(prefRowClass)}>
            <span className="min-w-0 flex-1 truncate text-sm">
              {t("settings.font_size_label")}
            </span>
            <div className="w-[7.5rem] shrink-0">
              <SelectMenu
                size="compact"
                ariaLabel={t("settings.font_size_label")}
                options={fontOptions}
                value={String(fontIndex)}
                onChange={(next) => {
                  const index = Number(next);
                  if (!Number.isFinite(index)) return;
                  setFontZoom(fontZoomFromPresetIndex(index));
                }}
              />
            </div>
          </div>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
