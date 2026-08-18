/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TencentMeetingConnectionStatus } from "@onmyagent/types/tencent-meeting-connector";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  connectTencentMeetingWithToken,
  disconnectTencentMeeting,
  getTencentMeetingStatus,
  openTencentMeetingTokenPage,
  subscribeTencentMeetingAuthProgress,
  subscribeTencentMeetingStatus,
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
  canDisconnectTencentMeeting,
  getTencentMeetingPrimaryAction,
  isTencentMeetingBusy,
} from "./tencent-meeting-plugin-state";

const TENCENT_MEETING_ICON_SRC = "/connector-icons/tencent-meeting.png";

const UNSUPPORTED_STATUS: TencentMeetingConnectionStatus = {
  phase: "disconnected",
  mcpConfigured: false,
  authorized: false,
  serverNames: [],
  message: null,
  errorCode: "desktop_only",
  errorMessage: null,
  lastCheckedAt: 0,
};

function meetingTryPrompts(): string[] {
  return [
    t("plugins.tencent_meeting_prompt_1"),
    t("plugins.tencent_meeting_prompt_2"),
    t("plugins.tencent_meeting_prompt_3"),
    t("plugins.tencent_meeting_prompt_4"),
  ];
}

export function TencentMeetingPluginCard(props: {
  onTryPrompt?: (prompt: string) => void;
}) {
  const reloadCoordinator = useReloadCoordinator();
  const [status, setStatus] = useState<TencentMeetingConnectionStatus | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const finishConnected = useCallback(
    async (next?: TencentMeetingConnectionStatus | null) => {
      const resolved =
        next ?? (await getTencentMeetingStatus().catch(() => null));
      if (resolved) setStatus(resolved);
      setTokenOpen(false);
      setConnecting(false);
      setAuthError(null);
      setAccessToken("");
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "tencent-meeting",
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
      setStatus(await getTencentMeetingStatus());
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
    const unsubStatus = subscribeTencentMeetingStatus((next) => {
      setStatus(next);
      if (next.authorized && next.phase === "connected" && connecting) {
        void finishConnected(next);
      }
    });
    const unsubProgress = subscribeTencentMeetingAuthProgress((next) => {
      if (next.phase === "complete") void finishConnected();
    });
    return () => {
      unsubStatus();
      unsubProgress();
    };
  }, [connecting, finishConnected, refresh]);

  const busy = connecting || isTencentMeetingBusy(status);
  const primaryAction = useMemo(
    () => getTencentMeetingPrimaryAction(status),
    [status],
  );
  const canDisconnect = canDisconnectTencentMeeting(status);
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
      const next = await connectTencentMeetingWithToken({
        accessToken: token,
      });
      if (next.authorized || next.phase === "connected") {
        await finishConnected(next);
        return;
      }
      setStatus(next);
      setAuthError(t("plugins.tencent_meeting_error_hint"));
      setConnecting(false);
    } catch (error) {
      const raw =
        error instanceof Error
          ? error.message
          : t("plugins.tencent_meeting_error_hint");
      setAuthError(formatDesktopConnectorError(raw, t("plugins.tencent_meeting_error_hint")));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectOpen(false);
    setUnbinding(true);
    try {
      setStatus(await disconnectTencentMeeting());
      setDetailOpen(false);
      reloadCoordinator.markReloadRequired("mcp", {
        type: "mcp",
        name: "tencent-meeting",
        action: "removed",
      });
    } catch {
      await refresh();
    } finally {
      setUnbinding(false);
    }
  };

  const tryPrompts = useMemo(() => meetingTryPrompts(), []);
  const handleTryIt = () => {
    const prompt = tryPrompts[0];
    if (!prompt || !props.onTryPrompt) return;
    props.onTryPrompt(prompt);
    setDetailOpen(false);
  };

  return (
    <div className="min-w-0">
      <ConnectorStatusCard
        data-plugin-id="tencent-meeting"
        name={t("plugins.tencent_meeting_title")}
        description={t("plugins.tencent_meeting_description")}
        iconSrc={TENCENT_MEETING_ICON_SRC}
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
                t("plugins.tencent_meeting_error_hint"),
              )
            : null
        }
        errorTitle={
          status?.phase === "error" && !status.authorized && status.errorMessage
            ? formatDesktopConnectorError(
                status.errorMessage,
                t("plugins.tencent_meeting_error_hint"),
              )
            : null
        }
      />

      <ConnectorConnectDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={t("plugins.tencent_meeting_title")}
        description={t("plugins.tencent_meeting_description")}
        iconSrc={TENCENT_MEETING_ICON_SRC}
        connected={fullyConnected}
        connecting={connecting}
        connectLabel={
          primaryAction === "retry"
            ? t("plugins.tencent_meeting_retry")
            : t("plugins.tencent_meeting_connect")
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
            ? t("plugins.tencent_meeting_desktop_only")
            : authError
              ? authError
              : status?.phase === "error" && status.errorMessage
                ? formatDesktopConnectorError(
                    status.errorMessage,
                    t("plugins.tencent_meeting_error_hint"),
                  )
              : fullyConnected
                ? t("plugins.tencent_meeting_connected_note")
                : t("plugins.tencent_meeting_token_hint")
        }
      />

      <ConfirmModal
        open={disconnectOpen}
        title={t("plugins.tencent_meeting_disconnect_title")}
        message={t("plugins.tencent_meeting_disconnect_message")}
        confirmLabel={t("plugins.tencent_meeting_disconnect")}
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
        <DialogContent className="flex max-h-[min(90vh,500px)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-2 pt-6">
            <DialogTitle>{t("plugins.tencent_meeting_token_title")}</DialogTitle>
            <DialogDescription>
              {t("plugins.tencent_meeting_token_subtitle")}
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
                {t("plugins.tencent_meeting_token_label")}
              </span>
              <Textarea
                className="min-h-20 resize-y bg-dls-surface"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={t("plugins.tencent_meeting_token_placeholder")}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="text-xs text-dls-secondary">
              {t("plugins.tencent_meeting_token_help")}
            </p>
          </div>
          <DialogFooter className="m-0 shrink-0 flex-wrap gap-2 rounded-b-xl border-t border-dls-border px-6 py-4 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTokenOpen(false);
                setAccessToken("");
                setAuthError(null);
              }}
            >
              {t("plugins.tencent_meeting_cancel")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openTencentMeetingTokenPage()}
            >
              {t("plugins.tencent_meeting_open_token_page")}
            </Button>
            <Button
              size="sm"
              disabled={!accessToken.trim() || connecting}
              onClick={() => void submitToken()}
            >
              {connecting
                ? t("common.connecting")
                : t("plugins.tencent_meeting_token_submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
