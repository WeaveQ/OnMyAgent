/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { KdocsConnectionStatus } from "@onmyagent/types/kdocs-connector";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  connectKdocsWithToken,
  disconnectKdocs,
  getKdocsStatus,
  subscribeKdocsAuthProgress,
  subscribeKdocsStatus,
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
  canDisconnectKdocs,
  getKdocsPrimaryAction,
  isKdocsBusy,
} from "./kdocs-plugin-state";

const KDOCS_ICON_SRC = "/connector-icons/wps.png";

const UNSUPPORTED_STATUS: KdocsConnectionStatus = {
  phase: "disconnected",
  mcpConfigured: false,
  authorized: false,
  serverNames: [],
  message: null,
  errorCode: "desktop_only",
  errorMessage: null,
  lastCheckedAt: 0,
};

function kdocsTryPrompts(): string[] {
  return [
    t("plugins.kdocs_prompt_1"),
    t("plugins.kdocs_prompt_2"),
    t("plugins.kdocs_prompt_3"),
    t("plugins.kdocs_prompt_4"),
  ];
}

export function KdocsPluginCard(props: {
  onTryPrompt?: (prompt: string) => void;
}) {
  const reloadCoordinator = useReloadCoordinator();
  const [status, setStatus] = useState<KdocsConnectionStatus | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const finishConnected = useCallback(
    async (next?: KdocsConnectionStatus | null) => {
      const resolved = next ?? (await getKdocsStatus().catch(() => null));
      if (resolved) setStatus(resolved);
      setTokenOpen(false);
      setConnecting(false);
      setAuthError(null);
      setAccessToken("");
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "kdocs",
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
      setStatus(await getKdocsStatus());
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
    const unsubStatus = subscribeKdocsStatus((next) => {
      setStatus(next);
      if (next.authorized && next.phase === "connected" && connecting) {
        void finishConnected(next);
      }
    });
    const unsubProgress = subscribeKdocsAuthProgress((next) => {
      if (next.phase === "complete") {
        void finishConnected();
      }
    });
    return () => {
      unsubStatus();
      unsubProgress();
    };
  }, [connecting, finishConnected, refresh]);

  const busy = connecting || isKdocsBusy(status);
  const primaryAction = useMemo(() => getKdocsPrimaryAction(status), [status]);
  const canDisconnect = canDisconnectKdocs(status);
  const fullyConnected =
    status?.phase === "connected" && status.authorized === true;

  const cardStatus: ConnectorCardStatus = useMemo(() => {
    if (!status || busy) return "pending";
    if (status.phase === "error") return "error";
    if (fullyConnected) return "connected";
    if (status.errorCode === "desktop_only") return "error";
    return "idle";
  }, [busy, fullyConnected, status]);

  const openConnect = () => {
    if (!isDesktopRuntime()) return;
    setAuthError(null);
    setDetailOpen(false);
    setTokenOpen(true);
  };

  const submitToken = async () => {
    const token = accessToken.trim();
    if (!token || connecting) return;
    setConnecting(true);
    setAuthError(null);
    try {
      const next = await connectKdocsWithToken({ accessToken: token });
      if (next.authorized || next.phase === "connected") {
        await finishConnected(next);
        return;
      }
      setStatus(next);
      setAuthError(t("plugins.kdocs_error_hint"));
      setConnecting(false);
    } catch (error) {
      const raw =
        error instanceof Error ? error.message : t("plugins.kdocs_error_hint");
      setAuthError(formatDesktopConnectorError(raw, t("plugins.kdocs_error_hint")));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectOpen(false);
    setUnbinding(true);
    try {
      setStatus(await disconnectKdocs());
      setDetailOpen(false);
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "kdocs",
        action: "removed",
      });
    } catch {
      await refresh();
    } finally {
      setUnbinding(false);
    }
  };

  const tryPrompts = useMemo(() => kdocsTryPrompts(), []);
  const handleTryIt = () => {
    const prompt = tryPrompts[0];
    if (!prompt || !props.onTryPrompt) return;
    props.onTryPrompt(prompt);
    setDetailOpen(false);
  };

  return (
    <div className="min-w-0">
      <ConnectorStatusCard
        data-plugin-id="kdocs"
        name={t("plugins.kdocs_title")}
        description={t("plugins.kdocs_description")}
        iconSrc={KDOCS_ICON_SRC}
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
                t("plugins.kdocs_error_hint"),
              )
            : null
        }
        errorTitle={
          status?.phase === "error" && !status.authorized && status.errorMessage
            ? formatDesktopConnectorError(
                status.errorMessage,
                t("plugins.kdocs_error_hint"),
              )
            : null
        }
      />

      <ConnectorConnectDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={t("plugins.kdocs_title")}
        description={t("plugins.kdocs_description")}
        iconSrc={KDOCS_ICON_SRC}
        connected={fullyConnected}
        connecting={connecting}
        connectLabel={
          primaryAction === "retry"
            ? t("plugins.kdocs_retry")
            : t("plugins.kdocs_connect")
        }
        onConnect={!isDesktopRuntime() ? undefined : openConnect}
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
            ? t("plugins.kdocs_desktop_only")
            : authError
              ? authError
              : status?.phase === "error" && status.errorMessage
                ? formatDesktopConnectorError(
                    status.errorMessage,
                    t("plugins.kdocs_error_hint"),
                  )
              : fullyConnected
                ? t("plugins.kdocs_connected_note")
                : t("plugins.kdocs_token_hint")
        }
      />

      <ConfirmModal
        open={disconnectOpen}
        title={t("plugins.kdocs_disconnect_title")}
        message={t("plugins.kdocs_disconnect_message")}
        confirmLabel={t("plugins.kdocs_disconnect")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setDisconnectOpen(false)}
      />

      <Dialog
        open={tokenOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTokenOpen(false);
            setConnecting(false);
            setAuthError(null);
            setAccessToken("");
            void refresh();
          }
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,480px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
            <DialogTitle>{t("plugins.kdocs_token_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.kdocs_token_subtitle")}
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
                {t("plugins.kdocs_token_label")}
              </span>
              <Textarea
                className="min-h-20 resize-y bg-dls-surface"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={t("plugins.kdocs_token_placeholder")}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="text-xs text-dls-secondary">
              {t("plugins.kdocs_token_help")}
            </p>
          </div>
          <DialogFooter className="m-0 shrink-0 gap-2 rounded-b-xl border-t border-dls-border px-6 py-4 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTokenOpen(false);
                setAccessToken("");
                setAuthError(null);
              }}
            >
              {t("plugins.kdocs_cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!accessToken.trim() || connecting}
              onClick={() => void submitToken()}
            >
              {connecting
                ? t("common.connecting")
                : t("plugins.kdocs_token_submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
