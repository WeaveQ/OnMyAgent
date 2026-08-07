/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { LogIn, RotateCcw, Unlink } from "lucide-react";

import type {
  TencentDocsAuthProgress,
  TencentDocsConnectionStatus,
} from "@onmyagent/types/tencent-docs-connector";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  cancelTencentDocsConnect,
  completeTencentDocsConnect,
  disconnectTencentDocs,
  getTencentDocsStatus,
  openDesktopUrl,
  startTencentDocsConnect,
  subscribeTencentDocsAuthProgress,
  subscribeTencentDocsStatus,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  connectorTileClassName,
  connectorTileDescClassName,
  connectorTileFooterClassName,
  connectorTileHeaderClassName,
} from "./connector-tile";
import {
  canDisconnectTencentDocs,
  getTencentDocsPrimaryAction,
  isTencentDocsBusy,
  type TencentDocsPrimaryAction,
} from "./tencent-docs-plugin-state";

const TENCENT_DOCS_ICON_SRC = "/connector-icons/tencent-docs.png";

const UNSUPPORTED_STATUS: TencentDocsConnectionStatus = {
  phase: "disconnected",
  mcpConfigured: false,
  skillInstalled: false,
  authorized: false,
  serverNames: [],
  message: null,
  errorCode: "desktop_only",
  errorMessage: null,
  lastCheckedAt: 0,
};

function badgeFor(
  status: TencentDocsConnectionStatus | null,
): { tone: StatusBadgeTone; label: string } | null {
  if (!status) return null;
  switch (status.phase) {
    case "connected":
      return {
        tone: "success",
        label: t("plugins.tencent_docs_badge_connected"),
      };
    case "authorizing":
    case "busy":
      return {
        tone: "warning",
        label: t("plugins.tencent_docs_badge_authorizing"),
      };
    case "error":
      return {
        tone: "danger",
        label: t("plugins.tencent_docs_badge_error"),
      };
    default:
      return {
        tone: "neutral",
        label: t("plugins.tencent_docs_badge_disconnected"),
      };
  }
}

function primaryLabel(action: TencentDocsPrimaryAction): string {
  return action === "retry"
    ? t("plugins.tencent_docs_retry")
    : t("plugins.tencent_docs_connect");
}

export function TencentDocsPluginCard() {
  const [status, setStatus] = useState<TencentDocsConnectionStatus | null>(null);
  const [progress, setProgress] = useState<TencentDocsAuthProgress | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setStatus(UNSUPPORTED_STATUS);
      return;
    }
    try {
      setStatus(await getTencentDocsStatus());
    } catch {
      setStatus((current) =>
        current
          ? { ...current, phase: "error", errorCode: "status_failed" }
          : {
              ...UNSUPPORTED_STATUS,
              phase: "error",
              errorCode: "status_failed",
              lastCheckedAt: Date.now(),
            },
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!isDesktopRuntime()) return undefined;
    const unsubStatus = subscribeTencentDocsStatus((next) => {
      setStatus(next);
    });
    const unsubProgress = subscribeTencentDocsAuthProgress((next) => {
      if (next.phase === "complete" || next.phase === "cancelled") {
        setProgress(null);
        return;
      }
      setProgress(next);
      if (next.authorizationUrl) {
        setAuthUrl(next.authorizationUrl);
      }
      if (next.phase === "error" || next.phase === "expired") {
        setAuthError(next.errorMessage ?? t("plugins.tencent_docs_error_hint"));
      }
    });
    return () => {
      unsubStatus();
      unsubProgress();
    };
  }, [refresh]);

  const busy = connecting || isTencentDocsBusy(status);
  const primaryAction = useMemo(
    () => getTencentDocsPrimaryAction(status),
    [status],
  );
  const headerBadge = badgeFor(status);
  const canDisconnect = canDisconnectTencentDocs(status);

  const runConnect = async () => {
    if (!isDesktopRuntime() || connecting) return;
    setConnecting(true);
    setAuthError(null);
    setAuthOpen(true);
    setProgress({ operation: "connect", phase: "starting" });
    try {
      const started = await startTencentDocsConnect();
      if (started.alreadyConnected) {
        setAuthOpen(false);
        setStatus(await getTencentDocsStatus());
        return;
      }
      setAuthUrl(started.authorizationUrl || null);
      // Browser is opened by the desktop manager; user can re-open via the dialog.
      const next = await completeTencentDocsConnect(started.sessionId);
      setStatus(next);
      setAuthOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("plugins.tencent_docs_error_hint");
      setAuthError(message);
      setStatus((current) =>
        current
          ? {
              ...current,
              phase: "error",
              errorCode: "connect_failed",
              errorMessage: message,
            }
          : {
              ...UNSUPPORTED_STATUS,
              phase: "error",
              errorCode: "connect_failed",
              errorMessage: message,
              lastCheckedAt: Date.now(),
            },
      );
    } finally {
      setConnecting(false);
      setProgress(null);
    }
  };

  const handleCancelAuth = async () => {
    try {
      await cancelTencentDocsConnect();
    } catch {
      // ignore
    }
    setAuthOpen(false);
    setConnecting(false);
    setProgress(null);
    await refresh();
  };

  const handleDisconnect = async () => {
    setDisconnectOpen(false);
    try {
      setStatus(await disconnectTencentDocs());
    } catch {
      await refresh();
    }
  };

  const hint =
    status?.phase === "connected" && status.authorized
      ? t("plugins.tencent_docs_hint_connected")
      : t("plugins.tencent_docs_hint_disconnected");

  return (
    <div className="min-w-0">
      <article
        className={cn(connectorTileClassName, "cursor-default")}
        data-plugin-id="tencent-docs"
        aria-busy={busy}
      >
        <div className={connectorTileHeaderClassName}>
          <div className="size-9 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-dls-surface">
            <img
              src={resolvePublicAssetUrl(TENCENT_DOCS_ICON_SRC)}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
              {t("plugins.tencent_docs_title")}
            </h3>
            {headerBadge ? (
              <StatusBadge tone={headerBadge.tone} size="tiny">
                {headerBadge.label}
              </StatusBadge>
            ) : (
              <LoadingSpinner size="sm" />
            )}
          </div>
        </div>

        <p
          className={connectorTileDescClassName}
          title={t("plugins.tencent_docs_description")}
        >
          {t("plugins.tencent_docs_description")}
        </p>

        <p className="mt-1 line-clamp-2 text-xs text-dls-secondary" title={hint}>
          {hint}
        </p>

        <div className={cn(connectorTileFooterClassName, "justify-end gap-1.5")}>
          {!isDesktopRuntime() ? (
            <span className="text-xs text-dls-secondary">
              {t("plugins.tencent_docs_desktop_only")}
            </span>
          ) : !status ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-dls-secondary"
              aria-live="polite"
            >
              <LoadingSpinner size="sm" />
              {t("plugins.tencent_docs_checking")}
            </span>
          ) : progress || connecting ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-dls-secondary"
              aria-live="polite"
            >
              <LoadingSpinner size="sm" />
              {t("plugins.tencent_docs_waiting")}
            </span>
          ) : (
            <>
              {canDisconnect ? (
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setDisconnectOpen(true)}
                >
                  <Unlink aria-hidden="true" />
                  {t("plugins.tencent_docs_disconnect")}
                </Button>
              ) : null}
              {primaryAction ? (
                <Button
                  size="xs"
                  disabled={busy}
                  onClick={() => void runConnect()}
                >
                  {primaryAction === "retry" ? (
                    <RotateCcw aria-hidden="true" />
                  ) : (
                    <LogIn aria-hidden="true" />
                  )}
                  {primaryLabel(primaryAction)}
                </Button>
              ) : null}
            </>
          )}
        </div>

        {status?.phase === "error" ? (
          <NoticeBox tone="error" role="alert" className="mt-2">
            {status.errorMessage || t("plugins.tencent_docs_error_hint")}
          </NoticeBox>
        ) : null}
      </article>

      <ConfirmModal
        open={disconnectOpen}
        title={t("plugins.tencent_docs_disconnect_title")}
        message={t("plugins.tencent_docs_disconnect_message")}
        confirmLabel={t("plugins.tencent_docs_disconnect")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setDisconnectOpen(false)}
      />

      <Dialog
        open={authOpen}
        onOpenChange={(open) => {
          if (!open) void handleCancelAuth();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("plugins.tencent_docs_connect_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.tencent_docs_connect_subtitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-center gap-2 text-sm text-dls-secondary">
              <LoadingSpinner size="sm" />
              {t("plugins.tencent_docs_waiting")}
            </div>
            {authError ? (
              <NoticeBox tone="error" role="alert">
                {authError}
              </NoticeBox>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCancelAuth()}
            >
              {t("plugins.tencent_docs_cancel")}
            </Button>
            {authUrl ? (
              <Button
                size="sm"
                onClick={() => void openDesktopUrl(authUrl)}
              >
                {t("plugins.tencent_docs_open_browser")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
