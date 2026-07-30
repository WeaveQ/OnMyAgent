/** @jsxImportSource react */
/**
 * System authorizations — security-center style list with status badges.
 * Status is tri-state: granted | denied | unknown (needs confirmation).
 */
import { useEffect, useState, useCallback, useRef } from "react";
import {
  CheckCircle2,
  ExternalLink,
  HardDrive,
  HelpCircle,
  Keyboard,
  Mic,
  MonitorPlay,
  RefreshCw,
  Shield,
  Bell,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { IconTile } from "@/components/ui/action-row";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { desktopBridge } from "../../../../app/lib/desktop";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";
import type {
  SystemPermissionResult,
  SystemPermissionType,
} from "../../../../app/lib/desktop-types";
import { t } from "../../../../i18n";
import { cn } from "@/lib/utils";

export type SystemAuthorizationsViewProps = {
  busy?: boolean;
  desktopNotifyOnAgentReady: boolean;
  onDesktopNotifyOnAgentReadyChange: (
    enabled: boolean,
  ) => void | Promise<void>;
  /**
   * When false, hide the in-page “task completion alerts” switch
   * (e.g. fused System settings page already owns notification toggles).
   */
  showAgentReadyNotifications?: boolean;
};

type PermissionItem = {
  id: SystemPermissionType;
  label: string;
  description: string;
  icon: LucideIcon;
};

type PermissionStatus = "granted" | "denied" | "unknown";

const PERMISSIONS: PermissionItem[] = [
  {
    id: "full-disk-access",
    icon: HardDrive,
    get label() {
      return t("settings.permission_full_disk_label");
    },
    get description() {
      return t("settings.permission_full_disk_desc");
    },
  },
  {
    id: "screen-recording",
    icon: MonitorPlay,
    get label() {
      return t("settings.permission_screen_recording_label");
    },
    get description() {
      return t("settings.permission_screen_recording_desc");
    },
  },
  {
    id: "accessibility",
    icon: Keyboard,
    get label() {
      return t("settings.permission_accessibility_label");
    },
    get description() {
      return t("settings.permission_accessibility_desc");
    },
  },
  {
    id: "microphone",
    icon: Mic,
    get label() {
      return t("settings.permission_microphone_label");
    },
    get description() {
      return t("settings.permission_microphone_desc");
    },
  },
  {
    id: "automation",
    icon: Shield,
    get label() {
      return t("settings.permission_automation_label");
    },
    get description() {
      return t("settings.permission_automation_desc");
    },
  },
  {
    id: "notifications",
    icon: Bell,
    get label() {
      return t("settings.permission_notifications_label");
    },
    get description() {
      return t("settings.permission_notifications_desc");
    },
  },
];

/** macOS-only TCC rows — hidden on Windows/Linux. */
const MAC_ONLY_PERMISSIONS = new Set<SystemPermissionType>([
  "full-disk-access",
  "accessibility",
  "automation",
]);

function permissionsForPlatform(
  platform: string | null | undefined,
): PermissionItem[] {
  if (platform === "windows" || platform === "linux") {
    return PERMISSIONS.filter((item) => !MAC_ONLY_PERMISSIONS.has(item.id));
  }
  return PERMISSIONS;
}

/** Overlay OS Notification.permission onto main-process result. */
function applyNotificationOverlay(
  permissions: SystemPermissionResult["permissions"],
): SystemPermissionResult["permissions"] {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return permissions;
  }
  const next = { ...permissions };
  if (Notification.permission === "granted") {
    next.notifications = "granted";
  } else if (Notification.permission === "denied") {
    next.notifications = "denied";
  } else {
    // "default" — not yet decided; do not treat as denied.
    next.notifications = "unknown";
  }
  return next;
}

type RefreshFeedback = "idle" | "loading" | "success";

const MIN_REFRESH_SPIN_MS = 400;
const REFRESH_SUCCESS_MS = 1600;
const POST_AUTHORIZE_REFRESH_MS = 2500;

export function SystemAuthorizationsView(props: SystemAuthorizationsViewProps) {
  const {
    busy = false,
    desktopNotifyOnAgentReady,
    onDesktopNotifyOnAgentReadyChange,
    showAgentReadyNotifications = true,
  } = props;
  const [result, setResult] = useState<SystemPermissionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshFeedback, setRefreshFeedback] =
    useState<RefreshFeedback>("idle");
  const [opening, setOpening] = useState<SystemPermissionType | null>(null);
  const [hintDialogHint, setHintDialogHint] = useState<string | null>(null);
  /** After user opens System Settings, refresh once when window regains focus. */
  const pendingFocusRefreshRef = useRef(false);

  const checkPermissions = useCallback(
    async (options?: { showSuccess?: boolean }) => {
      const showSuccess = options?.showSuccess === true;
      setLoading(true);
      if (showSuccess) setRefreshFeedback("loading");
      const startedAt = Date.now();
      try {
        const data =
          (await desktopBridge.checkSystemPermissions()) as SystemPermissionResult;
        const permissions = applyNotificationOverlay({ ...data.permissions });
        setResult({ ...data, permissions });
      } catch (e) {
        console.error("Failed to check system permissions:", e);
      } finally {
        const elapsed = Date.now() - startedAt;
        const wait = Math.max(0, MIN_REFRESH_SPIN_MS - elapsed);
        window.setTimeout(() => {
          setLoading(false);
          if (showSuccess) {
            setRefreshFeedback("success");
            window.setTimeout(
              () => setRefreshFeedback("idle"),
              REFRESH_SUCCESS_MS,
            );
          }
        }, wait);
      }
    },
    [],
  );

  useEffect(() => {
    void checkPermissions();
  }, [checkPermissions]);

  // Re-check when user returns from System Settings (focus / visible again).
  useEffect(() => {
    const maybeRefresh = () => {
      if (!pendingFocusRefreshRef.current) return;
      pendingFocusRefreshRef.current = false;
      void checkPermissions();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkPermissions]);

  const handleAuthorize = async (type: SystemPermissionType) => {
    setOpening(type);
    try {
      // Notifications: first ask the browser/Electron prompt when undecided.
      if (
        type === "notifications" &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        const perm = await Notification.requestPermission().catch(
          () => "default" as NotificationPermission,
        );
        if (perm === "granted") {
          void checkPermissions();
          return;
        }
        // denied / still default → fall through to open System Settings
      }

      const response = (await desktopBridge.openSystemPermissionSettings(
        type,
      )) as { success: boolean; hint?: string | null; error?: string };
      if (response.hint) {
        setHintDialogHint(response.hint);
      }
      pendingFocusRefreshRef.current = true;
      window.setTimeout(
        () => void checkPermissions(),
        POST_AUTHORIZE_REFRESH_MS,
      );
    } catch (e) {
      console.error("Failed to open system preferences:", e);
    } finally {
      setOpening(null);
    }
  };

  const items = permissionsForPlatform(result?.platform);

  return (
    <LayoutStack>
      <section className="flex w-full max-w-3xl flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="inline-flex items-center gap-2 text-lg font-medium leading-7 text-dls-text">
              <Shield className="size-5 text-dls-secondary" aria-hidden />
              {t("settings.system_authorizations")}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="size-4 cursor-help text-dls-secondary hover:text-dls-text" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("settings.permission_revoke_hint")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </h3>
            <p className="max-w-[52ch] text-sm leading-5 text-dls-secondary">
              {t("settings.system_authorizations_description")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-dls-secondary"
            onClick={() => void checkPermissions({ showSuccess: true })}
            disabled={loading || refreshFeedback === "success"}
            aria-label={
              refreshFeedback === "success"
                ? t("settings.permission_refresh_success")
                : loading
                  ? t("settings.permission_checking")
                  : t("settings.permission_refresh")
            }
            title={
              refreshFeedback === "success"
                ? t("settings.permission_refresh_success")
                : t("settings.permission_refresh")
            }
          >
            {refreshFeedback === "success" ? (
              <CheckCircle2 className="size-4 text-dls-accent" />
            ) : (
              <RefreshCw
                className={loading ? "size-4 animate-spin" : "size-4"}
              />
            )}
          </Button>
        </div>

        <div
          className={cn(
            "overflow-hidden rounded-xl border border-dls-border bg-dls-surface",
            "divide-y divide-dls-border",
          )}
        >
          {items.map((perm) => {
            const status = (result?.permissions[perm.id] ??
              "unknown") as PermissionStatus;
            const isGranted = status === "granted";
            const isUnknown = status === "unknown";
            const isOpening = opening === perm.id;
            const Icon = perm.icon;

            return (
              <div
                key={perm.id}
                className="flex items-center gap-3 px-4 py-3.5"
              >
                <IconTile border className="size-9 shrink-0">
                  <Icon size={16} className="text-dls-secondary" />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-5 text-dls-text">
                    {perm.label}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
                    {perm.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!result || loading ? (
                    <StatusBadge tone="neutral" size="sm">
                      {t("settings.permission_checking")}
                    </StatusBadge>
                  ) : isGranted ? (
                    <StatusBadge tone="success" size="sm">
                      {t("settings.permission_status_granted")}
                    </StatusBadge>
                  ) : (
                    <>
                      {isUnknown ? (
                        <StatusBadge tone="warning" size="sm">
                          {t("settings.permission_status_unknown")}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="danger" size="sm">
                          {t("settings.permission_status_denied")}
                        </StatusBadge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 whitespace-nowrap"
                        onClick={() => void handleAuthorize(perm.id)}
                        disabled={isOpening || busy}
                      >
                        {isOpening ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <ExternalLink className="size-3.5" />
                        )}
                        <span className="leading-none">
                          {isOpening
                            ? t("settings.permission_opening")
                            : t("settings.permission_authorize")}
                        </span>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {showAgentReadyNotifications ? (
        <SettingsPageSection
          title={t("settings.notifications_section_title")}
          description={t("settings.notifications_section_desc")}
        >
          <SettingsBlock>
            <SettingsBlockRow
              title={t("settings.agent_ready_notifications_label")}
              description={t("settings.agent_ready_notifications_desc")}
              actions={
                <Switch
                  aria-label={t("settings.agent_ready_notifications_label")}
                  checked={desktopNotifyOnAgentReady}
                  disabled={busy}
                  onCheckedChange={(checked) => {
                    void (async () => {
                      if (checked) {
                        if (
                          typeof window !== "undefined" &&
                          "Notification" in window &&
                          Notification.permission === "default"
                        ) {
                          await Notification.requestPermission().catch(
                            () => undefined,
                          );
                        }
                        void checkPermissions();
                      }
                      await onDesktopNotifyOnAgentReadyChange(checked === true);
                    })();
                  }}
                />
              }
            />
          </SettingsBlock>
        </SettingsPageSection>
      ) : null}

      <Dialog
        open={Boolean(hintDialogHint)}
        onOpenChange={(open) => !open && setHintDialogHint(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-dls-accent" />
                {t("settings.permission_settings_opened")}
              </div>
            </DialogTitle>
            <DialogDescription className="pt-3">
              {t("settings.permission_follow_steps")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm leading-relaxed text-dls-text">
              {hintDialogHint}
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setHintDialogHint(null);
                pendingFocusRefreshRef.current = false;
                void checkPermissions();
              }}
            >
              {t("settings.permission_done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LayoutStack>
  );
}
