/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { normalizeIdleHours } from "../../../kernel/local-provider";

import { t } from "@/i18n";
import { FontSizeBlockRow } from "../appearance/font-size-section";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

export type PreferencesViewProps = {
  busy: boolean;
  showThinking: boolean;
  onToggleShowThinking: () => void;
  autoCompactContext: boolean;
  autoCompactContextBusy: boolean;
  onToggleAutoCompactContext: () => void;
  autoNewSessionOnIdle: boolean;
  autoNewSessionIdleHours: number;
  onAutoNewSessionOnIdleChange: (enabled: boolean) => void;
  onAutoNewSessionIdleHoursChange: (hours: number) => void;
};

export function PreferencesView(props: PreferencesViewProps) {
  const [idleHoursDraft, setIdleHoursDraft] = useState(
    props.autoNewSessionIdleHours,
  );
  const [idleHoursSaved, setIdleHoursSaved] = useState(false);

  const idleHoursDirty = idleHoursDraft !== props.autoNewSessionIdleHours;

  useEffect(() => {
    if (!idleHoursDirty) {
      setIdleHoursDraft(props.autoNewSessionIdleHours);
    }
  }, [props.autoNewSessionIdleHours, idleHoursDirty]);

  useEffect(() => {
    if (!idleHoursSaved) return;
    const timer = window.setTimeout(() => setIdleHoursSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [idleHoursSaved]);

  const handleSaveIdleHours = useCallback(() => {
    if (!idleHoursDirty || props.busy) return;
    const next = normalizeIdleHours(idleHoursDraft);
    setIdleHoursDraft(next);
    props.onAutoNewSessionIdleHoursChange(next);
    setIdleHoursSaved(true);
  }, [
    idleHoursDirty,
    idleHoursDraft,
    props.busy,
    props.onAutoNewSessionIdleHoursChange,
  ]);

  return (
    <LayoutStack>
      <SettingsPageSection title={t("settings.display_settings_title")}>
        <SettingsBlock>
          <FontSizeBlockRow />
          <SettingsBlockRow
            title={t("settings.show_model_reasoning")}
            description={t("settings.show_model_reasoning_desc")}
            actions={
              <Switch
                aria-label={t("settings.show_model_reasoning")}
                checked={props.showThinking}
                disabled={props.busy}
                onCheckedChange={props.onToggleShowThinking}
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.auto_compact")}
            description={t("settings.auto_compact_desc")}
            actions={
              <Switch
                aria-label={t("settings.auto_compact")}
                checked={props.autoCompactContext}
                disabled={props.busy || props.autoCompactContextBusy}
                onCheckedChange={props.onToggleAutoCompactContext}
              />
            }
          />
        </SettingsBlock>
      </SettingsPageSection>

      <SettingsPageSection title={t("settings.session_management_title")}>
        <SettingsBlock>
          <SettingsBlockRow
            align="start"
            title={t("settings.auto_new_session_title")}
            description={t("settings.auto_new_session_desc")}
            actions={
              <div className="flex items-center gap-2">
                {props.autoNewSessionOnIdle ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={props.busy || !idleHoursDirty}
                    onClick={handleSaveIdleHours}
                  >
                    {idleHoursSaved && !idleHoursDirty
                      ? t("settings.memory_saved")
                      : t("settings.memory_save")}
                  </Button>
                ) : null}
                <Switch
                  aria-label={t("settings.auto_new_session_title")}
                  checked={props.autoNewSessionOnIdle}
                  disabled={props.busy}
                  onCheckedChange={(checked) =>
                    props.onAutoNewSessionOnIdleChange(checked === true)
                  }
                />
              </div>
            }
          >
            {props.autoNewSessionOnIdle ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm text-dls-text">
                  <span>{t("settings.auto_new_session_threshold_prefix")}</span>
                  <Input
                    type="number"
                    min={1}
                    max={168}
                    step={1}
                    variant="dls"
                    className="h-9 w-16 text-center text-sm tabular-nums"
                    value={String(idleHoursDraft)}
                    disabled={props.busy}
                    aria-label={t("settings.auto_new_session_hours_aria")}
                    onChange={(event) => {
                      setIdleHoursDraft(normalizeIdleHours(event.target.value));
                      setIdleHoursSaved(false);
                    }}
                  />
                  <span>{t("settings.auto_new_session_threshold_suffix")}</span>
                </div>
                <p className="flex items-start gap-1.5 text-sm leading-5 text-dls-secondary">
                  <span aria-hidden="true">💡</span>
                  <span>{t("settings.auto_new_session_hint")}</span>
                </p>
              </div>
            ) : (
              <p className="mt-2 flex items-start gap-1.5 text-sm leading-5 text-dls-secondary">
                <span aria-hidden="true">💡</span>
                <span>{t("settings.auto_new_session_hint")}</span>
              </p>
            )}
          </SettingsBlockRow>
        </SettingsBlock>
      </SettingsPageSection>
    </LayoutStack>
  );
}
