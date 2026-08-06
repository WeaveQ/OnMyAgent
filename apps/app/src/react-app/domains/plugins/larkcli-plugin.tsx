/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import type {
  OfficeCliProgress,
  OfficeCliStatus,
} from "@onmyagent/types/officecli";
import type { LarkCliConnectionStatus } from "@onmyagent/types/lark-cli-auth";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
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
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

const LARKCLI_ICON_SRC = "/connector-icons/feishu.png";

import {
  connectorTileClassName,
  connectorTileDescClassName,
  connectorTileFooterClassName,
  connectorTileHeaderClassName,
} from "./connector-tile";
import { LarkCliConnectModal } from "./larkcli-connect-modal";
import {
  canUninstallLarkCli,
  getLarkCliPrimaryAction,
  getLarkCliStatusTone,
  isLarkCliBusy,
  type LarkCliPrimaryAction,
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

type OfficeCliStatusKey =
  | "plugins.larkcli_status_checking"
  | "plugins.larkcli_status_error"
  | "plugins.larkcli_status_installing"
  | "plugins.larkcli_status_installed"
  | "plugins.larkcli_status_not_installed"
  | "plugins.larkcli_status_uninstalling"
  | "plugins.larkcli_status_unsupported"
  | "plugins.larkcli_status_update_available"
  | "plugins.larkcli_status_updating";

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

function statusLabelKey(status: OfficeCliStatus): OfficeCliStatusKey {
  switch (status.state) {
    case "checking":
      return "plugins.larkcli_status_checking";
    case "installing":
      return "plugins.larkcli_status_installing";
    case "updating":
      return "plugins.larkcli_status_updating";
    case "uninstalling":
      return "plugins.larkcli_status_uninstalling";
    case "installed":
      return "plugins.larkcli_status_installed";
    case "update_available":
      return "plugins.larkcli_status_update_available";
    case "unsupported":
      return "plugins.larkcli_status_unsupported";
    case "error":
      return "plugins.larkcli_status_error";
    case "not_installed":
      return "plugins.larkcli_status_not_installed";
  }
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

function primaryActionLabel(action: LarkCliPrimaryAction): string {
  switch (action) {
    case "install":
      return t("plugins.larkcli_install");
    case "update":
      return t("plugins.larkcli_update");
    case "retry":
      return t("plugins.larkcli_retry");
  }
}

function primaryActionIcon(action: LarkCliPrimaryAction) {
  switch (action) {
    case "install":
      return Download;
    case "update":
      return RefreshCw;
    case "retry":
      return RotateCcw;
  }
}

function larkCliVersionSummary(status: OfficeCliStatus): string {
  if (!status.installedVersion) return t("plugins.larkcli_not_installed_hint");
  if (status.state === "update_available" && status.latestVersion) {
    return t("plugins.larkcli_update_hint", {
      installed: status.installedVersion,
      latest: status.latestVersion,
    });
  }
  return t("plugins.larkcli_installed_hint", {
    version: status.installedVersion,
  });
}

/**
 * lark-cli card for the connectors recommended-install grid.
 * Section chrome lives on PluginsPage (no separate "optional enhancements" band).
 */
function connectionBadge(
  connection: LarkCliConnectionStatus | null,
  installStatus: OfficeCliStatus | null,
): { tone: StatusBadgeTone; label: string } | null {
  if (!installStatus?.installedVersion && installStatus?.state !== "installed") {
    return null;
  }
  if (!connection || !connection.installed) {
    return { tone: "neutral", label: t("plugins.larkcli_badge_disconnected") };
  }
  switch (connection.phase) {
    case "connected_logged_in":
      return { tone: "success", label: t("plugins.larkcli_badge_logged_in") };
    case "connected_not_logged_in":
      return { tone: "success", label: t("plugins.larkcli_badge_connected") };
    case "installed_disconnected":
      return { tone: "neutral", label: t("plugins.larkcli_badge_disconnected") };
    case "error":
      return { tone: "danger", label: t("plugins.larkcli_status_error") };
    default:
      return { tone: "neutral", label: t("plugins.larkcli_badge_disconnected") };
  }
}

export function LarkCliPluginCard() {
  const [status, setStatus] = useState<OfficeCliStatus | null>(null);
  const [connection, setConnection] = useState<LarkCliConnectionStatus | null>(null);
  const [progress, setProgress] = useState<OfficeCliProgress | null>(null);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectStep, setConnectStep] = useState<1 | 2>(1);

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
  const installTone: StatusBadgeTone = status
    ? getLarkCliStatusTone(status)
    : "neutral";
  const connBadge = connectionBadge(connection, status);
  const canUninstall = status ? canUninstallLarkCli(status) : false;
  const installedReady =
    Boolean(status?.installedVersion) &&
    status?.state !== "not_installed" &&
    status?.state !== "unsupported" &&
    status?.supported !== false;

  const handlePrimaryAction = async () => {
    if (!status || !primaryAction || busy) return;
    if (primaryAction === "retry") {
      await refreshStatus(true);
      return;
    }

    setProgress({
      operation: primaryAction === "update" ? "update" : "install",
      phase: "checking",
    });
    setStatus({ ...status, state: primaryAction === "update" ? "updating" : "installing" });
    try {
      const next = await installLarkCli();
      setStatus(next);
      await refreshConnection();
      if (next.installedVersion || next.usable) {
        setConnectStep(1);
        setConnectOpen(true);
      }
    } catch (error) {
      setStatus(createErrorStatus(status, error));
    } finally {
      setProgress(null);
    }
  };

  const handleUninstall = async () => {
    if (!status || busy || !status.installedVersion) return;
    setUninstallConfirmOpen(false);
    setStatus({ ...status, state: "uninstalling" });
    setProgress({ operation: "uninstall", phase: "installing" });
    try {
      setStatus(await uninstallLarkCli());
      setConnection(null);
    } catch (error) {
      setStatus(createErrorStatus(status, error));
    } finally {
      setProgress(null);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectConfirmOpen(false);
    try {
      const next = await disconnectLarkCli({ clearCredentials: true });
      setConnection(next);
    } catch {
      await refreshConnection();
    }
  };

  const progressLabel = progress ? progressLabelKey(progress) : null;
  const PrimaryActionIcon = primaryAction ? primaryActionIcon(primaryAction) : null;
  const headerBadge = installedReady && connBadge ? connBadge : status
    ? { tone: installTone, label: t(statusLabelKey(status)) }
    : null;

  return (
    <div className="min-w-0">
      <article
        className={cn(connectorTileClassName, "cursor-default")}
        data-plugin-id="lark-cli"
        aria-busy={busy}
      >
        <div className={connectorTileHeaderClassName}>
          <div className="size-9 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-dls-surface">
            <img
              src={resolvePublicAssetUrl(LARKCLI_ICON_SRC)}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
              {t("plugins.larkcli_title")}
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
          title={t("plugins.larkcli_description")}
        >
          {status ? larkCliVersionSummary(status) : t("plugins.larkcli_checking")}
        </p>

        <div className={connectorTileFooterClassName}>
          {!status || status.state === "checking" ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-dls-secondary"
              aria-live="polite"
            >
              <LoadingSpinner size="sm" />
              {t("plugins.larkcli_checking")}
            </span>
          ) : progressLabel ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-dls-secondary"
              aria-live="polite"
            >
              <LoadingSpinner size="sm" />
              {t(progressLabel)}
            </span>
          ) : primaryAction && PrimaryActionIcon ? (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void handlePrimaryAction()}
            >
              <PrimaryActionIcon aria-hidden="true" />
              {primaryActionLabel(primaryAction)}
            </Button>
          ) : installedReady &&
            connection?.phase === "installed_disconnected" ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConnectStep(1);
                  setConnectOpen(true);
                }}
              >
                {t("plugins.larkcli_connect")}
              </Button>
              {canUninstall ? (
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setUninstallConfirmOpen(true)}
                >
                  <Trash2 aria-hidden="true" />
                  {t("plugins.larkcli_uninstall")}
                </Button>
              ) : null}
            </div>
          ) : installedReady &&
            connection?.phase === "connected_not_logged_in" ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConnectStep(2);
                  setConnectOpen(true);
                }}
              >
                {t("plugins.larkcli_go_login")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => setDisconnectConfirmOpen(true)}
              >
                {t("plugins.larkcli_disconnect")}
              </Button>
            </div>
          ) : installedReady && connection?.phase === "connected_logged_in" ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => setDisconnectConfirmOpen(true)}
              >
                {t("plugins.larkcli_disconnect")}
              </Button>
              {canUninstall ? (
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setUninstallConfirmOpen(true)}
                >
                  <Trash2 aria-hidden="true" />
                  {t("plugins.larkcli_uninstall")}
                </Button>
              ) : null}
            </div>
          ) : canUninstall ? (
            <Button
              size="xs"
              variant="destructive"
              disabled={busy}
              onClick={() => setUninstallConfirmOpen(true)}
            >
              <Trash2 aria-hidden="true" />
              {t("plugins.larkcli_uninstall")}
            </Button>
          ) : (
            <span className="text-xs text-dls-secondary">
              {status?.supported
                ? t("plugins.larkcli_desktop_only")
                : t("plugins.larkcli_unsupported_hint")}
            </span>
          )}
        </div>

        {status?.state === "error" ? (
          <NoticeBox tone="error" role="alert" className="mt-2">
            {t("plugins.larkcli_error_hint")}
          </NoticeBox>
        ) : null}
      </article>

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
