/** @jsxImportSource react */
/**
 * Home floating “keyboard shortcuts guide” (WorkBuddy-style).
 * Lists product keymap actions with current bindings; CTA opens Settings → Shortcuts.
 */
import { useMemo, useState } from "react";
import { Keyboard, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  DEFAULT_KEYMAP_ACTIONS,
  acceleratorToKeyGroups,
  detectKeymapPlatform,
  resolveAccelerator,
  type KeymapActionId,
} from "../../../../kernel/keymap";
import { useLocal } from "../../../../kernel/local-provider";

const ACTION_TITLE_KEYS = {
  openSettings: "settings.shortcuts_action_openSettings",
  toggleSidebar: "settings.shortcuts_action_toggleSidebar",
  newTask: "settings.shortcuts_action_newTask",
  searchInCurrentTask: "settings.shortcuts_action_searchInCurrentTask",
  sendMessage: "settings.shortcuts_action_sendMessage",
  insertNewline: "settings.shortcuts_action_insertNewline",
  appSnapshot: "settings.shortcuts_action_appSnapshot",
  quickCapture: "settings.shortcuts_action_quickCapture",
} as const satisfies Record<KeymapActionId, string>;

function actionTitle(id: KeymapActionId): string {
  return t(ACTION_TITLE_KEYS[id]);
}

function KbdChip(props: { label: string }) {
  const isWide = props.label.length > 1;
  return (
    <kbd
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-md",
        "border border-dls-border bg-dls-surface-muted",
        "text-sm font-medium leading-none text-dls-text",
        isWide ? "min-w-0 px-2" : "min-w-7 px-1.5",
      )}
    >
      {props.label}
    </kbd>
  );
}

function AcceleratorKeys(props: {
  accelerator: string;
  platform: ReturnType<typeof detectKeymapPlatform>;
}) {
  if (!props.accelerator.trim()) {
    return <span className="text-xs text-dls-secondary">{t("settings.shortcuts_unbound")}</span>;
  }
  const groups = acceleratorToKeyGroups(props.accelerator, props.platform);
  return (
    <span className="inline-flex shrink-0 flex-wrap items-center justify-end gap-x-1 gap-y-1">
      {groups.map((keys, groupIndex) => (
        <span key={groupIndex} className="inline-flex flex-wrap items-center gap-x-1 gap-y-1">
          {groupIndex > 0 ? (
            <span className="px-0.5 text-2xs text-dls-secondary">{t("shortcuts_guide.or")}</span>
          ) : null}
          {keys.map((key, keyIndex) => (
            <span
              key={`${groupIndex}-${keyIndex}-${key}`}
              className="inline-flex items-center gap-1"
            >
              {keyIndex > 0 ? (
                <span className="select-none text-xs font-medium text-dls-secondary" aria-hidden>
                  +
                </span>
              ) : null}
              <KbdChip label={key} />
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function KeyboardShortcutsGuideButton(props: {
  onConfigure?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const local = useLocal();
  const platform = useMemo(() => detectKeymapPlatform(), []);
  const overrides = local.prefs.keymapOverrides ?? {};

  const rows = useMemo(
    () =>
      DEFAULT_KEYMAP_ACTIONS.map((action) => ({
        id: action.id,
        title: actionTitle(action.id),
        accelerator: resolveAccelerator(action.id, overrides, platform),
      })),
    [overrides, platform],
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "mac:titlebar-no-drag size-8 shrink-0 rounded-lg text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
          props.className,
        )}
        title={t("shortcuts_guide.open")}
        aria-label={t("shortcuts_guide.open")}
        onClick={() => setOpen(true)}
      >
        <Keyboard className="size-4" strokeWidth={1.75} />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="w-[min(28rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-2xl border-dls-border bg-dls-surface p-0 sm:max-w-md"
          showCloseButton={false}
        >
          <DialogHeader className="gap-1.5 border-b border-dls-border px-5 pb-4 pt-5 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold text-dls-text">
                  {t("shortcuts_guide.title")}
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-sm leading-6 text-dls-secondary">
                  {t("shortcuts_guide.description")}
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 rounded-md text-dls-secondary"
                aria-label={t("common.close")}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </DialogHeader>

          {/* Fixed short list — no scroll; keep all bindings visible. */}
          <ul className="px-3 py-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 border-b border-dls-border/70 px-2 py-3.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug text-dls-text">
                  {row.title}
                </span>
                <AcceleratorKeys accelerator={row.accelerator} platform={platform} />
              </li>
            ))}
          </ul>

          {props.onConfigure ? (
            <div className="border-t border-dls-border px-5 py-4">
              <Button
                type="button"
                className="h-11 w-full text-sm"
                onClick={() => {
                  setOpen(false);
                  props.onConfigure?.();
                }}
              >
                {t("shortcuts_guide.configure")}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
