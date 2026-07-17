/** @jsxImportSource react */
import { t } from "@/i18n";
import { useFontZoom } from "../../../shell/font-zoom";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";

/**
 * Settings control for global UI scale (小 / 默认 / 大).
 * Shares state with ⌘/Ctrl +/- /0 via the font-zoom controller.
 */
export function FontSizeSection() {
  const { presetIndex, presetCount, setPresetIndex } = useFontZoom();

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
        </LayoutSectionItemHeader>

        <div className="mt-3 w-full max-w-md px-1">
          <input
            type="range"
            min={0}
            max={presetCount - 1}
            step={1}
            value={presetIndex}
            aria-label={t("settings.font_size_label")}
            aria-valuetext={
              presetIndex === 0
                ? t("settings.font_size_small")
                : presetIndex === Math.floor((presetCount - 1) / 2)
                  ? t("settings.font_size_default")
                  : presetIndex === presetCount - 1
                    ? t("settings.font_size_large")
                    : t("settings.font_size_value", {
                        value: String(presetIndex + 1),
                      })
            }
            onChange={(event) => {
              setPresetIndex(Number(event.target.value));
            }}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-dls-border accent-dls-accent [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-dls-text [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-dls-text"
          />
          <div className="mt-2 flex justify-between text-xs text-dls-secondary">
            <span>{t("settings.font_size_small")}</span>
            <span>{t("settings.font_size_default")}</span>
            <span>{t("settings.font_size_large")}</span>
          </div>
        </div>
      </LayoutSectionItem>
    </LayoutSection>
  );
}
