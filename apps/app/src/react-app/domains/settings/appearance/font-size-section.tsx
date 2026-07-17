/** @jsxImportSource react */
import { useMemo } from "react";

import { t } from "@/i18n";
import { SelectMenu } from "../../../design-system/select-menu";
import {
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

/** Settings dropdown levels: 小 / 默认 / 大 (maps onto zoom presets). */
const FONT_SIZE_LEVELS = [
  { value: "small", presetIndex: 1 }, // 0.9
  { value: "default", presetIndex: 2 }, // 1.0
  { value: "large", presetIndex: 4 }, // 1.3
] as const;

type FontSizeLevel = (typeof FONT_SIZE_LEVELS)[number]["value"];

function levelFromZoom(value: number): FontSizeLevel {
  const index = fontZoomPresetIndex(value);
  // Nearest of the three UI levels.
  let best: FontSizeLevel = "default";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of FONT_SIZE_LEVELS) {
    const distance = Math.abs(level.presetIndex - index);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level.value;
    }
  }
  return best;
}

function zoomFromLevel(level: string): number {
  const match = FONT_SIZE_LEVELS.find((item) => item.value === level);
  return fontZoomFromPresetIndex(match?.presetIndex ?? 2);
}

/**
 * Settings row matching personalization SelectMenu pattern (语气-style dropdown).
 * Shares state with ⌘/Ctrl +/- /0 via the font-zoom controller.
 */
export function FontSizeSection() {
  const { value, setValue } = useFontZoom();
  const selected = levelFromZoom(value);

  const options = useMemo(
    () => [
      { value: "small", label: t("settings.font_size_small") },
      { value: "default", label: t("settings.font_size_default") },
      { value: "large", label: t("settings.font_size_large") },
    ],
    // Locale changes re-render via app locale subscription higher up.
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
              value={selected}
              onChange={(next) => setValue(zoomFromLevel(next))}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>
    </LayoutSection>
  );
}
