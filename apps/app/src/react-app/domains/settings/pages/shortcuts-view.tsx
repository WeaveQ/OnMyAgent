/** @jsxImportSource react */
/**
 * Shortcuts settings — table layout (command / keybinding / actions)
 * aligned with common desktop “keyboard shortcuts” panels.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Undo2 } from "lucide-react";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import {
  DEFAULT_KEYMAP_ACTIONS,
  acceleratorToKeyGroups,
  detectKeymapPlatform,
  eventToAccelerator,
  resolveAccelerator,
  type KeymapActionId,
} from "../keymap";
import { LayoutStack } from "../settings-layout";
import { cn } from "@/lib/utils";

export type ShortcutsViewProps = {
  busy?: boolean;
  keymapOverrides: Record<string, string>;
  platform?: "macos" | "windows" | "linux" | "unknown";
  onKeymapOverridesChange: (next: Record<string, string>) => void;
};

function actionTitle(id: KeymapActionId) {
  return t(
    `settings.shortcuts_action_${id}` as "settings.shortcuts_action_openSettings",
  );
}

function KbdChip(props: { label: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md",
        "border border-dls-border bg-dls-surface-muted px-1.5",
        "text-2xs font-medium tabular-nums text-dls-text",
      )}
    >
      {props.label}
    </kbd>
  );
}

function AcceleratorKeys(props: {
  accelerator: string;
  platform: "macos" | "windows" | "linux" | "unknown";
  emptyLabel?: string;
}) {
  if (!props.accelerator.trim()) {
    return (
      <span className="text-xs text-dls-secondary">
        {props.emptyLabel ?? "—"}
      </span>
    );
  }
  const groups = acceleratorToKeyGroups(props.accelerator, props.platform);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {groups.map((keys, gi) => (
        <span key={gi} className="inline-flex items-center gap-1">
          {gi > 0 ? (
            <span className="px-0.5 text-2xs text-dls-secondary">/</span>
          ) : null}
          {keys.map((key, ki) => (
            <KbdChip key={`${gi}-${ki}-${key}`} label={key} />
          ))}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsView(props: ShortcutsViewProps) {
  const platform = props.platform ?? detectKeymapPlatform();
  const [query, setQuery] = useState("");
  const [recordingId, setRecordingId] = useState<KeymapActionId | null>(null);

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
        platform,
      ).toLowerCase();
      return title.includes(q) || accel.includes(q);
    });
  }, [query, props.keymapOverrides, platform]);

  const total = DEFAULT_KEYMAP_ACTIONS.length;
  const hasOverrides = Object.keys(props.keymapOverrides ?? {}).length > 0;

  const clearBinding = (id: KeymapActionId) => {
    // Empty string override = unbound (display —); delete restores default.
    props.onKeymapOverridesChange({
      ...props.keymapOverrides,
      [id]: "",
    });
    setRecordingId(null);
  };

  const resetOne = (id: KeymapActionId) => {
    const next = { ...props.keymapOverrides };
    delete next[id];
    props.onKeymapOverridesChange(next);
    setRecordingId(null);
  };

  const captureKey = (id: KeymapActionId, event: KeyboardEvent) => {
    if (recordingId !== id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setRecordingId(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const next = eventToAccelerator(event.nativeEvent);
    if (!next) return;
    props.onKeymapOverridesChange({
      ...props.keymapOverrides,
      [id]: next,
    });
    setRecordingId(null);
  };

  return (
    <LayoutStack>
      <div className="flex w-full max-w-3xl flex-col gap-3">
        <p className="text-xs text-dls-secondary">
          {t("settings.shortcuts_count", { count: total })}
        </p>

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
            className="shrink-0"
            disabled={props.busy || !hasOverrides}
            onClick={() => {
              props.onKeymapOverridesChange({});
              setRecordingId(null);
            }}
          >
            {t("settings.shortcuts_reset_all")}
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
          <div
            className={cn(
              "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5.5rem] gap-2",
              "border-b border-dls-border bg-dls-surface-muted/50 px-4 py-2",
              "text-xs font-medium text-dls-secondary",
            )}
          >
            <span>{t("settings.shortcuts_col_command")}</span>
            <span>{t("settings.shortcuts_col_binding")}</span>
            <span className="text-right">{t("settings.shortcuts_col_actions")}</span>
          </div>

          <div className="max-h-[min(32rem,60vh)] overflow-y-auto divide-y divide-dls-border">
            {filtered.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-dls-secondary">
                {t("settings.shortcuts_empty")}
              </p>
            ) : (
              filtered.map((action) => {
                const accel = resolveAccelerator(
                  action.id,
                  props.keymapOverrides,
                  platform,
                );
                const overridden = Object.prototype.hasOwnProperty.call(
                  props.keymapOverrides ?? {},
                  action.id,
                );
                const isRecording = recordingId === action.id;
                const isCleared = overridden && accel === "";

                return (
                  <div
                    key={action.id}
                    className={cn(
                      "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5.5rem] items-center gap-2 px-4 py-2.5",
                      "transition-colors",
                      isRecording
                        ? "bg-dls-list-selected"
                        : "hover:bg-dls-list-hover",
                    )}
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-dls-text">
                      {actionTitle(action.id)}
                    </span>

                    <button
                      type="button"
                      className={cn(
                        "min-w-0 justify-self-start rounded-md px-1 py-0.5 text-left",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent",
                        isRecording && "ring-2 ring-dls-accent/50",
                      )}
                      disabled={props.busy}
                      aria-label={
                        isRecording
                          ? t("settings.shortcuts_recording_hint")
                          : t("settings.shortcuts_record_hint")
                      }
                      onClick={() =>
                        setRecordingId(isRecording ? null : action.id)
                      }
                      onKeyDown={(event) => captureKey(action.id, event)}
                    >
                      {isRecording ? (
                        <span className="text-xs font-medium text-dls-accent">
                          {t("settings.shortcuts_recording_hint")}
                        </span>
                      ) : (
                        <AcceleratorKeys
                          accelerator={isCleared ? "" : accel}
                          platform={platform}
                          emptyLabel={t("settings.shortcuts_unbound")}
                        />
                      )}
                    </button>

                    <div className="flex items-center justify-end gap-0.5">
                      {overridden && !isCleared ? (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="text-dls-secondary"
                          disabled={props.busy}
                          title={t("settings.shortcuts_reset_one")}
                          aria-label={t("settings.shortcuts_reset_one")}
                          onClick={() => resetOne(action.id)}
                        >
                          <Undo2 className="size-3.5" />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="text-dls-secondary"
                        disabled={props.busy || (!accel && !overridden)}
                        title={t("settings.shortcuts_clear")}
                        aria-label={t("settings.shortcuts_clear")}
                        onClick={() => clearBinding(action.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </LayoutStack>
  );
}
