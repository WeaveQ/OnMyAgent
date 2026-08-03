/** @jsxImportSource react */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { User } from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ACCOUNT_AVATAR_COLORS,
  ACCOUNT_AVATAR_EMOJIS,
  accountAvatarColorHex,
  accountAvatarInitial,
  patchAccountAvatarPrefs,
  readAccountAvatarPrefs,
  subscribeAccountAvatarPrefs,
  type AccountAvatarMode,
  type AccountAvatarPrefs,
} from "./account-avatar-prefs";

export function useAccountAvatarPrefs(): [
  AccountAvatarPrefs,
  (patch: Partial<AccountAvatarPrefs>) => void,
] {
  const [prefs, setPrefs] = useState<AccountAvatarPrefs>(() =>
    readAccountAvatarPrefs(),
  );
  useEffect(() => subscribeAccountAvatarPrefs(() => setPrefs(readAccountAvatarPrefs())), []);
  const update = useCallback((patch: Partial<AccountAvatarPrefs>) => {
    setPrefs(patchAccountAvatarPrefs(patch));
  }, []);
  return [prefs, update];
}

function AccountAvatarFace(props: {
  prefs: AccountAvatarPrefs;
  displayName: string;
  sizeClass: string;
  textClass: string;
  className?: string;
}) {
  const initial = accountAvatarInitial(props.displayName);
  const showEmoji = props.prefs.mode === "emoji" && props.prefs.emoji;
  // Prefer inline hex so swatches/avatar stay visible even if Tailwind
  // does not emit every pastel utility used in ACCOUNT_AVATAR_COLORS.
  const bg = accountAvatarColorHex(props.prefs.colorId);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-dls-text",
        props.sizeClass,
        props.className,
      )}
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      {showEmoji ? (
        <span className={cn("leading-none", props.textClass)}>{props.prefs.emoji}</span>
      ) : initial ? (
        <span className={cn("font-semibold leading-none", props.textClass)}>{initial}</span>
      ) : (
        <User className="size-[55%] opacity-70" strokeWidth={2} />
      )}
    </span>
  );
}

export function AccountAvatarEditor(props: {
  prefs: AccountAvatarPrefs;
  displayName: string;
  onChange: (patch: Partial<AccountAvatarPrefs>) => void;
  /** Compact for account menu popover; full for settings. */
  density?: "compact" | "comfortable";
  /** Hide the subtitle under the name (section already explains). */
  hideHint?: boolean;
}) {
  const density = props.density ?? "comfortable";
  const comfortable = density === "comfortable";
  const setMode = (mode: AccountAvatarMode) => props.onChange({ mode });

  return (
    <div
      className={cn(
        "flex flex-col",
        comfortable ? "gap-5" : "gap-2.5",
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={cn("flex items-center", comfortable ? "gap-3.5" : "gap-3")}>
        <AccountAvatarFace
          prefs={props.prefs}
          displayName={props.displayName}
          sizeClass={comfortable ? "size-12" : "size-10"}
          textClass={comfortable ? "text-xl" : "text-lg"}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-dls-text">
            {props.displayName || t("account_menu.avatar_unnamed")}
          </div>
          {props.hideHint ? null : (
            <div className="text-xs text-dls-secondary">
              {t("account_menu.avatar_hint")}
            </div>
          )}
        </div>
      </div>

      <div className={cn(comfortable && "space-y-2")}>
        <div className="text-xs font-medium text-dls-secondary">
          {t("account_menu.avatar_bg")}
        </div>
        <div className={cn("flex flex-wrap", comfortable ? "gap-2" : "gap-1.5")}>
          {ACCOUNT_AVATAR_COLORS.map((color) => {
            const selected = props.prefs.colorId === color.id;
            return (
              <button
                key={color.id}
                type="button"
                title={color.id}
                aria-label={t("account_menu.avatar_bg")}
                aria-pressed={selected}
                className={cn(
                  "shrink-0 rounded-full border border-black/5 ring-offset-2 ring-offset-dls-surface transition-shadow dark:border-white/10",
                  comfortable ? "size-7" : "size-6",
                  selected
                    ? "ring-2 ring-dls-accent"
                    : "hover:ring-2 hover:ring-dls-border-strong",
                )}
                style={{ backgroundColor: color.hex }}
                onClick={() => props.onChange({ colorId: color.id })}
              />
            );
          })}
        </div>
      </div>

      <div className={cn(comfortable && "space-y-2")}>
        <div className="text-xs font-medium text-dls-secondary">
          {t("account_menu.avatar_icon")}
        </div>
        <div
          className={cn(
            "flex",
            comfortable ? "flex-row flex-wrap gap-x-4 gap-y-1" : "flex-col gap-1",
          )}
        >
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-0.5 py-1 text-sm text-dls-text hover:bg-dls-hover">
            <input
              type="radio"
              name="account-avatar-mode"
              className="size-3.5 accent-[var(--dls-accent)]"
              checked={props.prefs.mode === "initial"}
              onChange={() => setMode("initial")}
            />
            <span>{t("account_menu.avatar_mode_initial")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-0.5 py-1 text-sm text-dls-text hover:bg-dls-hover">
            <input
              type="radio"
              name="account-avatar-mode"
              className="size-3.5 accent-[var(--dls-accent)]"
              checked={props.prefs.mode === "emoji"}
              onChange={() => setMode("emoji")}
            />
            <span>Emoji</span>
          </label>
        </div>
      </div>

      {props.prefs.mode === "emoji" ? (
        <div
          className={cn(
            "grid overflow-y-auto rounded-lg border border-dls-border bg-dls-surface-muted/40",
            comfortable
              ? "max-h-52 grid-cols-9 gap-1.5 p-2.5"
              : "max-h-36 grid-cols-8 gap-1 p-1.5",
          )}
        >
          {ACCOUNT_AVATAR_EMOJIS.map((emoji) => {
            const selected = props.prefs.emoji === emoji;
            return (
              <button
                key={emoji}
                type="button"
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-base leading-none transition-colors",
                  selected
                    ? "bg-dls-surface ring-1 ring-dls-accent"
                    : "hover:bg-dls-hover",
                )}
                onClick={() => props.onChange({ emoji, mode: "emoji" })}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Circular avatar. When `editable`, click opens a WorkBuddy-style picker.
 */
export function AccountUserAvatar(props: {
  displayName: string;
  editable?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Extra node after the face (e.g. name label in a row). */
  trailing?: ReactNode;
}) {
  const [prefs, updatePrefs] = useAccountAvatarPrefs();
  const [open, setOpen] = useState(false);
  const size = props.size ?? "md";
  const sizeClass =
    size === "sm" ? "size-7" : size === "lg" ? "size-11" : "size-8";
  const textClass =
    size === "sm" ? "text-sm" : size === "lg" ? "text-xl" : "text-base";

  const face = (
    <AccountAvatarFace
      prefs={prefs}
      displayName={props.displayName}
      sizeClass={sizeClass}
      textClass={textClass}
      className={cn(
        props.editable &&
          "cursor-pointer ring-offset-1 ring-offset-dls-surface transition-shadow hover:ring-2 hover:ring-dls-border-strong",
        props.className,
      )}
    />
  );

  if (!props.editable) {
    return (
      <span
        className={cn(
          "inline-flex min-w-0 flex-1 items-center gap-2.5",
          props.className,
        )}
      >
        {face}
        {props.trailing}
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="mac:titlebar-no-drag rounded-full outline-none focus-visible:ring-2 focus-visible:ring-dls-accent"
              title={t("account_menu.avatar_edit")}
              aria-label={t("account_menu.avatar_edit")}
              onPointerDown={(event) => {
                // Keep parent account dropdown open while opening the picker.
                event.stopPropagation();
              }}
            >
              {face}
            </button>
          }
        />
        <PopoverContent
          align="start"
          side="right"
          sideOffset={10}
          className="w-[min(18.5rem,calc(100vw-2rem))] p-3"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <AccountAvatarEditor
            prefs={prefs}
            displayName={props.displayName}
            onChange={updatePrefs}
            density="compact"
          />
        </PopoverContent>
      </Popover>
      {props.trailing}
    </span>
  );
}
