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

function actionTitle(id: KeymapActionId): string {
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
  platform: ReturnType<typeof detectKeymapPlatform>;
}) {
  if (!props.accelerator.trim()) {
    return (
      <span className="text-xs text-dls-secondary">
        {t("settings.shortcuts_unbound")}
      </span>
    );
  }
  const groups = acceleratorToKeyGroups(props.accelerator, props.platform);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {groups.map((keys, groupIndex) => (
        <span key={groupIndex} className="inline-flex items-center gap-1">
          {groupIndex > 0 ? (
            <span className="px-0.5 text-2xs text-dls-secondary">
              {t("shortcuts_guide.or")}
            </span>
          ) : null}
          {keys.map((key, keyIndex) => (
            <span key={`${groupIndex}-${keyIndex}-${key}`} className="inline-flex items-center gap-0.5">
              {keyIndex > 0 ? (
                <span className="text-2xs text-dls-secondary">+</span>
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
          className="max-h-[min(32rem,calc(100vh-4rem))] w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-2xl border-dls-border bg-dls-surface p-0 shadow-lg"
          showCloseButton={false}
        >
          <DialogHeader className="gap-1 border-b border-dls-border px-4 pb-3 pt-4 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold text-dls-text">
                  {t("shortcuts_guide.title")}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-5 text-dls-secondary">
                  {t("shortcuts_guide.description")}
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-md text-dls-secondary"
                aria-label={t("common.close")}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </DialogHeader>

          <ul className="max-h-[min(20rem,50vh)] overflow-y-auto px-2 py-1">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 border-b border-dls-border/70 px-2 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 text-sm font-medium text-dls-text">
                  {row.title}
                </span>
                <AcceleratorKeys
                  accelerator={row.accelerator}
                  platform={platform}
                />
              </li>
            ))}
          </ul>

          {props.onConfigure ? (
            <div className="border-t border-dls-border px-4 py-3">
              <Button
                type="button"
                className="w-full"
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
