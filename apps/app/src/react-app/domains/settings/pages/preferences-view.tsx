/** @jsxImportSource react */
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SelectMenu } from "../../../design-system/select-menu";

import { t } from "@/i18n";
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
  LayoutStack,
} from "../settings-layout";

export type PreferencesViewProps = {
  busy: boolean;
  showThinking: boolean;
  onToggleShowThinking: () => void;
  responseTone: "friendly" | "business";
  onResponseToneChange: (tone: "friendly" | "business") => void;
  customInstructions: string;
  onCustomInstructionsChange: (instructions: string) => void;
  autoCompactContext: boolean;
  autoCompactContextBusy: boolean;
  onToggleAutoCompactContext: () => void;
};

export function PreferencesView(props: PreferencesViewProps) {
  return (
    <LayoutStack>
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.personalization_title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.personalization_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.response_tone")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.response_tone_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <SelectMenu
                ariaLabel={t("settings.response_tone")}
                options={[
                  { value: "friendly", label: t("settings.response_tone_friendly") },
                  { value: "business", label: t("settings.response_tone_business") },
                ]}
                value={props.responseTone}
                disabled={props.busy}
                onChange={(value) => props.onResponseToneChange(value === "friendly" ? "friendly" : "business")}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.custom_instructions")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.custom_instructions_desc")}</LayoutSectionItemDescription>
          </LayoutSectionItemHeader>
          <Textarea
            className="min-h-36 resize-y bg-dls-surface py-2.5 leading-6 placeholder:text-dls-secondary/70"
            value={props.customInstructions}
            disabled={props.busy}
            placeholder={t("settings.custom_instructions_placeholder")}
            onChange={(event) => props.onCustomInstructionsChange(event.target.value)}
          />
        </LayoutSectionItem>
      </LayoutSection>

      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.model_title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.model_section_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        {/* Show reasoning */}
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.show_model_reasoning")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.show_model_reasoning_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.show_model_reasoning")}
                checked={props.showThinking}
                disabled={props.busy}
                onCheckedChange={props.onToggleShowThinking}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        {/* Auto context compaction */}
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.auto_compact")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.auto_compact_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.auto_compact")}
                checked={props.autoCompactContext}
                disabled={props.busy || props.autoCompactContextBusy}
                onCheckedChange={props.onToggleAutoCompactContext}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>
    </LayoutStack>
  );
}
