/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FilePenLine, LogIn, RotateCcw, ShieldCheck, Unlink } from "lucide-react";

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
const ONMYAGENT_ICON_SRC = "/on-my-agent-logo.png";

/** Product intro first; OAuth only after user confirms (WorkBuddy-style). */
type ConnectStep = "intro" | "authorizing" | "error";

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
  const [connectStep, setConnectStep] = useState<ConnectStep>("intro");
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
      // Event-driven close: main may finish OAuth while completeConnect IPC is still open.
      if (next.authorized && next.phase === "connected") {
        setAuthOpen(false);
        setConnecting(false);
        setProgress(null);
        setAuthError(null);
        setAuthUrl(null);
        setConnectStep("intro");
      }
    });
    const unsubProgress = subscribeTencentDocsAuthProgress((next) => {
      if (next.phase === "complete") {
        setProgress(null);
        setAuthOpen(false);
        setConnecting(false);
        setAuthError(null);
        setAuthUrl(null);
        setConnectStep("intro");
        void refresh();
        return;
      }
      if (next.phase === "cancelled") {
        setProgress(null);
        return;
      }
      setProgress(next);
      if (next.authorizationUrl) {
        setAuthUrl(next.authorizationUrl);
      }
      if (next.phase === "error" || next.phase === "expired") {
        // Ignore stale timeout after a successful authorize (token already on disk).
        void getTencentDocsStatus()
          .then((s) => {
            if (s.authorized) {
              setStatus(s);
              setAuthOpen(false);
              setConnecting(false);
              setAuthError(null);
              setProgress(null);
              setConnectStep("intro");
              return;
            }
            setAuthError(
              next.errorMessage ?? t("plugins.tencent_docs_error_hint"),
            );
            setConnectStep("error");
            setConnecting(false);
          })
          .catch(() => {
            setAuthError(
              next.errorMessage ?? t("plugins.tencent_docs_error_hint"),
            );
            setConnectStep("error");
            setConnecting(false);
          });
      }
    });
    return () => {
      unsubStatus();
      unsubProgress();
    };
  }, [refresh]);

  // Fallback poll while waiting — covers missed IPC progress events.
  useEffect(() => {
    if (!authOpen || connectStep !== "authorizing" || !isDesktopRuntime()) {
      return undefined;
    }
    const id = window.setInterval(() => {
      void getTencentDocsStatus()
        .then((next) => {
          setStatus(next);
          if (next.authorized && next.phase === "connected") {
            setAuthOpen(false);
            setConnecting(false);
            setProgress(null);
            setAuthError(null);
            setAuthUrl(null);
            setConnectStep("intro");
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(id);
  }, [authOpen, connectStep]);

  const busy = connecting || isTencentDocsBusy(status);
  const primaryAction = useMemo(
    () => getTencentDocsPrimaryAction(status),
    [status],
  );
  const headerBadge = badgeFor(status);
  const canDisconnect = canDisconnectTencentDocs(status);

  /** Open product intro only — do not start OAuth yet. */
  const openConnectIntro = () => {
    if (!isDesktopRuntime() || connecting) return;
    setAuthError(null);
    setAuthUrl(null);
    setProgress(null);
    setConnectStep("intro");
    setAuthOpen(true);
  };

  /** WorkBuddy step 2: user confirmed → real Tencent Docs OAuth in system browser. */
  const runAuthorize = async () => {
    if (!isDesktopRuntime() || connecting) return;
    setConnecting(true);
    setAuthError(null);
    setConnectStep("authorizing");
    setProgress({ operation: "connect", phase: "starting" });
    try {
      const started = await startTencentDocsConnect();
      if (started.alreadyConnected) {
        setStatus(await getTencentDocsStatus());
        setAuthOpen(false);
        setConnectStep("intro");
        return;
      }
      setAuthUrl(started.authorizationUrl || null);
      // Primary path: await completion. Status/progress subscriptions + poll also close.
      const next = await completeTencentDocsConnect(started.sessionId);
      setStatus(next);
      if (next.authorized || next.phase === "connected") {
        setAuthOpen(false);
        setConnectStep("intro");
        setAuthUrl(null);
      }
    } catch (error) {
      // OAuth may already be on disk even if IPC waiter failed / timed out later.
      try {
        const recovered = await getTencentDocsStatus();
        if (recovered.authorized) {
          setStatus(recovered);
          setAuthOpen(false);
          setConnectStep("intro");
          setAuthUrl(null);
          setAuthError(null);
          return;
        }
      } catch {
        // fall through to error UI
      }
      const raw =
        error instanceof Error ? error.message : t("plugins.tencent_docs_error_hint");
      // Cancel / ghost timeout after close — do not paint the card red.
      if (
        /oauth_cancelled|Authorization cancelled|Authorization timed out|oauth_timeout/i.test(
          raw,
        )
      ) {
        setAuthOpen(false);
        setConnectStep("intro");
        setAuthError(null);
        await refresh();
        return;
      }
      const message = raw.includes("Error invoking remote method")
        ? t("plugins.tencent_docs_error_hint")
        : raw;
      setAuthError(message);
      setConnectStep("error");
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
    if (connecting) {
      try {
        await cancelTencentDocsConnect();
      } catch {
        // ignore
      }
    }
    setAuthOpen(false);
    setConnecting(false);
    setProgress(null);
    setAuthError(null);
    setAuthUrl(null);
    setConnectStep("intro");
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
                  onClick={openConnectIntro}
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

        {status?.phase === "error" &&
        !authOpen &&
        !status.authorized &&
        status.errorMessage ? (
          <NoticeBox tone="error" role="alert" className="mt-2">
            {status.errorMessage.includes("Error invoking remote method")
              ? t("plugins.tencent_docs_error_hint")
              : status.errorMessage}
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
        <DialogContent className="flex max-h-[min(90vh,640px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          {connectStep === "intro" ? (
            <>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-2 pt-8 text-center">
                <div className="flex items-center justify-center gap-3">
                  <div className="flex size-12 items-center justify-center overflow-hidden rounded-2xl border border-dls-border bg-dls-surface shadow-sm">
                    <img
                      src={resolvePublicAssetUrl(ONMYAGENT_ICON_SRC)}
                      alt=""
                      className="size-8 object-contain"
                      draggable={false}
                    />
                  </div>
                  <span
                    className="text-sm tracking-widest text-dls-secondary"
                    aria-hidden="true"
                  >
                    ›››
                  </span>
                  <div className="flex size-12 items-center justify-center overflow-hidden rounded-2xl border border-dls-border bg-dls-surface shadow-sm">
                    <img
                      src={resolvePublicAssetUrl(TENCENT_DOCS_ICON_SRC)}
                      alt=""
                      className="size-8 object-contain"
                      draggable={false}
                    />
                  </div>
                </div>
                <DialogHeader className="space-y-2 text-center sm:text-center">
                  <DialogTitle className="text-center text-base font-semibold">
                    {t("plugins.tencent_docs_intro_title")}
                  </DialogTitle>
                  <DialogDescription className="text-center text-sm leading-relaxed text-dls-secondary">
                    {t("plugins.tencent_docs_intro_body")}
                  </DialogDescription>
                </DialogHeader>

                <div className="rounded-xl border border-dls-border bg-dls-surface-muted/60 px-4 py-3 text-left">
                  <p className="mb-3 text-xs font-medium text-dls-secondary">
                    {t("plugins.tencent_docs_scope_heading")}
                  </p>
                  <ul className="space-y-3">
                    <li className="flex gap-3">
                      <Eye
                        className="mt-0.5 size-4 shrink-0 text-dls-secondary"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-dls-text">
                          {t("plugins.tencent_docs_scope_read_title")}
                        </p>
                        <p className="text-xs text-dls-secondary">
                          {t("plugins.tencent_docs_scope_read_desc")}
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <FilePenLine
                        className="mt-0.5 size-4 shrink-0 text-dls-secondary"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-dls-text">
                          {t("plugins.tencent_docs_scope_edit_title")}
                        </p>
                        <p className="text-xs text-dls-secondary">
                          {t("plugins.tencent_docs_scope_edit_desc")}
                        </p>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="shrink-0 space-y-3 px-6 pb-6 pt-4">
                <Button
                  className="w-full"
                  size="default"
                  onClick={() => void runAuthorize()}
                >
                  {t("plugins.tencent_docs_go_authorize")}
                </Button>
                <p className="flex items-start justify-center gap-1.5 text-center text-xs leading-snug text-dls-secondary">
                  <ShieldCheck
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{t("plugins.tencent_docs_privacy_note")}</span>
                </p>
              </div>
            </>
          ) : (
            <>
              <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
                <DialogTitle>{t("plugins.tencent_docs_connect_title")}</DialogTitle>
                <DialogDescription>
                  {t("plugins.tencent_docs_connect_subtitle")}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-3">
                {connectStep === "error" || authError ? (
                  <NoticeBox tone="error" role="alert">
                    {authError || t("plugins.tencent_docs_error_hint")}
                  </NoticeBox>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4 text-sm text-dls-secondary">
                    <LoadingSpinner size="sm" />
                    <p className="text-center">{t("plugins.tencent_docs_waiting")}</p>
                    <p className="text-center text-xs">
                      {t("plugins.tencent_docs_waiting_hint")}
                    </p>
                  </div>
                )}
              </div>
              {/* Override DialogFooter -mx-6 -mb-6: parent uses p-0, negative margin clips buttons */}
              <DialogFooter className="m-0 mx-0 mb-0 shrink-0 gap-2 rounded-b-xl border-t border-dls-border bg-transparent px-6 py-4 sm:justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCancelAuth()}
                >
                  {t("plugins.tencent_docs_cancel")}
                </Button>
                {connectStep === "error" ? (
                  <Button size="sm" onClick={() => void runAuthorize()}>
                    {t("plugins.tencent_docs_retry")}
                  </Button>
                ) : authUrl ? (
                  <Button size="sm" onClick={() => void openDesktopUrl(authUrl)}>
                    {t("plugins.tencent_docs_open_browser")}
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
