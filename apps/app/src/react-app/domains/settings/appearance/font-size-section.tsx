/** @jsxImportSource react */
import { useMemo } from "react";

import { t } from "@/i18n";
import { SelectMenu } from "../../../design-system/select-menu";
import {
  FONT_ZOOM_PRESETS,
  fontZoomFromPresetIndex,
  fontZoomPresetIndex,
} from "../../../../app/lib/font-zoom";
import { useFontZoom } from "../../../shell/font-zoom";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";

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
 * Settings row: SelectMenu with full zoom preset list (80%–160%).
 * Shares state with ⌘/Ctrl +/- /0 via the font-zoom controller.
 */
export function FontSizeSection() {
  const { value, setValue } = useFontZoom();
  const selectedIndex = fontZoomPresetIndex(value);
  const selectedValue = String(selectedIndex);

  const options = useMemo(
    () =>
      FONT_ZOOM_PRESETS.map((_, index) => ({
        value: String(index),
        label: labelForPresetIndex(index),
      })),
    // Labels depend on locale; parent re-renders on locale change.
    [],
  );

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.font_size_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>
          {t("settings.font_size_desc")}
        </LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>
            {t("settings.font_size_label")}
          </LayoutSectionItemTitle>
          <LayoutSectionItemDescription>
            {t("settings.font_size_hint")}
          </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
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
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>
    </LayoutSection>
  );
}
