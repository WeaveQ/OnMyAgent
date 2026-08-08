/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  OfficeCliProgress,
  OfficeCliStatus,
} from "@onmyagent/types/officecli";
import type { LarkCliConnectionStatus } from "@onmyagent/types/lark-cli-auth";

import { NoticeBox } from "@/components/ui/notice-box";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  disconnectLarkCli,
  getLarkCliConnectionStatus,
  getLarkCliStatus,
  installLarkCli,
  subscribeLarkCliProgress,
  subscribeLarkCliStatus,
  uninstallLarkCli,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";

const LARKCLI_ICON_SRC = "/connector-icons/feishu.png";

import { ConnectorConnectDialog } from "./connector-connect-dialog";
import {
  ConnectorStatusCard,
  type ConnectorCardStatus,
} from "./connector-status-card";
import { LarkCliConnectModal } from "./larkcli-connect-modal";
import {
  canUninstallLarkCli,
  getLarkCliPrimaryAction,
  isLarkCliBusy,
} from "./larkcli-plugin-state";

const LARKCLI_UNSUPPORTED_STATUS = {
  pluginId: "lark-cli",
  state: "unsupported",
  supported: false,
  platform: "web",
  installedVersion: null,
  latestVersion: null,
  previousVersion: null,
  usable: false,
  lastCheckedAt: null,
} satisfies OfficeCliStatus;

type OfficeCliProgressKey =
  | "plugins.larkcli_progress_checking"
  | "plugins.larkcli_progress_downloading_binary"
  | "plugins.larkcli_progress_downloading_manifest"
  | "plugins.larkcli_progress_downloading_skill"
  | "plugins.larkcli_progress_downloading_skills_pack"
  | "plugins.larkcli_progress_installing"
  | "plugins.larkcli_progress_refreshing_skills"
  | "plugins.larkcli_progress_uninstalling"
  | "plugins.larkcli_progress_verifying";

function createErrorStatus(
  current: OfficeCliStatus | null,
  error: unknown,
): OfficeCliStatus {
  const errorCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : error &&
          typeof error === "object" &&
          "errorCode" in error &&
          typeof error.errorCode === "string"
        ? error.errorCode
        : "lark_cli_error";
  return {
    ...(current ?? {
      ...LARKCLI_UNSUPPORTED_STATUS,
      supported: true,
      platform: "unknown",
    }),
    state: "error",
    errorCode,
    errorMessage: undefined,
  };
}

function progressLabelKey(progress: OfficeCliProgress): OfficeCliProgressKey | null {
  if (progress.operation === "uninstall" && progress.phase === "installing") {
    return "plugins.larkcli_progress_uninstalling";
  }
  switch (progress.phase) {
    case "checking":
      return "plugins.larkcli_progress_checking";
    case "downloading_manifest":
      return "plugins.larkcli_progress_downloading_manifest";
    case "downloading_binary":
      return "plugins.larkcli_progress_downloading_binary";
    case "downloading_skill":
      return "plugins.larkcli_progress_downloading_skill";
    case "downloading_skills_pack":
      return "plugins.larkcli_progress_downloading_skills_pack";
    case "verifying":
      return "plugins.larkcli_progress_verifying";
    case "installing":
      return "plugins.larkcli_progress_installing";
    case "refreshing_skills":
      return "plugins.larkcli_progress_refreshing_skills";
    case "complete":
      return null;
  }
}

function larkTryPrompts(): string[] {
  return [
    t("plugins.larkcli_prompt_1"),
    t("plugins.larkcli_prompt_2"),
    t("plugins.larkcli_prompt_3"),
  ];
}

/**
 * lark-cli card for the connectors recommended-install grid.
 * P1 status card + P0 connect dialog; multi-step OAuth stays in LarkCliConnectModal.
 */
export function LarkCliPluginCard(props: {
  onTryPrompt?: (prompt: string) => void;
}) {
  const [status, setStatus] = useState<OfficeCliStatus | null>(null);
  const [connection, setConnection] = useState<LarkCliConnectionStatus | null>(null);
  const [progress, setProgress] = useState<OfficeCliProgress | null>(null);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectStep, setConnectStep] = useState<1 | 2>(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const refreshConnection = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    try {
      setConnection(await getLarkCliConnectionStatus());
    } catch {
      // keep previous
    }
  }, []);

  const refreshStatus = useCallback(async (forceRefresh: boolean) => {
    if (!isDesktopRuntime()) {
      setStatus(LARKCLI_UNSUPPORTED_STATUS);
      return;
    }

    setStatus((current) =>
      current ? { ...current, state: "checking", errorCode: undefined } : current,
    );
    try {
      setStatus(await getLarkCliStatus({ forceRefresh }));
      await refreshConnection();
    } catch (error) {
      setStatus((current) => createErrorStatus(current, error));
    }
  }, [refreshConnection]);

  useEffect(() => {
    void refreshStatus(true);
    if (!isDesktopRuntime()) return undefined;
    const unsubscribeProgress = subscribeLarkCliProgress((nextProgress) => {
      setProgress(nextProgress.phase === "complete" ? null : nextProgress);
    });
    const unsubscribeStatus = subscribeLarkCliStatus((nextStatus) => {
      setStatus(nextStatus);
      void refreshConnection();
    });
    return () => {
      unsubscribeProgress();
      unsubscribeStatus();
    };
  }, [refreshStatus, refreshConnection]);

  const primaryAction = useMemo(
    () => (status ? getLarkCliPrimaryAction(status) : null),
    [status],
  );
  const busy = status ? isLarkCliBusy(status) : true;
  const canUninstall =
    Boolean(status && canUninstallLarkCli(status)) &&
    (connection?.phase === "installed_disconnected" ||
      connection?.phase === "not_installed" ||
      (!connection && Boolean(status?.installedVersion)));
  const installedReady =
    Boolean(status?.installedVersion) &&
    status?.state !== "not_installed" &&
    status?.state !== "unsupported" &&
    status?.supported !== false;
  const fullyConnected = connection?.phase === "connected_logged_in";
  const needsLogin = connection?.phase === "connected_not_logged_in";

  const cardStatus: ConnectorCardStatus = useMemo(() => {
    if (!status || busy || progress) return "pending";
    if (status.state === "error" || connection?.phase === "error") return "error";
    if (fullyConnected) return "connected";
    if (needsLogin) return "pending";
    if (status.state === "unsupported") return "error";
    return "idle";
  }, [busy, connection?.phase, fullyConnected, needsLogin, progress, status]);

  const handleInstallOrUpdate = async () => {
    if (!status || !primaryAction || busy) return;
    if (primaryAction === "retry") {
      await refreshStatus(true);
      return;
    }
    setProgress({
      operation: primaryAction === "update" ? "update" : "install",
      phase: "checking",
    });
    setStatus({
      ...status,
      state: primaryAction === "update" ? "updating" : "installing",
    });
    try {
      const next = await installLarkCli();
      setStatus(next);
      await refreshConnection();
      if (next.installedVersion || next.usable) {
        setConnectStep(1);
        setDetailOpen(false);
        setConnectOpen(true);
      }
    } catch (error) {
      setStatus(createErrorStatus(status, error));
    } finally {
      setProgress(null);
    }
  };

  const openAuthFlow = (step: 1 | 2) => {
    setConnectStep(step);
    setDetailOpen(false);
    setConnectOpen(true);
  };

  const handleDetailConnect = async () => {
    if (!isDesktopRuntime()) return;
    if (primaryAction) {
      await handleInstallOrUpdate();
      return;
    }
    if (needsLogin) {
      openAuthFlow(2);
      return;
    }
    if (installedReady) {
      openAuthFlow(1);
      return;
    }
    // Not installed and no primary action (edge) — force check/install.
    await refreshStatus(true);
  };

  const handleUninstall = async () => {
    if (!status || busy || !status.installedVersion || !canUninstall) return;
    setUninstallConfirmOpen(false);
    setStatus({ ...status, state: "uninstalling" });
    setProgress({ operation: "uninstall", phase: "installing" });
    try {
      setStatus(await uninstallLarkCli());
      setConnection(null);
      setDetailOpen(false);
    } catch (error) {
      setStatus(createErrorStatus(status, error));
    } finally {
      setProgress(null);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectConfirmOpen(false);
    setUnbinding(true);
    try {
      const next = await disconnectLarkCli({ clearCredentials: true });
      setConnection(next);
      setDetailOpen(false);
    } catch {
      await refreshConnection();
    } finally {
      setUnbinding(false);
    }
  };

  const tryPrompts = useMemo(() => larkTryPrompts(), []);
  const handleTryIt = () => {
    const prompt = tryPrompts[0];
    if (!prompt) return;
    props.onTryPrompt?.(prompt);
    setDetailOpen(false);
  };
  const handleSelectPrompt = (prompt: string) => {
    props.onTryPrompt?.(prompt);
    setDetailOpen(false);
  };

  const progressLabel = progress ? progressLabelKey(progress) : null;
  const footerNote = !isDesktopRuntime()
    ? t("plugins.larkcli_desktop_only")
    : status?.state === "error"
      ? t("plugins.larkcli_error_hint")
      : progressLabel
        ? t(progressLabel)
        : status && !status.supported
          ? t("plugins.larkcli_unsupported_hint")
          : null;

  return (
    <div className="min-w-0">
      <ConnectorStatusCard
        data-plugin-id="lark-cli"
        name={t("plugins.larkcli_title")}
        description={t("plugins.larkcli_description")}
        iconSrc={LARKCLI_ICON_SRC}
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
        footer={
          status?.state === "error" ? (
            <NoticeBox tone="error" role="alert" className="mt-1 py-1.5 text-xs">
              {t("plugins.larkcli_error_hint")}
            </NoticeBox>
          ) : null
        }
      />

      <ConnectorConnectDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={t("plugins.larkcli_title")}
        description={t("plugins.larkcli_description")}
        iconSrc={LARKCLI_ICON_SRC}
        connected={fullyConnected}
        connecting={busy}
        connectLabel={
          needsLogin
            ? t("plugins.larkcli_go_login")
            : primaryAction === "install"
              ? t("plugins.larkcli_install")
              : primaryAction === "update"
                ? t("plugins.larkcli_update")
                : primaryAction === "retry"
                  ? t("plugins.larkcli_retry")
                  : t("plugins.larkcli_connect")
        }
        onConnect={() => void handleDetailConnect()}
        onTryIt={fullyConnected ? handleTryIt : undefined}
        onUnbind={
          fullyConnected || needsLogin
            ? () => setDisconnectConfirmOpen(true)
            : canUninstall
              ? () => setUninstallConfirmOpen(true)
              : undefined
        }
        unbindLabel={
          fullyConnected || needsLogin
            ? t("plugins.connector_unbind")
            : t("plugins.larkcli_uninstall")
        }
        unbinding={unbinding}
        tryThisPrompts={tryPrompts}
        promptsDisabled={!props.onTryPrompt || !fullyConnected}
        onSelectPrompt={
          fullyConnected && props.onTryPrompt ? handleSelectPrompt : undefined
        }
        footerNote={footerNote}
      />

      <ConfirmModal
        open={uninstallConfirmOpen}
        title={t("plugins.larkcli_uninstall_title")}
        message={t("plugins.larkcli_uninstall_message")}
        confirmLabel={t("plugins.larkcli_uninstall")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleUninstall()}
        onCancel={() => setUninstallConfirmOpen(false)}
      />
      <ConfirmModal
        open={disconnectConfirmOpen}
        title={t("plugins.larkcli_disconnect_title")}
        message={t("plugins.larkcli_disconnect_message")}
        confirmLabel={t("plugins.larkcli_disconnect")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setDisconnectConfirmOpen(false)}
      />
      <LarkCliConnectModal
        open={connectOpen}
        initialStep={connectStep}
        initialTab="qr"
        onOpenChange={setConnectOpen}
        onConnectionChange={setConnection}
      />
    </div>
  );
}

/** @deprecated Use LarkCliPluginCard inside the recommended-install grid. */
export function LarkCliPluginSection() {
  return <LarkCliPluginCard />;
}
