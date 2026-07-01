/** @jsxImportSource react */
import { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { SettingsActionRow } from "../settings-section";
import type { SystemPermissionResult, SystemPermissionType } from "../../../../app/lib/desktop-types";
import { t } from "../../../../i18n";

type PermissionItem = {
  id: SystemPermissionType;
  label: string;
  description: string;
};

const PERMISSIONS: PermissionItem[] = [
  {
    id: "full-disk-access",
    get label() { return t("settings.permission_full_disk_label"); },
    get description() { return t("settings.permission_full_disk_desc"); },
  },
  {
    id: "accessibility",
    get label() { return t("settings.permission_accessibility_label"); },
    get description() { return t("settings.permission_accessibility_desc"); },
  },
  {
    id: "automation",
    get label() { return t("settings.permission_automation_label"); },
    get description() { return t("settings.permission_automation_desc"); },
  },
  {
    id: "notifications",
    get label() { return t("settings.permission_notifications_label"); },
    get description() { return t("settings.permission_notifications_desc"); },
  },
];

export function SystemAuthorizationsView() {
  const [result, setResult] = useState<SystemPermissionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<SystemPermissionType | null>(null);
  const [hintDialogHint, setHintDialogHint] = useState<string | null>(null);

  const checkPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await desktopBridge.checkSystemPermissions()) as SystemPermissionResult;
      const permissions = { ...data.permissions };

      // 在渲染进程中直接检测通知权限（Web Notification API）
      if (data.platform === "macos" && typeof window !== "undefined" && "Notification" in window) {
        const notifPerm = Notification.permission;
        if (notifPerm === "granted") {
          permissions.notifications = "granted";
        } else if (notifPerm === "denied") {
          permissions.notifications = "denied";
        } else {
          // "default" 表示用户未做选择，视为未授权。
          permissions.notifications = "denied";
        }
      }

      setResult({ ...data, permissions });
    } catch (e) {
      console.error("Failed to check system permissions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkPermissions();
  }, [checkPermissions]);

  // Auto-recheck when user returns to the app window.
  // This handles the common flow: user clicks "去授权" → switches to System
  // Settings → grants permission → switches back to OnMyAgent. Without this,
  // the UI would show the stale "未授权" state until the user manually clicks
  // the refresh button.
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void checkPermissions(), 300);
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
      const response = await desktopBridge.openSystemPermissionSettings(type) as { success: boolean; hint?: string | null; error?: string };
      if (response.hint) {
        setHintDialogHint(response.hint);
      }
      // Refresh after opening settings UI (user may grant the permission)
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
    <>
      <Card variant="outline" size="sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            {t("settings.system_authorizations")}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="size-4 cursor-help text-muted-foreground hover:text-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("settings.permission_revoke_hint")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </div>
        <CardDescription>
          {t("settings.system_authorizations_description")}
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void checkPermissions()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-2">
        {PERMISSIONS.map((perm) => {
          const status = result?.permissions[perm.id];
          const isGranted = status === "granted";
          const isOpening = opening === perm.id;

          return (
            <SettingsActionRow key={perm.id} className="px-4 hover:bg-dls-hover/40">
              <div className="flex w-full items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-card-foreground">
                      {perm.label}
                    </span>
                    {isGranted ? (
                      <StatusBadge className="gap-1" tone="accent">
                        <CheckCircle2 className="size-3" />
                        {getStatusLabel(perm.id)}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {perm.description}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center justify-end">
                  {isGranted ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-0 items-center gap-1.5 whitespace-nowrap border-dls-border bg-dls-surface px-3 py-1.5 text-xs leading-none text-dls-secondary hover:border-dls-accent/50 hover:bg-dls-hover hover:text-dls-text"
                      onClick={() => void handleAuthorize(perm.id)}
                      disabled={isOpening || !result}
                    >
                      {isOpening ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <ExternalLink className="size-3" />
                      )}
                      <span className="leading-none">
                        {isOpening
                          ? t("settings.permission_opening")
                          : getStatusLabel(perm.id)}
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            </SettingsActionRow>
          );
        })}
      </CardContent>
    </Card>

      <Dialog open={Boolean(hintDialogHint)} onOpenChange={(open) => !open && setHintDialogHint(null)}>
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
            <p className="text-sm text-foreground leading-relaxed">
              {hintDialogHint}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => {
              setHintDialogHint(null);
              void checkPermissions();
            }}>
              {t("settings.permission_done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
