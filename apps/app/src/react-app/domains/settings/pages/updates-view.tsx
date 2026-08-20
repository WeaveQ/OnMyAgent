/** @jsxImportSource react */
import { CircleAlert, ExternalLink, Download } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, isMacPlatform } from "../../../../app/utils";
import { t } from "../../../../i18n";
import type { ReleaseChannel } from "../../../../app/types";
import { useStatusToasts } from "../../shell-feedback";
import {
  isUpToDateUpdateStatus,
  type SettingsUpdateStatus,
} from "../state/electron-updater-state";
import { SelectMenu } from "../../../design-system/select-menu";
import {
  SettingsBlock,
  SettingsBlockRow,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

export type UpdatesViewProps = {
  busy: boolean;
  webDeployment: boolean;
  appVersion: string | null;
  updateEnv: { supported?: boolean; reason?: string | null } | null;
  updateAutoCheck: boolean;
  toggleUpdateAutoCheck: () => void;
  /** @deprecated In-app downloads are driven by electron-updater; kept for call-site compat. */
  updateAutoDownload?: boolean;
  /** @deprecated In-app downloads are driven by electron-updater; kept for call-site compat. */
  toggleUpdateAutoDownload?: () => void;
  updateStatus: SettingsUpdateStatus;
  anyActiveRuns: boolean;
  checkForUpdates: () => void | Promise<void | SettingsUpdateStatus>;
  downloadUpdate: () => void | Promise<void>;
  installUpdateAndRestart: () => void | Promise<void>;
  installing?: boolean;
  /** Currently selected release channel. Optional; callers may omit. */
  releaseChannel?: ReleaseChannel;
  /**
   * Change the release channel. When not provided, the channel row is
   * rendered read-only — useful for contexts where the pref can't be
   * mutated (e.g. web preview).
   */
  onReleaseChannelChange?: (next: ReleaseChannel) => void;
  /**
   * Whether the alpha channel is available. The updater reports false;
   * when false the channel selector is hidden.
   */
  alphaChannelSupported?: boolean;
};

function formatBytes(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function UpdatesView(props: UpdatesViewProps) {
  const { showToast } = useStatusToasts();
  const updateState = props.updateStatus?.state ?? "idle";
  const updateVersion = props.updateStatus?.version ?? null;
  const updateDate = props.updateStatus?.date ?? null;
  const updateLastCheckedAt = props.updateStatus?.lastCheckedAt ?? null;
  const updateErrorMessage = props.updateStatus?.message ?? null;
  // Prefer main-reported flow; default open-browser only when still unknown
  // (web / bridge missing). Packaged mac/win seed "in-app" via getChannel.
  const platformFlow = props.updateStatus?.platformFlow ?? "open-browser";
  const inAppFlow = platformFlow === "in-app";
  const macQuarantine =
    props.updateStatus?.macQuarantineNotice === true && isMacPlatform();
  const percent =
    typeof props.updateStatus?.percent === "number"
      ? Math.max(0, Math.min(100, Math.round(props.updateStatus.percent)))
      : null;
  const downloadedBytes = formatBytes(props.updateStatus?.downloadedBytes);
  const totalBytes = formatBytes(props.updateStatus?.totalBytes);
  const softNotice =
    updateErrorMessage &&
    (props.updateStatus?.soft || updateState === "idle") &&
    (updateState === "idle" || updateState === "error" || updateState === "ready")
      ? updateErrorMessage
      : null;
  const hardError =
    updateErrorMessage &&
    !props.updateStatus?.soft &&
    (updateState === "error" || updateState === "ready")
      ? updateErrorMessage
      : null;
  const showOpenReleaseWithSoft =
    Boolean(softNotice) && props.updateStatus?.showOpenReleasePage !== false;

  const envBlocked =
    props.webDeployment ||
    (props.updateEnv != null && props.updateEnv.supported === false);

  const versionDescription = (() => {
    if (!props.appVersion) return t("settings.updates_not_supported");
    const version = `v${props.appVersion}`;
    if (!updateLastCheckedAt) return version;
    return `${version} · ${t("settings.update_last_checked", undefined, {
      time: formatRelativeTime(updateLastCheckedAt),
    })}`;
  })();

  const primaryActionLabel =
    updateState === "downloading"
      ? t("settings.update_downloading", undefined, {
          percent: percent ?? 0,
        })
      : updateState === "ready"
        ? t("settings.restart_and_install")
        : inAppFlow
          ? t("settings.download_update")
          : t("settings.open_release_page");

  return (
    <LayoutStack>
      {hardError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{hardError}</AlertDescription>
        </Alert>
      ) : null}

      {softNotice ? (
        <Alert>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{softNotice}</span>
            {showOpenReleaseWithSoft ? (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                onClick={() => void props.downloadUpdate()}
              >
                {t("settings.open_release_page")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {props.webDeployment ? (
        <Alert>
          <AlertDescription>
            {t("settings.updates_desktop_only")}
          </AlertDescription>
        </Alert>
      ) : props.updateEnv && props.updateEnv.supported === false ? (
        <Alert>
          <AlertDescription>
            {props.updateEnv.reason ?? t("settings.updates_not_supported")}
          </AlertDescription>
        </Alert>
      ) : null}

      <SettingsBlock>
        <SettingsBlockRow
          title={t("settings.shell_view_current_version_description")}
          description={versionDescription}
          actions={
            envBlocked ? undefined : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void (async () => {
                    const status = await props.checkForUpdates();
                    if (isUpToDateUpdateStatus(status ?? null)) {
                      showToast({
                        tone: "success",
                        title: t("account_menu.update_latest"),
                      });
                    }
                  })();
                }}
                disabled={props.busy || updateState === "checking"}
              >
                {updateState === "checking"
                  ? t("settings.checking_for_updates")
                  : t("settings.check_for_updates")}
              </Button>
            )
          }
        />

        {updateState === "available" && updateVersion ? (
          <SettingsBlockRow
            title={t("settings.update_available_version", undefined, {
              version: updateVersion,
            })}
            description={
              updateDate
                ? t("settings.update_published", undefined, {
                    date: updateDate,
                  })
                : inAppFlow
                  ? t("settings.update_ready_to_download_desc")
                  : t("settings.open_release_page")
            }
            actions={
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => void props.downloadUpdate()}
              >
                {inAppFlow ? (
                  <Download className="size-3.5" />
                ) : (
                  <ExternalLink className="size-3.5" />
                )}
                {primaryActionLabel}
              </Button>
            }
          />
        ) : null}

        {updateState === "downloading" && updateVersion ? (
          <SettingsBlockRow
            title={t("settings.update_downloading_title", undefined, {
              version: updateVersion,
            })}
            description={
              <div className="flex flex-col gap-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-dls-surface-muted">
                  <div
                    className="h-full rounded-full bg-dls-accent transition-[width] duration-300"
                    style={{ width: `${percent ?? 0}%` }}
                  />
                </div>
                <span className="text-xs text-dls-secondary">
                  {downloadedBytes && totalBytes
                    ? `${downloadedBytes} / ${totalBytes}`
                    : t("settings.update_downloading", undefined, {
                        percent: percent ?? 0,
                      })}
                </span>
              </div>
            }
          />
        ) : null}

        {updateState === "ready" && updateVersion ? (
          <SettingsBlockRow
            title={t("settings.update_ready_title", undefined, {
              version: updateVersion,
            })}
            description={
              macQuarantine
                ? t("settings.update_mac_quarantine_notice")
                : t("settings.update_ready_desc")
            }
            actions={
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={props.installing === true}
                onClick={() => void props.installUpdateAndRestart()}
              >
                {props.installing
                  ? t("settings.update_installing")
                  : t("settings.restart_and_install")}
              </Button>
            }
          />
        ) : null}

        {props.alphaChannelSupported && props.releaseChannel ? (
          <SettingsBlockRow
            title={t("settings.shell_view_release_channel")}
            description={t("settings.shell_view_release_channel_description")}
            actions={
              props.onReleaseChannelChange ? (
                <SelectMenu
                  ariaLabel={t("settings.shell_view_release_channel")}
                  options={[
                    {
                      value: "stable",
                      label: t("settings.shell_view_release_channel_stable"),
                    },
                    {
                      value: "alpha",
                      label: t("settings.shell_view_release_channel_alpha"),
                    },
                  ]}
                  value={props.releaseChannel}
                  disabled={props.busy}
                  onChange={(value) =>
                    props.onReleaseChannelChange?.(
                      value === "alpha" ? "alpha" : "stable",
                    )
                  }
                />
              ) : (
                <span className="text-sm text-dls-secondary">
                  {props.releaseChannel === "alpha"
                    ? t("settings.shell_view_release_channel_alpha")
                    : t("settings.shell_view_release_channel_stable")}
                </span>
              )
            }
          />
        ) : null}

        <SettingsBlockRow
          title={t("settings.update_install_title")}
          description={
            inAppFlow
              ? t("settings.update_install_desc_in_app")
              : t("settings.update_install_desc")
          }
        />
      </SettingsBlock>
    </LayoutStack>
  );
}
