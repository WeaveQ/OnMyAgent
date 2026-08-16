/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  WecomAuthProgress,
  WecomConnectionStatus,
} from "@onmyagent/types/wecom-connector";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  cancelWecomConnect,
  completeWecomConnect,
  connectWecomWithCredentials,
  disconnectWecom,
  getWecomStatus,
  openDesktopUrl,
  startWecomConnect,
  subscribeWecomAuthProgress,
  subscribeWecomStatus,
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
  canDisconnectWecom,
  getWecomPrimaryAction,
  isWecomBusy,
} from "./wecom-plugin-state";

const WECOM_ICON_SRC = "/connector-icons/wecom.png";

const UNSUPPORTED_STATUS: WecomConnectionStatus = {
  phase: "disconnected",
  authorized: false,
  skillInstalled: false,
  cliAvailable: false,
  serverNames: [],
  message: null,
  errorCode: "desktop_only",
  errorMessage: null,
  lastCheckedAt: 0,
};

function wecomTryPrompts(): string[] {
  return [
    t("plugins.wecom_prompt_1"),
    t("plugins.wecom_prompt_2"),
    t("plugins.wecom_prompt_3"),
    t("plugins.wecom_prompt_4"),
  ];
}

export function WecomPluginCard(props: {
  onTryPrompt?: (prompt: string) => void;
}) {
  const reloadCoordinator = useReloadCoordinator();
  const [status, setStatus] = useState<WecomConnectionStatus | null>(null);
  const [progress, setProgress] = useState<WecomAuthProgress | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [authWaitOpen, setAuthWaitOpen] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [botId, setBotId] = useState("");
  const [secret, setSecret] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const finishConnected = useCallback(
    async (next?: WecomConnectionStatus | null) => {
      const resolved = next ?? (await getWecomStatus().catch(() => null));
      if (resolved) setStatus(resolved);
      setAuthWaitOpen(false);
      setCredOpen(false);
      setConnecting(false);
      setProgress(null);
      setAuthError(null);
      setAuthUrl(null);
      setBotId("");
      setSecret("");
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "wecom",
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
      setStatus(await getWecomStatus());
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
    const unsubStatus = subscribeWecomStatus((next) => {
      setStatus(next);
      if (next.authorized && next.phase === "connected" && connecting) {
        void finishConnected(next);
      }
    });
    const unsubProgress = subscribeWecomAuthProgress((next) => {
      if (next.phase === "complete") {
        void finishConnected();
        return;
      }
      if (next.phase === "cancelled") {
        setProgress(null);
        return;
      }
      setProgress(next);
      if (next.authorizationUrl) setAuthUrl(next.authorizationUrl);
      if (next.phase === "error" || next.phase === "expired") {
        setAuthError(next.errorMessage ?? t("plugins.wecom_error_hint"));
        setConnecting(false);
      }
    });
    return () => {
      unsubStatus();
      unsubProgress();
    };
  }, [connecting, finishConnected, refresh]);

  useEffect(() => {
    if (!authWaitOpen || !isDesktopRuntime()) return undefined;
    const id = window.setInterval(() => {
      void getWecomStatus()
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

  const busy = connecting || isWecomBusy(status);
  const primaryAction = useMemo(() => getWecomPrimaryAction(status), [status]);
  const canDisconnect = canDisconnectWecom(status);
  const fullyConnected =
    status?.phase === "connected" && status.authorized === true;

  const cardStatus: ConnectorCardStatus = useMemo(() => {
    if (!status || busy || progress) return "pending";
    if (status.phase === "error") return "error";
    if (fullyConnected) return "connected";
    if (status.errorCode === "desktop_only") return "error";
    return "idle";
  }, [busy, fullyConnected, progress, status]);

  const runQrAuthorize = async () => {
    if (!isDesktopRuntime() || connecting) return;
    setConnecting(true);
    setAuthError(null);
    setDetailOpen(false);
    setAuthWaitOpen(true);
    setProgress({ operation: "connect", phase: "starting" });
    try {
      const started = await startWecomConnect();
      if (started.alreadyConnected) {
        await finishConnected(await getWecomStatus());
        return;
      }
      setAuthUrl(started.authorizationUrl || null);
      const next = await completeWecomConnect(started.sessionId);
      if (next.authorized || next.phase === "connected") {
        await finishConnected(next);
        return;
      }
      setStatus(next);
    } catch (error) {
      try {
        const recovered = await getWecomStatus();
        if (recovered.authorized) {
          await finishConnected(recovered);
          return;
        }
      } catch {
        // fall through
      }
      const raw =
        error instanceof Error ? error.message : t("plugins.wecom_error_hint");
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
      setAuthError(formatDesktopConnectorError(raw, t("plugins.wecom_error_hint")));
      setConnecting(false);
    } finally {
      setProgress(null);
    }
  };

  const submitCredentials = async () => {
    const id = botId.trim();
    const sec = secret.trim();
    if (!id || !sec || connecting) return;
    setConnecting(true);
    setAuthError(null);
    try {
      const next = await connectWecomWithCredentials({
        botId: id,
        secret: sec,
      });
      if (next.authorized || next.phase === "connected") {
        await finishConnected(next);
        return;
      }
      setStatus(next);
      setAuthError(t("plugins.wecom_error_hint"));
      setConnecting(false);
    } catch (error) {
      const raw =
        error instanceof Error ? error.message : t("plugins.wecom_error_hint");
      setAuthError(formatDesktopConnectorError(raw, t("plugins.wecom_error_hint")));
      setConnecting(false);
    }
  };

  const handleCancelAuth = async () => {
    if (connecting) {
      try {
        await cancelWecomConnect();
      } catch {
        // ignore
      }
    }
    setAuthWaitOpen(false);
    setCredOpen(false);
    setConnecting(false);
    setProgress(null);
    setAuthError(null);
    setAuthUrl(null);
    setBotId("");
    setSecret("");
    await refresh();
  };

  const handleDisconnect = async () => {
    setDisconnectOpen(false);
    setUnbinding(true);
    try {
      setStatus(await disconnectWecom());
      setDetailOpen(false);
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "wecom",
        action: "removed",
      });
    } catch {
      await refresh();
    } finally {
      setUnbinding(false);
    }
  };

  const tryPrompts = useMemo(() => wecomTryPrompts(), []);
  const handleTryIt = () => {
    const prompt = tryPrompts[0];
    if (!prompt || !props.onTryPrompt) return;
    props.onTryPrompt(prompt);
    setDetailOpen(false);
  };

  const inputClass =
    "w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-sm text-dls-text outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/40";

  return (
    <div className="min-w-0">
      <ConnectorStatusCard
        data-plugin-id="wecom"
        name={t("plugins.wecom_title")}
        description={t("plugins.wecom_description")}
        iconSrc={WECOM_ICON_SRC}
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
                t("plugins.wecom_error_hint"),
              )
            : null
        }
        errorTitle={
          status?.phase === "error" && !status.authorized && status.errorMessage
            ? formatDesktopConnectorError(
                status.errorMessage,
                t("plugins.wecom_error_hint"),
              )
            : null
        }
      />

      <ConnectorConnectDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={t("plugins.wecom_title")}
        description={t("plugins.wecom_description")}
        iconSrc={WECOM_ICON_SRC}
        connected={fullyConnected}
        connecting={connecting}
        connectLabel={
          primaryAction === "retry"
            ? t("plugins.wecom_retry")
            : t("plugins.wecom_connect")
        }
        onConnect={
          !isDesktopRuntime()
            ? undefined
            : () => void runQrAuthorize()
        }
        onTryIt={fullyConnected ? handleTryIt : undefined}
        onUnbind={canDisconnect ? () => setDisconnectOpen(true) : undefined}
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
            ? t("plugins.wecom_desktop_only")
            : authError
              ? authError
              : status?.phase === "error" && status.errorMessage
                ? formatDesktopConnectorError(
                    status.errorMessage,
                    t("plugins.wecom_error_hint"),
                  )
              : fullyConnected
                ? t("plugins.wecom_connected_note")
                : t("plugins.wecom_connect_hint")
        }
      >
        {!fullyConnected && isDesktopRuntime() ? (
          <div className="flex flex-col items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                setDetailOpen(false);
                setCredOpen(true);
                setAuthError(null);
              }}
            >
              {t("plugins.wecom_use_credentials")}
            </Button>
          </div>
        ) : null}
      </ConnectorConnectDialog>

      <ConfirmModal
        open={disconnectOpen}
        title={t("plugins.wecom_disconnect_title")}
        message={t("plugins.wecom_disconnect_message")}
        confirmLabel={t("plugins.wecom_disconnect")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setDisconnectOpen(false)}
      />

      <Dialog
        open={credOpen}
        onOpenChange={(open) => {
          if (!open) void handleCancelAuth();
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,520px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
            <DialogTitle>{t("plugins.wecom_cred_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.wecom_cred_subtitle")}
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
                {t("plugins.wecom_bot_id_label")}
              </span>
              <input
                className={inputClass}
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
                placeholder={t("plugins.wecom_bot_id_placeholder")}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-dls-secondary">
                {t("plugins.wecom_secret_label")}
              </span>
              <input
                className={inputClass}
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={t("plugins.wecom_secret_placeholder")}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="text-xs text-dls-secondary">
              {t("plugins.wecom_cred_help")}
            </p>
          </div>
          <DialogFooter className="m-0 shrink-0 gap-2 rounded-b-xl border-t border-dls-border px-6 py-4 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCancelAuth()}
            >
              {t("plugins.wecom_cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!botId.trim() || !secret.trim() || connecting}
              onClick={() => void submitCredentials()}
            >
              {connecting
                ? t("common.connecting")
                : t("plugins.wecom_cred_submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={authWaitOpen}
        onOpenChange={(open) => {
          if (!open) void handleCancelAuth();
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,420px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
            <DialogTitle>{t("plugins.wecom_connect_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.wecom_connect_subtitle")}
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
                <p className="text-center">{t("plugins.wecom_waiting")}</p>
                <p className="text-center text-xs">
                  {t("plugins.wecom_waiting_hint")}
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="m-0 shrink-0 gap-2 rounded-b-xl border-t border-dls-border px-6 py-4 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCancelAuth()}
            >
              {t("plugins.wecom_cancel")}
            </Button>
            {authError ? (
              <Button size="sm" onClick={() => void runQrAuthorize()}>
                {t("plugins.wecom_retry")}
              </Button>
            ) : authUrl ? (
              <Button size="sm" onClick={() => void openDesktopUrl(authUrl)}>
                {t("plugins.wecom_open_browser")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
