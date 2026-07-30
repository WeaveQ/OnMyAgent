/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import {
  DEFAULT_KEYMAP_ACTIONS,
  eventToAccelerator,
  formatAcceleratorForDisplay,
  resolveAccelerator,
  type KeymapActionId,
  type KeymapGroupId,
} from "../keymap";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
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
  return t(`settings.shortcuts_action_${id}` as "settings.shortcuts_action_openSettings");
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
      const accel = resolveAccelerator(action.id, props.keymapOverrides).toLowerCase();
      return title.includes(q) || accel.includes(q);
    });
  }, [query, props.keymapOverrides]);

  const selectedAccel = resolveAccelerator(selected, props.keymapOverrides);

  return (
    <LayoutStack>
      <SettingsPageSection
        title={t("settings.tab_shortcuts")}
        description={t("settings.tab_description_shortcuts")}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            variant="dls"
            className="h-9 max-w-sm"
            placeholder={t("settings.shortcuts_search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("settings.shortcuts_search_placeholder")}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.busy}
            onClick={() => props.onKeymapOverridesChange({})}
          >
            {t("settings.shortcuts_reset_defaults")}
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
          <div className="space-y-4">
            {GROUP_ORDER.map((group) => {
              const items = filtered.filter((a) => a.group === group);
              if (items.length === 0) return null;
              return (
                <SettingsBlock key={group}>
                  <p className="px-1 pb-2 text-xs font-medium text-dls-secondary">
                    {groupTitle(group)}
                  </p>
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
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                          active
                            ? "bg-dls-list-selected text-dls-text"
                            : "hover:bg-dls-hover text-dls-text",
                        )}
                        onClick={() => {
                          setSelected(action.id);
                          setRecording(false);
                        }}
                      >
                        <span className="font-medium">{actionTitle(action.id)}</span>
                        <span className="shrink-0 font-mono text-xs text-dls-secondary">
                          {formatAcceleratorForDisplay(accel, platform)}
                        </span>
                      </button>
                    );
                  })}
                </SettingsBlock>
              );
            })}
          </div>

          <SettingsBlock>
            <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
              <p className="text-sm font-medium text-dls-text">
                {actionTitle(selected)}
              </p>
              <button
                type="button"
                className={cn(
                  "min-h-16 w-full rounded-xl border border-dls-border bg-dls-surface px-4 py-3 font-mono text-lg tracking-wide text-dls-text",
                  recording && "ring-2 ring-dls-accent",
                )}
                disabled={props.busy}
                onClick={() => setRecording(true)}
                onKeyDown={(event) => {
                  if (!recording) return;
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
                {formatAcceleratorForDisplay(selectedAccel, platform)}
              </button>
              <p className="text-xs text-dls-secondary">
                {t("settings.shortcuts_record_hint")}
              </p>
            </div>
          </SettingsBlock>
        </div>
      </SettingsPageSection>
    </LayoutStack>
  );
}
