/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, RotateCcw } from "lucide-react";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import {
  DEFAULT_KEYMAP_ACTIONS,
  acceleratorToKeyGroups,
  eventToAccelerator,
  resolveAccelerator,
  type KeymapActionId,
  type KeymapGroupId,
} from "../keymap";
import { SettingsBlock } from "../settings-section";
import { LayoutStack } from "../settings-layout";
import { cn } from "@/lib/utils";

export type ShortcutsViewProps = {
  busy?: boolean;
  keymapOverrides: Record<string, string>;
  platform?: "macos" | "windows" | "linux" | "unknown";
  onKeymapOverridesChange: (next: Record<string, string>) => void;
};

const GROUP_ORDER: KeymapGroupId[] = ["general", "task", "session", "global"];

function groupTitle(group: KeymapGroupId) {
  switch (group) {
    case "general":
      return t("settings.shortcuts_group_general");
    case "task":
      return t("settings.shortcuts_group_task");
    case "session":
      return t("settings.shortcuts_group_session");
    case "global":
      return t("settings.shortcuts_group_global");
  }
}

function actionTitle(id: KeymapActionId) {
  return t(
    `settings.shortcuts_action_${id}` as "settings.shortcuts_action_openSettings",
  );
}

function KbdChip(props: {
  label: string;
  size?: "sm" | "lg";
  muted?: boolean;
}) {
  const large = props.size === "lg";
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-dls-border bg-dls-surface-muted font-medium text-dls-text shadow-[0_1px_0_0_var(--dls-border)]",
        large
          ? "h-10 min-w-10 px-2.5 text-base"
          : "h-6 px-1.5 text-2xs tabular-nums",
        props.muted && "opacity-60",
      )}
    >
      {props.label}
    </kbd>
  );
}

function AcceleratorKeys(props: {
  accelerator: string;
  platform: "macos" | "windows" | "linux" | "unknown";
  size?: "sm" | "lg";
}) {
  const groups = acceleratorToKeyGroups(props.accelerator, props.platform);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {groups.map((keys, gi) => (
        <span key={gi} className="inline-flex items-center gap-1">
          {gi > 0 ? (
            <span className="px-0.5 text-2xs text-dls-secondary">/</span>
          ) : null}
          {keys.map((key, ki) => (
            <KbdChip key={`${gi}-${ki}-${key}`} label={key} size={props.size} />
          ))}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsView(props: ShortcutsViewProps) {
  const platform = props.platform ?? "macos";
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<KeymapActionId>("openSettings");
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void desktopBridge
      .setKeymapAcceleratorOverrides(props.keymapOverrides ?? {})
      .catch(() => undefined);
  }, [props.keymapOverrides]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DEFAULT_KEYMAP_ACTIONS.filter((action) => {
      if (!q) return true;
      const title = actionTitle(action.id).toLowerCase();
      const accel = resolveAccelerator(
        action.id,
        props.keymapOverrides,
      ).toLowerCase();
      return title.includes(q) || accel.includes(q);
    });
  }, [query, props.keymapOverrides]);

  const selectedAccel = resolveAccelerator(selected, props.keymapOverrides);
  const hasOverrides = Object.keys(props.keymapOverrides ?? {}).length > 0;
  const selectedIsOverridden = Boolean(
    props.keymapOverrides?.[selected]?.trim(),
  );

  return (
    <LayoutStack>
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dls-secondary"
              aria-hidden
            />
            <Input
              variant="dls"
              className="h-9 w-full pl-8"
              placeholder={t("settings.shortcuts_search_placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("settings.shortcuts_search_placeholder")}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            disabled={props.busy || !hasOverrides}
            onClick={() => props.onKeymapOverridesChange({})}
          >
            <RotateCcw className="size-3.5" />
            {t("settings.shortcuts_reset_defaults")}
          </Button>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_15.5rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {GROUP_ORDER.map((group) => {
              const items = filtered.filter((a) => a.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="flex flex-col gap-2">
                  <p className="px-1 text-xs font-medium tracking-wide text-dls-secondary">
                    {groupTitle(group)}
                  </p>
                  <SettingsBlock>
                    {items.map((action) => {
                      const accel = resolveAccelerator(
                        action.id,
                        props.keymapOverrides,
                      );
                      const active = selected === action.id;
                      return (
                        <button
                          key={action.id}
                          type="button"
                          data-slot="settings-block-row"
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dls-accent",
                            active
                              ? "bg-dls-list-selected"
                              : "hover:bg-dls-list-hover",
                          )}
                          onClick={() => {
                            setSelected(action.id);
                            setRecording(false);
                          }}
                        >
                          <span
                            className={cn(
                              "min-w-0 truncate text-sm font-medium",
                              active ? "text-dls-text" : "text-dls-text",
                            )}
                          >
                            {actionTitle(action.id)}
                          </span>
                          <AcceleratorKeys
                            accelerator={accel}
                            platform={platform}
                            size="sm"
                          />
                        </button>
                      );
                    })}
                  </SettingsBlock>
                </div>
              );
            })}
            {filtered.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-dls-secondary">
                {t("settings.shortcuts_search_placeholder")}
              </p>
            ) : null}
          </div>

          <aside className="lg:sticky lg:top-4">
            <div className="flex flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
              <div className="border-b border-dls-border px-4 py-3">
                <p className="truncate text-sm font-medium text-dls-text">
                  {actionTitle(selected)}
                </p>
                <p className="mt-0.5 text-xs text-dls-secondary">
                  {groupTitle(
                    DEFAULT_KEYMAP_ACTIONS.find((a) => a.id === selected)
                      ?.group ?? "general",
                  )}
                </p>
              </div>

              <div className="flex flex-col items-center gap-4 px-4 py-6">
                <button
                  type="button"
                  className={cn(
                    "flex w-full min-h-[5.5rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-3 py-4 transition-colors",
                    recording
                      ? "border-dls-accent bg-dls-accent/10 ring-2 ring-dls-accent/40"
                      : "border-dls-border bg-dls-surface-muted hover:border-dls-border-strong hover:bg-dls-hover",
                  )}
                  disabled={props.busy}
                  onClick={() => setRecording(true)}
                  onBlur={() => {
                    // Keep recording until key captured or explicit cancel via reselect
                  }}
                  onKeyDown={(event) => {
                    if (!recording) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setRecording(false);
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    const next = eventToAccelerator(event.nativeEvent);
                    if (!next) return;
                    props.onKeymapOverridesChange({
                      ...props.keymapOverrides,
                      [selected]: next,
                    });
                    setRecording(false);
                  }}
                >
                  <AcceleratorKeys
                    accelerator={selectedAccel}
                    platform={platform}
                    size="lg"
                  />
                  <span
                    className={cn(
                      "text-xs",
                      recording
                        ? "font-medium text-dls-accent"
                        : "text-dls-secondary",
                    )}
                  >
                    {recording
                      ? t("settings.shortcuts_recording_hint")
                      : t("settings.shortcuts_record_hint")}
                  </span>
                </button>

                {selectedIsOverridden ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="w-full text-dls-secondary"
                    disabled={props.busy}
                    onClick={() => {
                      const next = { ...props.keymapOverrides };
                      delete next[selected];
                      props.onKeymapOverridesChange(next);
                      setRecording(false);
                    }}
                  >
                    {t("settings.shortcuts_reset_one")}
                  </Button>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </LayoutStack>
  );
}
