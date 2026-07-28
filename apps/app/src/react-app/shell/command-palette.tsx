/** @jsxImportSource react */
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { t } from "@/i18n";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTitle,
  CommandEmpty,
  CommandFooter,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, Globe } from "lucide-react";

import { formatShortcut } from "@/lib/format-shortcut";
import { ArtifactIcon } from "../capabilities/artifacts/artifact-icon";
import type { OpenTargetPreview } from "../capabilities/artifacts/open-target";

/** Display label for the command palette chord. */
export const COMMAND_PALETTE_SHORTCUT = formatShortcut(["Mod", "K"]);
export type PaletteItem = {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
  icon?: ReactNode;
  searchText?: string;
  action: () => void;
};

export type AccessibleTargetOption = {
  id: string;
  kind: "url" | "file";
  value: string;
  name: string;
  preview: OpenTargetPreview;
};

type PaletteMode = "root" | "sessions" | "accessible-items";

const commandPaletteClass = {
  header: "flex items-center gap-0",
  backButton: "rounded-xl",
  input: "w-full",
  itemIcon: "mr-2 shrink-0",
  itemBody: "min-w-0 flex-1",
  itemTitle: "truncate font-medium",
  itemDetail: "truncate text-dls-secondary text-xs",
};

export type SessionOption = {
  workspaceId: string;
  sessionId: string;
  title: string;
  workspaceTitle: string;
  updatedAt: number;
  searchText: string;
  isActive: boolean;
};

function targetIcon(target: AccessibleTargetOption) {
  if (target.kind === "url") return <Globe className="size-4 text-primary" />;
  return <ArtifactIcon type={target.preview} name={target.name || target.value} className="size-4" />;
}

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  /** Called when a session row is chosen. */
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  /** Called when "New session" is chosen. */
  onCreateNewSession: () => void;
  /** Called when "Open settings" is chosen. Accepts an optional route to jump straight to a tab. */
  onOpenSettings: (route?: string) => void;
  /** Optional — open a URL in the user's browser. Falls back to window.open. */
  onOpenUrl?: (url: string) => void;
  /** Optional: current session servers/artifacts exposed through Cmd/Ctrl+K. */
  accessibleTargets?: AccessibleTargetOption[];
  onOpenAccessibleTarget?: (target: AccessibleTargetOption) => void;
  onHideAccessibleTarget?: (target: AccessibleTargetOption) => void;
  /** Optional: sessions for the second mode. */
  sessions: SessionOption[];
};

/**
 * React command palette (Cmd/Ctrl+K).
 *
 * - Root mode: "New session", "Open settings", and a link into the Sessions submode.
 * - Sessions submode: fuzzy list of every session across workspaces.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const [mode, setMode] = useState<PaletteMode>("root");

  useEffect(() => {
    if (!props.open) {
      setMode("root");
    }
  }, [props.open]);

  const openUrl = (url: string) => {
    if (props.onOpenUrl) {
      props.onOpenUrl(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  const accessibleTargetCount = props.accessibleTargets?.length ?? 0;

  const rootItems = useMemo<PaletteItem[]>(
    () => [
      {
        id: "new-session",
        title: t("session.cmd_new_session_title"),
        detail: t("session.cmd_new_session_detail"),
        meta: t("session.cmd_new_session_meta"),
        action: () => {
          props.onClose();
          props.onCreateNewSession();
        },
      },
      {
        id: "sessions",
        title: t("session.cmd_sessions_title"),
        detail: t("session.cmd_sessions_detail", undefined, {
          count: props.sessions.length.toLocaleString(),
        }),
        meta: t("session.cmd_sessions_meta"),
        action: () => {
          setMode("sessions");
        },
      },
      {
        id: "accessible-items",
        title: t("session.accessible_items_title"),
        detail:
          accessibleTargetCount > 0
            ? t("session.accessible_items_detail", {
                count: accessibleTargetCount.toLocaleString(),
              })
            : t("session.accessible_items_empty_detail"),
        meta: t("session.accessible_items_meta_session"),
        action: () => {
          setMode("accessible-items");
        },
      },
      {
        id: "open-settings",
        title: t("settings.tab_general"),
        detail: t("settings.tab_description_general"),
        meta: t("session.cmd_settings_meta"),
        action: () => {
          props.onClose();
          props.onOpenSettings();
        },
      },
      // Top-bar shortcuts — these used to be selectable via Cmd+K and were
      // missing after the React port. Each one mirrors one of the icons at
      // the bottom-right of the session surface (documentation / feedback)
      // plus every settings tab the user is likely to reach for.
      {
        id: "open-docs",
        title: t("session.support_docs"),
        meta: t("session.cmd_settings_meta"),
        action: () => {
          props.onClose();
          openUrl("https://onmyagent.dev/docs");
        },
      },
      {
        id: "open-feedback",
        title: t("session.support_feedback"),
        meta: t("session.cmd_settings_meta"),
        action: () => {
          props.onClose();
          openUrl("https://onmyagent.dev/feedback");
        },
      },
      {
        id: "settings-updates",
        title: t("settings.tab_updates"),
        detail: t("settings.tab_description_updates"),
        meta: t("session.cmd_settings_meta"),
        action: () => {
          props.onClose();
          props.onOpenSettings("/settings/updates");
        },
      },
      {
        id: "settings-recovery",
        title: t("settings.tab_recovery"),
        detail: t("settings.tab_description_recovery"),
        meta: t("session.cmd_settings_meta"),
        action: () => {
          props.onClose();
          props.onOpenSettings("/settings/recovery");
        },
      },
    ],
    [accessibleTargetCount, props],
  );

  const sessionItems = useMemo<PaletteItem[]>(
    () =>
      props.sessions.map((item) => ({
        id: `session:${item.workspaceId}:${item.sessionId}`,
        title: item.title,
        detail: item.workspaceTitle,
        meta: item.isActive
          ? t("session.cmd_current_workspace")
          : t("session.cmd_switch"),
        searchText: item.searchText,
        action: () => {
          props.onClose();
          props.onOpenSession(item.workspaceId, item.sessionId);
        },
      })),
    [props],
  );

  const accessibleItems = useMemo<PaletteItem[]>(() => {
    const targets = props.accessibleTargets ?? [];
    return [
      ...targets.map((target) => ({
        id: `accessible:${target.id}`,
        title: target.name || target.value,
        detail: target.value,
        meta:
          target.kind === "url"
            ? t("session.accessible_items_kind_server")
            : t("session.accessible_items_kind_artifact"),
        icon: targetIcon(target),
        searchText:
          `${target.name} ${target.value} ${target.preview}`.toLowerCase(),
        action: () => {
          props.onClose();
          props.onOpenAccessibleTarget?.(target);
        },
      })),
      ...targets.map((target) => ({
        id: `accessible-hide:${target.id}`,
        title: t("session.accessible_items_stop_tracking", {
          name: target.name || target.value,
        }),
        detail: target.value,
        meta: t("common.hide"),
        icon: targetIcon(target),
        searchText:
          `stop tracking hide ${target.name} ${target.value} ${target.preview}`.toLowerCase(),
        action: () => {
          props.onClose();
          props.onHideAccessibleTarget?.(target);
        },
      })),
    ];
  }, [props]);

  const handleEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (mode !== "root") {
        setMode("root");
        return;
      }
      props.onClose();
    }
  };

  const handleBackspace = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "Backspace" &&
      event.currentTarget.value === "" &&
      mode !== "root"
    ) {
      event.preventDefault();
      setMode("root");
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      props.onClose();
    }
  };

  const items =
    mode === "sessions"
      ? sessionItems
      : mode === "accessible-items"
        ? accessibleItems
        : rootItems;

  return (
    <CommandDialog open={props.open} onOpenChange={handleOpenChange}>
      <CommandDialogPopup onKeyDownCapture={handleEscape}>
        <CommandDialogTitle>
          {mode === "sessions"
            ? t("session.palette_title_sessions")
            : mode === "accessible-items"
              ? t("session.accessible_items_title")
              : t("session.palette_title_actions")}
          <span className="ml-2 text-xs font-normal text-dls-secondary">{COMMAND_PALETTE_SHORTCUT}</span>
        </CommandDialogTitle>
        <Command key={mode} items={items}>
          <CommandHeader className={commandPaletteClass.header}>
            {mode !== "root" && (
              <Button
                variant="outline"
                size="icon-sm"
                className={commandPaletteClass.backButton}
                onClick={() => setMode("root")}
              >
                <ChevronLeftIcon className="size-4" />
                <span className="sr-only">{t("common.back")}</span>
              </Button>
            )}
            <CommandInput
              className={commandPaletteClass.input}
              placeholder={
                mode === "sessions"
                  ? t("session.palette_placeholder_sessions")
                  : mode === "accessible-items"
                    ? t("session.accessible_items_placeholder")
                    : t("session.palette_placeholder_actions")
              }
              onKeyDown={handleBackspace}
            />
          </CommandHeader>
          <CommandPanel>
            <CommandEmpty>
              {mode === "accessible-items"
                ? t("session.accessible_items_no_matches")
                : t("session.palette_no_matches")}
            </CommandEmpty>
            <CommandList>
              {(item: PaletteItem) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onClick={item.action}
                >
                  {item.icon ? (
                    <span className={commandPaletteClass.itemIcon}>{item.icon}</span>
                  ) : null}
                  <div className={commandPaletteClass.itemBody}>
                    <div className={commandPaletteClass.itemTitle}>{item.title}</div>
                    {item.detail ? (
                      <div className={commandPaletteClass.itemDetail}>
                        {item.detail}
                      </div>
                    ) : null}
                    {item.searchText ? (
                      <span className="sr-only">{item.searchText}</span>
                    ) : null}
                  </div>
                  {item.meta ? (
                    <CommandShortcut>{item.meta}</CommandShortcut>
                  ) : null}
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <span>{t("session.palette_hint_navigate")}</span>
            <span>{t("session.palette_hint_run")}</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
