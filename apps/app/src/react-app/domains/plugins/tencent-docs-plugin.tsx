/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  TencentDocsAuthProgress,
  TencentDocsConnectionStatus,
} from "@onmyagent/types/tencent-docs-connector";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
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
  canDisconnectTencentDocs,
  getTencentDocsPrimaryAction,
  isTencentDocsBusy,
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

function tencentTryPrompts(): string[] {
  return [
    t("plugins.tencent_docs_prompt_1"),
    t("plugins.tencent_docs_prompt_2"),
    t("plugins.tencent_docs_prompt_3"),
    t("plugins.tencent_docs_prompt_4"),
  ];
}

export function TencentDocsPluginCard(props: {
  onTryPrompt?: (prompt: string) => void;
}) {
  const reloadCoordinator = useReloadCoordinator();
  const [status, setStatus] = useState<TencentDocsConnectionStatus | null>(null);
  const [progress, setProgress] = useState<TencentDocsAuthProgress | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [authWaitOpen, setAuthWaitOpen] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const finishConnected = useCallback(
    async (next?: TencentDocsConnectionStatus | null) => {
      const resolved = next ?? (await getTencentDocsStatus().catch(() => null));
      if (resolved) setStatus(resolved);
      setAuthWaitOpen(false);
      setConnecting(false);
      setProgress(null);
      setAuthError(null);
      setAuthUrl(null);
      // MCP was written to OpenCode global config — sessions need an engine reload.
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "tencent-docs",
        action: "added",
      });
      // Re-open product detail so user can immediately 去试试.
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
      setStatus(await getTencentDocsStatus());
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
    const unsubStatus = subscribeTencentDocsStatus((next) => {
      setStatus(next);
      if (next.authorized && next.phase === "connected" && connecting) {
        void finishConnected(next);
      }
    });
    const unsubProgress = subscribeTencentDocsAuthProgress((next) => {
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
        void getTencentDocsStatus()
          .then((s) => {
            if (s.authorized) {
              void finishConnected(s);
              return;
            }
            setAuthError(
              next.errorMessage ?? t("plugins.tencent_docs_error_hint"),
            );
            setConnecting(false);
          })
          .catch(() => {
            setAuthError(
              next.errorMessage ?? t("plugins.tencent_docs_error_hint"),
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

  // Fallback poll while waiting — covers missed IPC progress events.
  useEffect(() => {
    if (!authWaitOpen || !isDesktopRuntime()) {
      return undefined;
    }
    const id = window.setInterval(() => {
      void getTencentDocsStatus()
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

  const busy = connecting || isTencentDocsBusy(status);
  const primaryAction = useMemo(
    () => getTencentDocsPrimaryAction(status),
    [status],
  );
  const canDisconnect = canDisconnectTencentDocs(status);
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
    setAuthWaitOpen(true);
    setProgress({ operation: "connect", phase: "starting" });
    try {
      const started = await startTencentDocsConnect();
      if (started.alreadyConnected) {
        await finishConnected(await getTencentDocsStatus());
        return;
      }
      setAuthUrl(started.authorizationUrl || null);
      const next = await completeTencentDocsConnect(started.sessionId);
      if (next.authorized || next.phase === "connected") {
        await finishConnected(next);
        return;
      }
      setStatus(next);
    } catch (error) {
      try {
        const recovered = await getTencentDocsStatus();
        if (recovered.authorized) {
          await finishConnected(recovered);
          return;
        }
      } catch {
        // fall through
      }
      const raw =
        error instanceof Error ? error.message : t("plugins.tencent_docs_error_hint");
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
      const message = formatDesktopConnectorError(raw, t("plugins.tencent_docs_error_hint"));
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

  const handleCancelAuth = async () => {
    if (connecting) {
      try {
        await cancelTencentDocsConnect();
      } catch {
        // ignore
      }
    }
    setAuthWaitOpen(false);
    setConnecting(false);
    setProgress(null);
    setAuthError(null);
    setAuthUrl(null);
    await refresh();
  };

  const handleDisconnect = async () => {
    setDisconnectOpen(false);
    setUnbinding(true);
    try {
      setStatus(await disconnectTencentDocs());
      setDetailOpen(false);
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "tencent-docs",
        action: "removed",
      });
    } catch {
      await refresh();
    } finally {
      setUnbinding(false);
    }
  };

  const tryPrompts = useMemo(() => tencentTryPrompts(), []);
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
        data-plugin-id="tencent-docs"
        name={t("plugins.tencent_docs_title")}
        description={t("plugins.tencent_docs_description")}
        iconSrc={TENCENT_DOCS_ICON_SRC}
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
                t("plugins.tencent_docs_error_hint"),
              )
            : null
        }
        errorTitle={
          status?.phase === "error" && !status.authorized && status.errorMessage
            ? formatDesktopConnectorError(
                status.errorMessage,
                t("plugins.tencent_docs_error_hint"),
              )
            : null
        }
      />

      <ConnectorConnectDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={t("plugins.tencent_docs_title")}
        description={t("plugins.tencent_docs_description")}
        iconSrc={TENCENT_DOCS_ICON_SRC}
        connected={fullyConnected}
        connecting={connecting}
        connectLabel={
          primaryAction === "retry"
            ? t("plugins.tencent_docs_retry")
            : t("plugins.tencent_docs_connect")
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
            ? t("plugins.tencent_docs_desktop_only")
            : authError
              ? authError
              : status?.phase === "error" && status.errorMessage
                ? formatDesktopConnectorError(
                    status.errorMessage,
                    t("plugins.tencent_docs_error_hint"),
                  )
              : fullyConnected
                ? t("plugins.tencent_docs_connected_note")
                : null
        }
      />

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

      {/* OAuth wait surface — system browser handoff */}
      <Dialog
        open={authWaitOpen}
        onOpenChange={(open) => {
          if (!open) void handleCancelAuth();
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,420px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
            <DialogTitle>{t("plugins.tencent_docs_connect_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.tencent_docs_connect_subtitle")}
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
                <p className="text-center">{t("plugins.tencent_docs_waiting")}</p>
                <p className="text-center text-xs">
                  {t("plugins.tencent_docs_waiting_hint")}
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
              {t("plugins.tencent_docs_cancel")}
            </Button>
            {authError ? (
              <Button size="sm" onClick={() => void runAuthorize()}>
                {t("plugins.tencent_docs_retry")}
              </Button>
            ) : authUrl ? (
              <Button size="sm" onClick={() => void openDesktopUrl(authUrl)}>
                {t("plugins.tencent_docs_open_browser")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
