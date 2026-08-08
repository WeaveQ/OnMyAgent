/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DingtalkConnectionStatus } from "@onmyagent/types/dingtalk-connector";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  connectDingtalkWithCredentials,
  disconnectDingtalk,
  getDingtalkStatus,
  subscribeDingtalkAuthProgress,
  subscribeDingtalkStatus,
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
  canDisconnectDingtalk,
  getDingtalkPrimaryAction,
  isDingtalkBusy,
} from "./dingtalk-plugin-state";

const DINGTALK_ICON_SRC = "/connector-icons/dingtalk.png";

const UNSUPPORTED_STATUS: DingtalkConnectionStatus = {
  phase: "disconnected",
  mcpConfigured: false,
  authorized: false,
  serverNames: [],
  message: null,
  errorCode: "desktop_only",
  errorMessage: null,
  lastCheckedAt: 0,
};

function dingtalkTryPrompts(): string[] {
  return [
    t("plugins.dingtalk_prompt_1"),
    t("plugins.dingtalk_prompt_2"),
    t("plugins.dingtalk_prompt_3"),
    t("plugins.dingtalk_prompt_4"),
  ];
}

export function DingtalkPluginCard(props: {
  onTryPrompt?: (prompt: string) => void;
}) {
  const reloadCoordinator = useReloadCoordinator();
  const [status, setStatus] = useState<DingtalkConnectionStatus | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const finishConnected = useCallback(
    async (next?: DingtalkConnectionStatus | null) => {
      const resolved = next ?? (await getDingtalkStatus().catch(() => null));
      if (resolved) setStatus(resolved);
      setCredOpen(false);
      setConnecting(false);
      setAuthError(null);
      setClientId("");
      setClientSecret("");
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "dingtalk",
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
      setStatus(await getDingtalkStatus());
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
    const unsubStatus = subscribeDingtalkStatus((next) => {
      setStatus(next);
      if (next.authorized && next.phase === "connected" && connecting) {
        void finishConnected(next);
      }
    });
    const unsubProgress = subscribeDingtalkAuthProgress((next) => {
      if (next.phase === "complete") {
        void finishConnected();
      }
    });
    return () => {
      unsubStatus();
      unsubProgress();
    };
  }, [connecting, finishConnected, refresh]);

  const busy = connecting || isDingtalkBusy(status);
  const primaryAction = useMemo(
    () => getDingtalkPrimaryAction(status),
    [status],
  );
  const canDisconnect = canDisconnectDingtalk(status);
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
    setCredOpen(true);
  };

  const submitCredentials = async () => {
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (!id || !secret || connecting) return;
    setConnecting(true);
    setAuthError(null);
    try {
      const next = await connectDingtalkWithCredentials({
        clientId: id,
        clientSecret: secret,
      });
      if (next.authorized || next.phase === "connected") {
        await finishConnected(next);
        return;
      }
      setStatus(next);
      setAuthError(t("plugins.dingtalk_error_hint"));
      setConnecting(false);
    } catch (error) {
      const raw =
        error instanceof Error
          ? error.message
          : t("plugins.dingtalk_error_hint");
      setAuthError(formatDesktopConnectorError(raw, t("plugins.dingtalk_error_hint")));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectOpen(false);
    setUnbinding(true);
    try {
      setStatus(await disconnectDingtalk());
      setDetailOpen(false);
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "dingtalk",
        action: "removed",
      });
    } catch {
      await refresh();
    } finally {
      setUnbinding(false);
    }
  };

  const tryPrompts = useMemo(() => dingtalkTryPrompts(), []);
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
        data-plugin-id="dingtalk"
        name={t("plugins.dingtalk_title")}
        description={t("plugins.dingtalk_description")}
        iconSrc={DINGTALK_ICON_SRC}
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
                t("plugins.dingtalk_error_hint"),
              )
            : null
        }
        errorTitle={
          status?.phase === "error" && !status.authorized && status.errorMessage
            ? formatDesktopConnectorError(
                status.errorMessage,
                t("plugins.dingtalk_error_hint"),
              )
            : null
        }
      />

      <ConnectorConnectDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={t("plugins.dingtalk_title")}
        description={t("plugins.dingtalk_description")}
        iconSrc={DINGTALK_ICON_SRC}
        connected={fullyConnected}
        connecting={connecting}
        connectLabel={
          primaryAction === "retry"
            ? t("plugins.dingtalk_retry")
            : t("plugins.dingtalk_connect")
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
            ? t("plugins.dingtalk_desktop_only")
            : authError
              ? authError
              : status?.phase === "error" && status.errorMessage
                ? formatDesktopConnectorError(
                    status.errorMessage,
                    t("plugins.dingtalk_error_hint"),
                  )
              : fullyConnected
                ? t("plugins.dingtalk_connected_note")
                : t("plugins.dingtalk_cred_hint")
        }
      />

      <ConfirmModal
        open={disconnectOpen}
        title={t("plugins.dingtalk_disconnect_title")}
        message={t("plugins.dingtalk_disconnect_message")}
        confirmLabel={t("plugins.dingtalk_disconnect")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setDisconnectOpen(false)}
      />

      <Dialog
        open={credOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCredOpen(false);
            setConnecting(false);
            setAuthError(null);
            setClientId("");
            setClientSecret("");
            void refresh();
          }
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,520px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
            <DialogTitle>{t("plugins.dingtalk_cred_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.dingtalk_cred_subtitle")}
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
                {t("plugins.dingtalk_client_id_label")}
              </span>
              <input
                className={inputClass}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={t("plugins.dingtalk_client_id_placeholder")}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-dls-secondary">
                {t("plugins.dingtalk_client_secret_label")}
              </span>
              <input
                className={inputClass}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={t("plugins.dingtalk_client_secret_placeholder")}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="text-xs text-dls-secondary">
              {t("plugins.dingtalk_cred_help")}
            </p>
          </div>
          <DialogFooter className="m-0 shrink-0 gap-2 rounded-b-xl border-t border-dls-border px-6 py-4 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCredOpen(false);
                setClientId("");
                setClientSecret("");
                setAuthError(null);
              }}
            >
              {t("plugins.dingtalk_cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!clientId.trim() || !clientSecret.trim() || connecting}
              onClick={() => void submitCredentials()}
            >
              {connecting
                ? t("common.connecting")
                : t("plugins.dingtalk_cred_submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
