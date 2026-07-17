/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SelectMenu } from "../../../design-system/select-menu";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";

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
  desktopNotifyOnAgentReady: boolean;
  /** Called with the next enabled state; may request OS permission when turning on. */
  onDesktopNotifyOnAgentReadyChange: (enabled: boolean) => void | Promise<void>;
};

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
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.notifications_section_title")}</LayoutSectionTitle>
          <LayoutSectionDescription>
            {t("settings.notifications_section_desc")}
          </LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>
              {t("settings.desktop_notifications_label")}
            </LayoutSectionItemTitle>
            <LayoutSectionItemDescription>
              {t("settings.desktop_notifications_desc")}
            </LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              {desktopNotificationsGranted ? (
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
              )}
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>
              {t("settings.agent_ready_notifications_label")}
            </LayoutSectionItemTitle>
            <LayoutSectionItemDescription>
              {t("settings.agent_ready_notifications_desc")}
            </LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.agent_ready_notifications_label")}
                checked={props.desktopNotifyOnAgentReady}
                disabled={props.busy}
                onCheckedChange={(checked) => {
                  void (async () => {
                    if (checked) {
                      // Turning on: ensure OS permission so the first real
                      // alert is not silently dropped.
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
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>

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
