/** @jsxImportSource react */
import { CircleAlert, ExternalLink } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import type { ReleaseChannel } from "../../../../app/types";
import type { SettingsUpdateStatus } from "../state/electron-updater-state";
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
  /** @deprecated No in-app download; ignored by the lightweight updater. */
  updateAutoDownload?: boolean;
  /** @deprecated No in-app download; ignored by the lightweight updater. */
  toggleUpdateAutoDownload?: () => void;
  updateStatus: SettingsUpdateStatus;
  anyActiveRuns: boolean;
  checkForUpdates: () => void | Promise<void>;
  downloadUpdate: () => void | Promise<void>;
  installUpdateAndRestart: () => void | Promise<void>;
  /** Currently selected release channel. Optional; callers may omit. */
  releaseChannel?: ReleaseChannel;
  /**
   * Change the release channel. When not provided, the channel row is
   * rendered read-only — useful for contexts where the pref can't be
   * mutated (e.g. web preview).
   */
  onReleaseChannelChange?: (next: ReleaseChannel) => void;
  /**
   * Whether the alpha channel is available. Lightweight updater reports
   * false; when false the channel selector is hidden.
   */
  alphaChannelSupported?: boolean;
};

export function UpdatesView(props: UpdatesViewProps) {
  const updateState = props.updateStatus?.state ?? "idle";
  const updateVersion = props.updateStatus?.version ?? null;
  const updateDate = props.updateStatus?.date ?? null;
  const updateLastCheckedAt = props.updateStatus?.lastCheckedAt ?? null;
  const updateErrorMessage = props.updateStatus?.message ?? null;
  const softNotice =
    (updateState === "idle" || updateState === "error") &&
    updateErrorMessage &&
    (props.updateStatus?.soft || updateState === "idle")
      ? updateErrorMessage
      : null;
  const hardError =
    updateState === "error" && updateErrorMessage && !props.updateStatus?.soft
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
                onClick={() => void props.checkForUpdates()}
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
                : t("settings.open_release_page")
            }
            actions={
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => void props.downloadUpdate()}
              >
                {t("settings.open_release_page")}
                <ExternalLink className="size-3.5" />
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
          description={t("settings.update_install_desc")}
        />
      </SettingsBlock>
    </LayoutStack>
  );
}
