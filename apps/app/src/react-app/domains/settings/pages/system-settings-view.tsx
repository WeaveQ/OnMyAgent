/** @jsxImportSource react */
/**
 * System options — security-center style: 2-column toggle cards, then stack
 * of section panels (authorizations / folders are siblings in the host).
 */
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BellRing,
  Monitor,
  Power,
  RefreshCw,
  Volume2,
} from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { IconTile } from "@/components/ui/action-row";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import { LayoutStack } from "../settings-layout";
import { cn } from "@/lib/utils";

export type SystemSettingsViewProps = {
  busy?: boolean;
  launchAtLogin: boolean;
  keepSystemAwake: boolean;
  desktopNotificationsEnabled: boolean;
  soundNotifyOnAgentReady: boolean;
  desktopNotifyOnAgentReady: boolean;
  updateAutoCheck: boolean;
  onLaunchAtLoginChange: (enabled: boolean) => void | Promise<void>;
  onKeepSystemAwakeChange: (enabled: boolean) => void | Promise<void>;
  onDesktopNotificationsEnabledChange: (enabled: boolean) => void | Promise<void>;
  onSoundNotifyOnAgentReadyChange: (enabled: boolean) => void | Promise<void>;
  onDesktopNotifyOnAgentReadyChange: (enabled: boolean) => void | Promise<void>;
  onUpdateAutoCheckChange: (enabled: boolean) => void | Promise<void>;
};

type OptionCard = {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
};

function SystemOptionCard(props: {
  icon: LucideIcon;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const Icon = props.icon;
  return (
    <div
      className={cn(
        "flex min-h-[4.75rem] items-center gap-3 rounded-xl border border-dls-border",
        "bg-dls-surface px-3.5 py-3",
        props.disabled && "opacity-60",
      )}
    >
      <IconTile className="size-9 shrink-0">
        <Icon size={16} className="text-dls-secondary" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5 text-dls-text">
          {props.title}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
          {props.description}
        </p>
      </div>
      <Switch
        aria-label={props.title}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={(c) => props.onChange(c === true)}
      />
    </div>
  );
}

export function SystemSettingsView(props: SystemSettingsViewProps) {
  const desktop = isDesktopRuntime();

  // Launch / keep-awake IPC is owned by SystemPrefsRuntime (boot sync +
  // agent-busy linkage). Settings only writes LocalPreferences.
  // Dock / taskbar unread badge is intentionally not exposed (always off).
  const options: OptionCard[] = [
    {
      id: "launch",
      icon: Power,
      title: t("settings.launch_at_login_label"),
      description: t("settings.launch_at_login_desc"),
      checked: props.launchAtLogin,
      disabled: props.busy || !desktop,
      onChange: (v) => void props.onLaunchAtLoginChange(v),
    },
    {
      id: "awake",
      icon: Monitor,
      title: t("settings.keep_system_awake_label"),
      description: t("settings.keep_system_awake_desc"),
      checked: props.keepSystemAwake,
      disabled: props.busy || !desktop,
      onChange: (v) => void props.onKeepSystemAwakeChange(v),
    },
    {
      id: "notify-master",
      icon: Bell,
      title: t("settings.desktop_notifications_master_label"),
      description: t("settings.desktop_notifications_master_desc"),
      checked: props.desktopNotificationsEnabled,
      disabled: props.busy || !desktop,
      onChange: (v) => void props.onDesktopNotificationsEnabledChange(v),
    },
    {
      id: "notify-ready",
      icon: BellRing,
      title: t("settings.agent_ready_notifications_label"),
      description: t("settings.agent_ready_notifications_desc"),
      checked: props.desktopNotifyOnAgentReady,
      disabled:
        props.busy ||
        !desktop ||
        props.desktopNotificationsEnabled !== true,
      onChange: (v) => void props.onDesktopNotifyOnAgentReadyChange(v),
    },
    {
      id: "sound",
      icon: Volume2,
      title: t("settings.sound_notify_label"),
      description: t("settings.sound_notify_desc"),
      checked: props.soundNotifyOnAgentReady,
      disabled: props.busy || !desktop,
      onChange: (v) => void props.onSoundNotifyOnAgentReadyChange(v),
    },
    {
      id: "auto-update",
      icon: RefreshCw,
      title: t("settings.auto_check_updates_label"),
      description: t("settings.auto_check_updates_desc"),
      checked: props.updateAutoCheck,
      disabled: props.busy || !desktop,
      onChange: (v) => void props.onUpdateAutoCheckChange(v),
    },
  ];

  return (
    <LayoutStack>
      <section className="flex w-full max-w-3xl flex-col gap-3">
        <div className="space-y-1">
          <h3 className="text-lg font-medium leading-7 text-dls-text">
            {t("settings.system_options_section_title")}
          </h3>
          <p className="max-w-[52ch] text-sm leading-5 text-dls-secondary">
            {t("settings.system_section_desc")}
          </p>
        </div>

        {!desktop ? (
          <p className="text-sm text-dls-secondary">
            {t("settings.desktop_only_hint")}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {options.map((opt) => (
            <SystemOptionCard
              key={opt.id}
              icon={opt.icon}
              title={opt.title}
              description={opt.description}
              checked={opt.checked}
              disabled={opt.disabled}
              onChange={opt.onChange}
            />
          ))}
        </div>
      </section>
    </LayoutStack>
  );
}
