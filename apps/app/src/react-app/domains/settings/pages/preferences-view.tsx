/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { normalizeIdleHours } from "../../../kernel/local-provider";
import { isDesktopRuntime } from "@/app/utils";

import { t } from "@/i18n";
import { SelectMenu } from "../../../design-system/select-menu";
import { FontSizeBlockRow } from "../appearance/font-size-section";
import { LanguageBlockRow } from "../appearance/language-section";
import { ThemeBlockRow } from "../appearance/theme-section";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import { AgentRuntimeSettingsSection } from "../../../capabilities/agent-runtime/settings-section";

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
  conversationWidth: "fixed" | "wide";
  onConversationWidthChange: (mode: "fixed" | "wide") => void;
  /** Menu-bar / system-tray icon; desktop only. Default true. */
  menuBarStatusItem?: boolean;
  onMenuBarStatusItemChange?: (enabled: boolean) => void;
  onmyagentClient: OnMyAgentServerClient | null;
  selectedWorkspaceId: string;
};

export function PreferencesView(props: PreferencesViewProps) {
  const desktop = isDesktopRuntime();
  const menuBarStatusItem = props.menuBarStatusItem !== false;
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
      <AgentRuntimeSettingsSection
        client={props.onmyagentClient}
        workspaceId={props.selectedWorkspaceId}
      />
      {/* 1. Interface — language + theme (chrome). */}
      <SettingsPageSection title={t("settings.interface_settings_title")}>
        <SettingsBlock>
          <LanguageBlockRow />
          <ThemeBlockRow />
        </SettingsBlock>
      </SettingsPageSection>

      {/* 2. Display — size, chat chrome, reasoning visibility. */}
      <SettingsPageSection title={t("settings.display_settings_title")}>
        <SettingsBlock>
          <FontSizeBlockRow />
          <SettingsBlockRow
            title={t("settings.conversation_width_label")}
            description={t("settings.conversation_width_desc")}
            actions={
              <div className="w-[11rem]">
                <SelectMenu
                  ariaLabel={t("settings.conversation_width_label")}
                  disabled={props.busy}
                  options={[
                    {
                      value: "fixed",
                      label: t("settings.conversation_width_fixed"),
                    },
                    {
                      value: "wide",
                      label: t("settings.conversation_width_wide"),
                    },
                  ]}
                  value={props.conversationWidth}
                  onChange={(next: string) => {
                    props.onConversationWidthChange(
                      next === "wide" ? "wide" : "fixed",
                    );
                  }}
                />
              </div>
            }
          />
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
          {desktop ? (
            <SettingsBlockRow
              title={t("settings.menu_bar_status_item_label")}
              description={t("settings.menu_bar_status_item_desc")}
              actions={
                <Switch
                  aria-label={t("settings.menu_bar_status_item_label")}
                  checked={menuBarStatusItem}
                  disabled={props.busy || !props.onMenuBarStatusItemChange}
                  onCheckedChange={(checked) =>
                    props.onMenuBarStatusItemChange?.(checked === true)
                  }
                />
              }
            />
          ) : null}
        </SettingsBlock>
      </SettingsPageSection>

      {/* 3. Session habits. */}
      <SettingsPageSection title={t("settings.session_management_title")}>
        <SettingsBlock>
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
