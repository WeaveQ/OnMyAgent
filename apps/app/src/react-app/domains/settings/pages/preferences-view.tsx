/** @jsxImportSource react */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SelectMenu } from "../../../design-system/select-menu";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";

import { t } from "@/i18n";
import { FontSizeBlockRow } from "../appearance/font-size-section";
import { SettingsBlock, SettingsBlockRow } from "../settings-section";
import { LayoutStack } from "../settings-layout";

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
  desktopNotifyOnAgentReady: boolean;
  /** Called with the next enabled state; may request OS permission when turning on. */
  onDesktopNotifyOnAgentReadyChange: (enabled: boolean) => void | Promise<void>;
};

function PreferenceSection(props: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-lg font-medium text-foreground">{props.title}</h3>
      {props.children}
    </section>
  );
}

export function PreferencesView(props: PreferencesViewProps) {
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [openingNotificationSettings, setOpeningNotificationSettings] =
    useState(false);

  const refreshNotificationPermission = useCallback(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    refreshNotificationPermission();
    const onFocus = () => refreshNotificationPermission();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshNotificationPermission]);

  const handleAuthorizeDesktopNotifications = async () => {
    setOpeningNotificationSettings(true);
    try {
      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        await Notification.requestPermission().catch(() => undefined);
      }
      if (isDesktopRuntime()) {
        await desktopBridge.openSystemPermissionSettings("notifications");
      }
      refreshNotificationPermission();
    } finally {
      setOpeningNotificationSettings(false);
    }
  };

  const desktopNotificationsGranted =
    notificationPermission === "granted";

  return (
    <LayoutStack>
      <PreferenceSection title={t("settings.font_size_title")}>
        <SettingsBlock>
          <FontSizeBlockRow />
        </SettingsBlock>
      </PreferenceSection>

      <PreferenceSection title={t("settings.personalization_title")}>
        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.response_tone")}
            description={t("settings.response_tone_desc")}
            actions={
              <SelectMenu
                ariaLabel={t("settings.response_tone")}
                options={[
                  {
                    value: "friendly",
                    label: t("settings.response_tone_friendly"),
                  },
                  {
                    value: "business",
                    label: t("settings.response_tone_business"),
                  },
                ]}
                value={props.responseTone}
                disabled={props.busy}
                onChange={(value) =>
                  props.onResponseToneChange(
                    value === "friendly" ? "friendly" : "business",
                  )
                }
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.custom_instructions")}
            description={t("settings.custom_instructions_desc")}
            align="start"
          >
            <Textarea
              className="mt-2 min-h-28 w-full resize-y bg-dls-surface-muted py-2.5 leading-6 placeholder:text-dls-secondary/70"
              value={props.customInstructions}
              disabled={props.busy}
              placeholder={t("settings.custom_instructions_placeholder")}
              onChange={(event) =>
                props.onCustomInstructionsChange(event.target.value)
              }
            />
          </SettingsBlockRow>
        </SettingsBlock>
      </PreferenceSection>

      <PreferenceSection title={t("settings.model_title")}>
        <SettingsBlock>
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
      </PreferenceSection>

      <PreferenceSection title={t("settings.notifications_section_title")}>
        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.desktop_notifications_label")}
            description={t("settings.desktop_notifications_desc")}
            actions={
              desktopNotificationsGranted ? (
                <span className="text-sm text-dls-secondary">
                  {t("settings.permission_authorized")}
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={
                    props.busy ||
                    openingNotificationSettings ||
                    notificationPermission === "unsupported"
                  }
                  onClick={() => void handleAuthorizeDesktopNotifications()}
                >
                  {openingNotificationSettings
                    ? t("settings.permission_opening")
                    : t("settings.permission_authorize")}
                  <ExternalLink className="size-3.5" />
                </Button>
              )
            }
          />
          <SettingsBlockRow
            title={t("settings.agent_ready_notifications_label")}
            description={t("settings.agent_ready_notifications_desc")}
            actions={
              <Switch
                aria-label={t("settings.agent_ready_notifications_label")}
                checked={props.desktopNotifyOnAgentReady}
                disabled={props.busy}
                onCheckedChange={(checked) => {
                  void (async () => {
                    if (checked) {
                      if (
                        typeof window !== "undefined" &&
                        "Notification" in window &&
                        Notification.permission === "default"
                      ) {
                        await Notification.requestPermission().catch(
                          () => undefined,
                        );
                        refreshNotificationPermission();
                      }
                    }
                    await props.onDesktopNotifyOnAgentReadyChange(checked);
                  })();
                }}
              />
            }
          />
        </SettingsBlock>
      </PreferenceSection>
    </LayoutStack>
  );
}
