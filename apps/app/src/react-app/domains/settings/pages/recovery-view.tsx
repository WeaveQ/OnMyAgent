/** @jsxImportSource react */
import { useMutation } from "@tanstack/react-query";
import { Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { revealDesktopItemInDir } from "@/app/lib/desktop";
import { isDesktopRuntime, isMacPlatform, isWindowsPlatform } from "@/app/utils";
import { t } from "@/i18n";
import { SettingsInset, SettingsNotice } from "../settings-section";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutStack,
} from "../settings-layout";

export type RecoveryViewProps = {
  workspaceConfigPath: string;
  configActionStatus: string | null;
  cacheRepairResult: string | null;
  dockerCleanupResult: string | null;
};

export function RecoveryView(props: RecoveryViewProps) {
  const revealConfigMutation = useMutation({
    mutationFn: (path: string) => revealDesktopItemInDir(path),
  });

  return (
    <LayoutStack>
      {!isDesktopRuntime() && (
        <Alert>
          <Info />
          <AlertTitle>{t("settings.recovery_requires_desktop_title")}</AlertTitle>
          <AlertDescription>{t("settings.recovery_requires_desktop")}</AlertDescription>
        </Alert>
      )}
      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.workspace_config_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.workspace_config_desc")}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Button
              variant="outline"
              size="sm"
              onClick={() => revealConfigMutation.mutate(props.workspaceConfigPath)}
              disabled={!isDesktopRuntime() || revealConfigMutation.isPending || !props.workspaceConfigPath}
            >
              {isWindowsPlatform()
                  ? t("workspace_list.reveal_explorer")
                  : isMacPlatform()
                    ? t("workspace_list.reveal_finder")
                    : t("workspace_list.reveal_file_manager")}
            </Button>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>

        <SettingsInset className="break-all font-mono text-xs text-muted-foreground">
          {props.workspaceConfigPath || t("settings.no_active_workspace")}
        </SettingsInset>

        <Alert>
          <Info />
          <AlertDescription>{t("settings.recovery_reset_config_unavailable")}</AlertDescription>
        </Alert>
        {revealConfigMutation.isError || props.configActionStatus ? (
          <SettingsNotice tone={revealConfigMutation.isError ? "error" : "neutral"}>
            {revealConfigMutation.isError
              ? revealConfigMutation.error?.message || t("mcp.reveal_config_failed")
              : props.configActionStatus}
          </SettingsNotice>
        ) : null}
      </LayoutSectionItem>

      <Separator />

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.opencode_cache")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.opencode_cache_description")}</LayoutSectionItemDescription>
        </LayoutSectionItemHeader>

        <Alert>
          <Info />
          <AlertDescription>{t("settings.recovery_cache_repair_unavailable")}</AlertDescription>
        </Alert>
        {props.cacheRepairResult ? <SettingsNotice>{props.cacheRepairResult}</SettingsNotice> : null}
      </LayoutSectionItem>

      <Separator />

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.docker_containers_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.docker_containers_desc")}</LayoutSectionItemDescription>
        </LayoutSectionItemHeader>

        <Alert>
          <Info />
          <AlertDescription>{t("settings.recovery_docker_cleanup_unavailable")}</AlertDescription>
        </Alert>
        {props.dockerCleanupResult ? <SettingsNotice>{props.dockerCleanupResult}</SettingsNotice> : null}
      </LayoutSectionItem>
    </LayoutStack>
  );
}
