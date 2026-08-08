/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  BaiduDriveAuthProgress,
  BaiduDriveConnectionStatus,
} from "@onmyagent/types/baidu-drive-connector";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  cancelBaiduDriveConnect,
  completeBaiduDriveConnect,
  connectBaiduDriveWithToken,
  disconnectBaiduDrive,
  getBaiduDriveStatus,
  openDesktopUrl,
  startBaiduDriveConnect,
  subscribeBaiduDriveAuthProgress,
  subscribeBaiduDriveStatus,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import {
  formatDesktopConnectorError,
  formatDesktopConnectorErrorShort,
} from "./connector-desktop-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReloadCoordinator } from "@/react-app/shell";

import { ConnectorConnectDialog } from "./connector-connect-dialog";
import {
  ConnectorStatusCard,
  type ConnectorCardStatus,
} from "./connector-status-card";
import {
  canDisconnectBaiduDrive,
  getBaiduDrivePrimaryAction,
  isBaiduDriveBusy,
} from "./baidu-drive-plugin-state";

const BAIDU_DRIVE_ICON_SRC = "/connector-icons/baidu-drive.png";

const UNSUPPORTED_STATUS: BaiduDriveConnectionStatus = {
  phase: "disconnected",
  mcpConfigured: false,
  authorized: false,
  serverNames: [],
  message: null,
  errorCode: "desktop_only",
  errorMessage: null,
  lastCheckedAt: 0,
};

function baiduTryPrompts(): string[] {
  return [
    t("plugins.baidu_drive_prompt_1"),
    t("plugins.baidu_drive_prompt_2"),
    t("plugins.baidu_drive_prompt_3"),
    t("plugins.baidu_drive_prompt_4"),
  ];
}

export function BaiduDrivePluginCard(props: {
  onTryPrompt?: (prompt: string) => void;
}) {
  const reloadCoordinator = useReloadCoordinator();
  const [status, setStatus] = useState<BaiduDriveConnectionStatus | null>(null);
  const [progress, setProgress] = useState<BaiduDriveAuthProgress | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [authWaitOpen, setAuthWaitOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const finishConnected = useCallback(
    async (next?: BaiduDriveConnectionStatus | null) => {
      const resolved = next ?? (await getBaiduDriveStatus().catch(() => null));
      if (resolved) setStatus(resolved);
      setAuthWaitOpen(false);
      setTokenOpen(false);
      setConnecting(false);
      setProgress(null);
      setAuthError(null);
      setAuthUrl(null);
      setAccessToken("");
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "baidu-drive",
        action: "added",
      });
      setDetailOpen(true);
    },
    [reloadCoordinator],
  );

  const refresh = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setStatus(UNSUPPORTED_STATUS);
      return;
    }
    try {
      setStatus(await getBaiduDriveStatus());
    } catch {
      setStatus((current) =>
        current
          ? {
              ...current,
              phase: "error",
              errorCode: "status_failed",
              errorMessage: t("plugins.connector_ipc_restart_hint"),
            }
          : {
              ...UNSUPPORTED_STATUS,
              phase: "error",
              errorCode: "status_failed",
              errorMessage: t("plugins.connector_ipc_restart_hint"),
              lastCheckedAt: Date.now(),
            },
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!isDesktopRuntime()) return undefined;
    const unsubStatus = subscribeBaiduDriveStatus((next) => {
      setStatus(next);
      if (next.authorized && next.phase === "connected" && connecting) {
        void finishConnected(next);
      }
    });
    const unsubProgress = subscribeBaiduDriveAuthProgress((next) => {
      if (next.phase === "complete") {
        void finishConnected();
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
        void getBaiduDriveStatus()
          .then((s) => {
            if (s.authorized) {
              void finishConnected(s);
              return;
            }
            setAuthError(
              next.errorMessage ?? t("plugins.baidu_drive_error_hint"),
            );
            setConnecting(false);
          })
          .catch(() => {
            setAuthError(
              next.errorMessage ?? t("plugins.baidu_drive_error_hint"),
            );
            setConnecting(false);
          });
      }
    });
    return () => {
      unsubStatus();
      unsubProgress();
    };
  }, [connecting, finishConnected, refresh]);

  useEffect(() => {
    if (!authWaitOpen || !isDesktopRuntime()) {
      return undefined;
    }
    const id = window.setInterval(() => {
      void getBaiduDriveStatus()
        .then((next) => {
          setStatus(next);
          if (next.authorized && next.phase === "connected") {
            void finishConnected(next);
          }
        })
        .catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(id);
  }, [authWaitOpen, finishConnected]);

  const busy = connecting || isBaiduDriveBusy(status);
  const primaryAction = useMemo(
    () => getBaiduDrivePrimaryAction(status),
    [status],
  );
  const canDisconnect = canDisconnectBaiduDrive(status);
  const fullyConnected =
    status?.phase === "connected" && status.authorized === true;

  const cardStatus: ConnectorCardStatus = useMemo(() => {
    if (!status || busy || progress) return "pending";
    if (status.phase === "error") return "error";
    if (fullyConnected) return "connected";
    if (status.errorCode === "desktop_only") return "error";
    return "idle";
  }, [busy, fullyConnected, progress, status]);

  const runAuthorize = async () => {
    if (!isDesktopRuntime() || connecting) return;
    setConnecting(true);
    setAuthError(null);
    setDetailOpen(false);
    setProgress({ operation: "connect", phase: "starting" });
    try {
      const started = await startBaiduDriveConnect();
      if (started.alreadyConnected) {
        await finishConnected(await getBaiduDriveStatus());
        return;
      }
      if (started.needsAccessToken) {
        setTokenOpen(true);
        setConnecting(false);
        setProgress(null);
        return;
      }
      setAuthWaitOpen(true);
      setAuthUrl(started.authorizationUrl || null);
      const next = await completeBaiduDriveConnect(started.sessionId);
      if (next.authorized || next.phase === "connected") {
        await finishConnected(next);
        return;
      }
      setStatus(next);
    } catch (error) {
      try {
        const recovered = await getBaiduDriveStatus();
        if (recovered.authorized) {
          await finishConnected(recovered);
          return;
        }
      } catch {
        // fall through
      }
      const raw =
        error instanceof Error
          ? error.message
          : t("plugins.baidu_drive_error_hint");
      if (
        /oauth_cancelled|Authorization cancelled|Authorization timed out|oauth_timeout/i.test(
          raw,
        )
      ) {
        setAuthWaitOpen(false);
        setAuthError(null);
        setConnecting(false);
        await refresh();
        return;
      }
      const message = formatDesktopConnectorError(raw, t("plugins.baidu_drive_error_hint"));
      setAuthError(message);
      setConnecting(false);
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
      setProgress(null);
    }
  };

  const submitToken = async () => {
    const token = accessToken.trim();
    if (!token || connecting) return;
    setConnecting(true);
    setAuthError(null);
    try {
      const next = await connectBaiduDriveWithToken({ accessToken: token });
      if (next.authorized || next.phase === "connected") {
        await finishConnected(next);
        return;
      }
      setStatus(next);
      setAuthError(t("plugins.baidu_drive_error_hint"));
      setConnecting(false);
    } catch (error) {
      const raw =
        error instanceof Error
          ? error.message
          : t("plugins.baidu_drive_error_hint");
      setAuthError(formatDesktopConnectorError(raw, t("plugins.baidu_drive_error_hint")));
      setConnecting(false);
    }
  };

  const handleCancelAuth = async () => {
    if (connecting) {
      try {
        await cancelBaiduDriveConnect();
      } catch {
        // ignore
      }
    }
    setAuthWaitOpen(false);
    setTokenOpen(false);
    setConnecting(false);
    setProgress(null);
    setAuthError(null);
    setAuthUrl(null);
    setAccessToken("");
    await refresh();
  };

  const handleDisconnect = async () => {
    setDisconnectOpen(false);
    setUnbinding(true);
    try {
      setStatus(await disconnectBaiduDrive());
      setDetailOpen(false);
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "baidu-drive",
        action: "removed",
      });
    } catch {
      await refresh();
    } finally {
      setUnbinding(false);
    }
  };

  const tryPrompts = useMemo(() => baiduTryPrompts(), []);
  const handleTryIt = () => {
    const prompt = tryPrompts[0];
    if (!prompt) return;
    if (!props.onTryPrompt) return;
    props.onTryPrompt(prompt);
    setDetailOpen(false);
  };

  return (
    <div className="min-w-0">
      <ConnectorStatusCard
        data-plugin-id="baidu-drive"
        name={t("plugins.baidu_drive_title")}
        description={t("plugins.baidu_drive_description")}
        iconSrc={BAIDU_DRIVE_ICON_SRC}
        status={cardStatus}
        busy={busy && cardStatus === "pending"}
        onOpen={() => setDetailOpen(true)}
        onAction={() => {
          if (fullyConnected) {
            handleTryIt();
            return;
          }
          setDetailOpen(true);
        }}
        errorLine={
          status?.phase === "error" && !status.authorized && status.errorMessage
            ? formatDesktopConnectorErrorShort(
                status.errorMessage,
                t("plugins.baidu_drive_error_hint"),
              )
            : null
        }
        errorTitle={
          status?.phase === "error" && !status.authorized && status.errorMessage
            ? formatDesktopConnectorError(
                status.errorMessage,
                t("plugins.baidu_drive_error_hint"),
              )
            : null
        }
      />

      <ConnectorConnectDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={t("plugins.baidu_drive_title")}
        description={t("plugins.baidu_drive_description")}
        iconSrc={BAIDU_DRIVE_ICON_SRC}
        connected={fullyConnected}
        connecting={connecting}
        connectLabel={
          primaryAction === "retry"
            ? t("plugins.baidu_drive_retry")
            : t("plugins.baidu_drive_connect")
        }
        onConnect={
          !isDesktopRuntime()
            ? undefined
            : () => void runAuthorize()
        }
        onTryIt={fullyConnected ? handleTryIt : undefined}
        onUnbind={
          canDisconnect ? () => setDisconnectOpen(true) : undefined
        }
        unbinding={unbinding}
        tryThisPrompts={tryPrompts}
        promptsDisabled={!props.onTryPrompt || !fullyConnected}
        onSelectPrompt={
          fullyConnected && props.onTryPrompt
            ? (prompt) => {
                props.onTryPrompt?.(prompt);
                setDetailOpen(false);
              }
            : undefined
        }
        footerNote={
          !isDesktopRuntime()
            ? t("plugins.baidu_drive_desktop_only")
            : authError
              ? authError
              : status?.phase === "error" && status.errorMessage
                ? formatDesktopConnectorError(
                    status.errorMessage,
                    t("plugins.baidu_drive_error_hint"),
                  )
              : fullyConnected
                ? t("plugins.baidu_drive_connected_note")
                : status?.oauthConfigured === false
                  ? t("plugins.baidu_drive_token_hint")
                  : null
        }
      />

      <ConfirmModal
        open={disconnectOpen}
        title={t("plugins.baidu_drive_disconnect_title")}
        message={t("plugins.baidu_drive_disconnect_message")}
        confirmLabel={t("plugins.baidu_drive_disconnect")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setDisconnectOpen(false)}
      />

      {/* Token paste when product OAuth client is not configured */}
      <Dialog
        open={tokenOpen}
        onOpenChange={(open) => {
          if (!open) void handleCancelAuth();
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,480px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
            <DialogTitle>{t("plugins.baidu_drive_token_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.baidu_drive_token_subtitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-3">
            {authError ? (
              <NoticeBox tone="error" role="alert">
                {authError}
              </NoticeBox>
            ) : null}
            <label className="block space-y-1.5 text-sm">
              <span className="text-dls-secondary">
                {t("plugins.baidu_drive_token_label")}
              </span>
              <textarea
                className="min-h-24 w-full resize-y rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-sm text-dls-text outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/40"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={t("plugins.baidu_drive_token_placeholder")}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="text-xs text-dls-secondary">
              {t("plugins.baidu_drive_token_help")}
            </p>
          </div>
          <DialogFooter className="m-0 mx-0 mb-0 shrink-0 gap-2 rounded-b-xl border-t border-dls-border bg-transparent px-6 py-4 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCancelAuth()}
            >
              {t("plugins.baidu_drive_cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!accessToken.trim() || connecting}
              onClick={() => void submitToken()}
            >
              {connecting
                ? t("common.connecting")
                : t("plugins.baidu_drive_token_submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OAuth wait surface — system browser handoff */}
      <Dialog
        open={authWaitOpen}
        onOpenChange={(open) => {
          if (!open) void handleCancelAuth();
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,420px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
            <DialogTitle>{t("plugins.baidu_drive_connect_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.baidu_drive_connect_subtitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-3">
            {authError ? (
              <NoticeBox tone="error" role="alert">
                {authError}
              </NoticeBox>
            ) : (
              <div className="flex flex-col items-center gap-3 py-4 text-sm text-dls-secondary">
                <LoadingSpinner size="sm" />
                <p className="text-center">{t("plugins.baidu_drive_waiting")}</p>
                <p className="text-center text-xs">
                  {t("plugins.baidu_drive_waiting_hint")}
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="m-0 mx-0 mb-0 shrink-0 gap-2 rounded-b-xl border-t border-dls-border bg-transparent px-6 py-4 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCancelAuth()}
            >
              {t("plugins.baidu_drive_cancel")}
            </Button>
            {authError ? (
              <Button size="sm" onClick={() => void runAuthorize()}>
                {t("plugins.baidu_drive_retry")}
              </Button>
            ) : authUrl ? (
              <Button size="sm" onClick={() => void openDesktopUrl(authUrl)}>
                {t("plugins.baidu_drive_open_browser")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
