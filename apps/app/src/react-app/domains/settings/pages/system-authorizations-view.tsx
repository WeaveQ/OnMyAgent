/** @jsxImportSource react */
import { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  RefreshCw,
} from "lucide-react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

export type SystemAuthorizationsViewProps = {
  busy?: boolean;
  desktopNotifyOnAgentReady: boolean;
  onDesktopNotifyOnAgentReadyChange: (
    enabled: boolean,
  ) => void | Promise<void>;
};

type PermissionItem = {
  id: SystemPermissionType;
  label: string;
  description: string;
};

const PERMISSIONS: PermissionItem[] = [
  {
    id: "full-disk-access",
    get label() {
      return t("settings.permission_full_disk_label");
    },
    get description() {
      return t("settings.permission_full_disk_desc");
    },
  },
  {
    id: "accessibility",
    get label() {
      return t("settings.permission_accessibility_label");
    },
    get description() {
      return t("settings.permission_accessibility_desc");
    },
  },
  {
    id: "automation",
    get label() {
      return t("settings.permission_automation_label");
    },
    get description() {
      return t("settings.permission_automation_desc");
    },
  },
  {
    id: "notifications",
    get label() {
      return t("settings.permission_notifications_label");
    },
    get description() {
      return t("settings.permission_notifications_desc");
    },
  },
];

type RefreshFeedback = "idle" | "loading" | "success";

const MIN_REFRESH_SPIN_MS = 400;
const REFRESH_SUCCESS_MS = 1600;

export function SystemAuthorizationsView(props: SystemAuthorizationsViewProps) {
  const {
    busy = false,
    desktopNotifyOnAgentReady,
    onDesktopNotifyOnAgentReadyChange,
  } = props;
  const [result, setResult] = useState<SystemPermissionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshFeedback, setRefreshFeedback] =
    useState<RefreshFeedback>("idle");
  const [opening, setOpening] = useState<SystemPermissionType | null>(null);
  const [hintDialogHint, setHintDialogHint] = useState<string | null>(null);

  const checkPermissions = useCallback(
    async (options?: { showSuccess?: boolean }) => {
      const showSuccess = options?.showSuccess === true;
      setLoading(true);
      if (showSuccess) setRefreshFeedback("loading");
      const startedAt = Date.now();
      try {
        const data =
          (await desktopBridge.checkSystemPermissions()) as SystemPermissionResult;
        const permissions = { ...data.permissions };

        // Detect notification permission in the renderer (Web Notification API).
        if (
          data.platform === "macos" &&
          typeof window !== "undefined" &&
          "Notification" in window
        ) {
          const notifPerm = Notification.permission;
          if (notifPerm === "granted") {
            permissions.notifications = "granted";
          } else if (notifPerm === "denied") {
            permissions.notifications = "denied";
          } else {
            permissions.notifications = "denied";
          }
        }

        setResult({ ...data, permissions });

        if (showSuccess) {
          const elapsed = Date.now() - startedAt;
          if (elapsed < MIN_REFRESH_SPIN_MS) {
            await new Promise((resolve) =>
              setTimeout(resolve, MIN_REFRESH_SPIN_MS - elapsed),
            );
          }
          setRefreshFeedback("success");
        }
      } catch (e) {
        console.error("Failed to check system permissions:", e);
        if (showSuccess) setRefreshFeedback("idle");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void checkPermissions();
  }, [checkPermissions]);

  useEffect(() => {
    if (refreshFeedback !== "success") return;
    const timer = setTimeout(
      () => setRefreshFeedback("idle"),
      REFRESH_SUCCESS_MS,
    );
    return () => clearTimeout(timer);
  }, [refreshFeedback]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void checkPermissions(), 200);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", scheduleRefresh);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", scheduleRefresh);
    };
  }, [checkPermissions]);

  const handleAuthorize = async (type: SystemPermissionType) => {
    setOpening(type);
    try {
      if (
        type === "notifications" &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        await Notification.requestPermission().catch(() => undefined);
      }
      const response = (await desktopBridge.openSystemPermissionSettings(
        type,
      )) as { success: boolean; hint?: string | null; error?: string };
      if (response.hint) {
        setHintDialogHint(response.hint);
      }
      setTimeout(() => void checkPermissions(), 3000);
    } catch (e) {
      console.error("Failed to open system preferences:", e);
    } finally {
      setOpening(null);
    }
  };

  const getStatusLabel = (type: SystemPermissionType) => {
    if (!result) return t("settings.permission_checking");
    const status = result.permissions[type];
    switch (status) {
      case "granted":
        return t("settings.permission_authorized");
      case "denied":
        return t("settings.permission_authorize");
      case "unknown":
      default:
        return t("settings.system_authorizations_go_configure");
    }
  };

  return (
    <LayoutStack>
      <SettingsPageSection
        title={
          <span className="inline-flex items-center gap-2">
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
          </span>
        }
        description={t("settings.system_authorizations_description")}
        actions={
          <span className="inline-flex items-center gap-1.5">
            {refreshFeedback === "success" ? (
              <span className="text-xs text-dls-accent">
                {t("settings.permission_refresh_success")}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-dls-secondary"
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
          </span>
        }
      >
        <SettingsBlock>
          {PERMISSIONS.map((perm) => {
            const status = result?.permissions[perm.id];
            const isGranted = status === "granted";
            const isOpening = opening === perm.id;

            return (
              <SettingsBlockRow
                key={perm.id}
                title={perm.label}
                description={perm.description}
                actions={
                  isGranted ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-dls-accent">
                      <CheckCircle2 className="size-4" />
                      {getStatusLabel(perm.id)}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 whitespace-nowrap"
                      onClick={() => void handleAuthorize(perm.id)}
                      disabled={isOpening || !result}
                    >
                      {isOpening ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <ExternalLink className="size-3.5" />
                      )}
                      <span className="leading-none">
                        {isOpening
                          ? t("settings.permission_opening")
                          : getStatusLabel(perm.id)}
                      </span>
                    </Button>
                  )
                }
              />
            );
          })}
        </SettingsBlock>
      </SettingsPageSection>

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
                      // Keep system permission status in sync after OS prompt.
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
