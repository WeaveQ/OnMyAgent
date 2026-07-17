/** @jsxImportSource react */
import { useMemo } from "react";

import { t } from "@/i18n";
import { SelectMenu } from "../../../design-system/select-menu";
import {
  FONT_ZOOM_PRESETS,
  fontZoomFromPresetIndex,
  fontZoomPresetIndex,
} from "../../../../app/lib/font-zoom";
import { useFontZoom } from "@/react-app/shell";
import { SettingsBlock, SettingsBlockRow } from "../settings-section";

function labelForPresetIndex(index: number): string {
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
 * Single block-row for font size. Parent supplies the section title.
 */
export function FontSizeBlockRow() {
  const { value, setValue } = useFontZoom();
  const selectedIndex = fontZoomPresetIndex(value);
  const selectedValue = String(selectedIndex);

  const options = useMemo(
    () =>
      FONT_ZOOM_PRESETS.map((_, index) => ({
        value: String(index),
        label: labelForPresetIndex(index),
      })),
    [],
  );

  return (
    <SettingsBlockRow
      title={t("settings.font_size_label")}
      description={t("settings.font_size_hint")}
      actions={
        <div className="w-[11rem]">
          <SelectMenu
            ariaLabel={t("settings.font_size_label")}
            options={options}
            value={selectedValue}
            onChange={(next) => {
              const index = Number(next);
              if (!Number.isFinite(index)) return;
              setValue(fontZoomFromPresetIndex(index));
            }}
          />
        </div>
      }
    />
  );
}

/** @deprecated Prefer composing SettingsBlock + FontSizeBlockRow in the page. */
export function FontSizeSection() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-medium text-foreground">
          {t("settings.font_size_title")}
        </h3>
      </div>
      <SettingsBlock>
        <FontSizeBlockRow />
      </SettingsBlock>
    </div>
  );
}
