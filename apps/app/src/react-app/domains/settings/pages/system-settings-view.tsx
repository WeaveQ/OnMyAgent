/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

export type SystemSettingsViewProps = {
  busy?: boolean;
  launchAtLogin: boolean;
  keepSystemAwake: boolean;
  desktopNotificationsEnabled: boolean;
  dockUnreadBadge: boolean;
  soundNotifyOnAgentReady: boolean;
  desktopNotifyOnAgentReady: boolean;
  onLaunchAtLoginChange: (enabled: boolean) => void | Promise<void>;
  onKeepSystemAwakeChange: (enabled: boolean) => void | Promise<void>;
  onDesktopNotificationsEnabledChange: (enabled: boolean) => void | Promise<void>;
  onDockUnreadBadgeChange: (enabled: boolean) => void | Promise<void>;
  onSoundNotifyOnAgentReadyChange: (enabled: boolean) => void | Promise<void>;
  onDesktopNotifyOnAgentReadyChange: (enabled: boolean) => void | Promise<void>;
};

export function SystemSettingsView(props: SystemSettingsViewProps) {
  const desktop = isDesktopRuntime();
  const [platform, setPlatform] = useState<string>("unknown");

  useEffect(() => {
    if (!desktop) return;
    void (async () => {
      try {
        const result = (await desktopBridge.checkSystemPermissions()) as {
          platform?: string;
        };
        if (result?.platform) setPlatform(result.platform);
      } catch {
        // ignore
      }
    })();
  }, [desktop]);

  const badgeLabel =
    platform === "windows"
      ? t("settings.taskbar_unread_badge_label")
      : t("settings.dock_unread_badge_label");
  const badgeDesc =
    platform === "windows"
      ? t("settings.taskbar_unread_badge_desc")
      : t("settings.dock_unread_badge_desc");

  const applyLaunch = useCallback(
    async (enabled: boolean) => {
      await props.onLaunchAtLoginChange(enabled);
      if (!desktop) return;
      try {
        await desktopBridge.setLaunchAtLogin(enabled);
      } catch {
        // Desktop bridge unavailable or method not ready
      }
    },
    [desktop, props],
  );

  const applyAwake = useCallback(
    async (enabled: boolean) => {
      await props.onKeepSystemAwakeChange(enabled);
      if (!desktop) return;
      try {
        await desktopBridge.setKeepSystemAwake(enabled);
      } catch {
        // Desktop bridge unavailable or method not ready
      }
    },
    [desktop, props],
  );

  return (
    <LayoutStack>
      <SettingsPageSection
        title={t("settings.system_options_section_title")}
        description={t("settings.system_section_desc")}
      >
        {!desktop ? (
          <p className="text-sm text-dls-secondary">
            {t("settings.desktop_only_hint")}
          </p>
        ) : null}
        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.launch_at_login_label")}
            description={t("settings.launch_at_login_desc")}
            actions={
              <Switch
                aria-label={t("settings.launch_at_login_label")}
                checked={props.launchAtLogin}
                disabled={props.busy || !desktop}
                onCheckedChange={(c) => void applyLaunch(c === true)}
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.keep_system_awake_label")}
            description={t("settings.keep_system_awake_desc")}
            actions={
              <Switch
                aria-label={t("settings.keep_system_awake_label")}
                checked={props.keepSystemAwake}
                disabled={props.busy || !desktop}
                onCheckedChange={(c) => void applyAwake(c === true)}
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.desktop_notifications_master_label")}
            description={t("settings.desktop_notifications_master_desc")}
            actions={
              <Switch
                aria-label={t("settings.desktop_notifications_master_label")}
                checked={props.desktopNotificationsEnabled}
                disabled={props.busy || !desktop}
                onCheckedChange={(c) =>
                  void props.onDesktopNotificationsEnabledChange(c === true)
                }
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.agent_ready_notifications_label")}
            description={t("settings.agent_ready_notifications_desc")}
            actions={
              <Switch
                aria-label={t("settings.agent_ready_notifications_label")}
                checked={props.desktopNotifyOnAgentReady}
                disabled={
                  props.busy ||
                  !desktop ||
                  props.desktopNotificationsEnabled !== true
                }
                onCheckedChange={(c) =>
                  void props.onDesktopNotifyOnAgentReadyChange(c === true)
                }
              />
            }
          />
          <SettingsBlockRow
            title={badgeLabel}
            description={badgeDesc}
            actions={
              <Switch
                aria-label={badgeLabel}
                checked={props.dockUnreadBadge}
                disabled={props.busy || !desktop}
                onCheckedChange={(c) =>
                  void props.onDockUnreadBadgeChange(c === true)
                }
              />
            }
          />
          <SettingsBlockRow
            title={t("settings.sound_notify_label")}
            description={t("settings.sound_notify_desc")}
            actions={
              <Switch
                aria-label={t("settings.sound_notify_label")}
                checked={props.soundNotifyOnAgentReady}
                disabled={props.busy || !desktop}
                onCheckedChange={(c) =>
                  void props.onSoundNotifyOnAgentReadyChange(c === true)
                }
              />
            }
          />
        </SettingsBlock>
      </SettingsPageSection>
    </LayoutStack>
  );
}
