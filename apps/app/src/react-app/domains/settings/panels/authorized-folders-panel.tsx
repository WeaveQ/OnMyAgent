/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useReducer, type SetStateAction } from "react";
import { Folder, Info, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import type {
  OnMyAgentServerCapabilities,
  OnMyAgentServerClient,
  OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";
import { pickDirectory } from "../../../../app/lib/desktop";
import {
  isDesktopRuntime,
  safeStringify,
} from "../../../../app/utils";
import {
  authorizedFoldersReducer,
  buildAuthorizedFoldersStatus,
  ensureRecord,
  initialAuthorizedFoldersState,
  mergeAuthorizedFoldersIntoExternalDirectory,
  normalizeAuthorizedFolderPath,
  readAuthorizedFoldersFromConfig,
  type AuthorizedFoldersState,
} from "./authorized-folders-panel-state";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsNotice,
  SettingsPageSection,
} from "../settings-section";

export type AuthorizedFoldersPanelProps = {
  onmyagentServerClient: OnMyAgentServerClient | null;
  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
  runtimeWorkspaceId: string | null;
  selectedWorkspaceRoot: string;
  activeWorkspaceType: "local" | "remote";
  onConfigUpdated: () => void;
};

type AuthorizedFolderItemProps = {
  folder: string;
  workspaceRootFolder: string;
  authorizedFoldersLoading: boolean;
  authorizedFoldersSaving: boolean;
  canWriteConfig: boolean;
  onRemove: (folder: string) => Promise<void>;
};

function getFolderName(folder: string) {
  // Split on POSIX "/" and Windows "\" separators, then use the last path segment as the folder name.
  return folder.split(/[\/\\]/).filter(Boolean).pop() || folder;
}

function AuthorizedFolderItem(props: AuthorizedFolderItemProps) {
  const isWorkspaceRoot = props.folder === props.workspaceRootFolder;
  const folderName = getFolderName(props.folder);

  return (
    <SettingsBlockRow
      title={
        <span className="inline-flex min-w-0 items-center gap-2">
          <Folder size={16} className="shrink-0 text-dls-secondary" />
          <span className="truncate">{folderName}</span>
          {isWorkspaceRoot ? (
            <StatusBadge tone="neutral" shape="soft" size="tiny">
              {t("context_panel.workspace_root_badge")}
            </StatusBadge>
          ) : null}
        </span>
      }
      description={
        <span className="font-mono text-xs">{props.folder}</span>
      }
      actions={
        !isWorkspaceRoot ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-dls-secondary hover:text-dls-danger"
            onClick={() => void props.onRemove(props.folder)}
            disabled={
              props.authorizedFoldersLoading ||
              props.authorizedFoldersSaving ||
              !props.canWriteConfig
            }
            aria-label={t("context_panel.remove_folder", undefined, {
              name: folderName,
            })}
          >
            <X size={14} />
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={(
                <span
                  className="inline-flex items-center text-dls-secondary"
                  tabIndex={0}
                >
                  <Info className="size-4" />
                </span>
              )}
            />
            <TooltipContent>
              {t("context_panel.always_available")}
            </TooltipContent>
          </Tooltip>
        )
      }
    />
  );
}

export function AuthorizedFoldersPanel(props: AuthorizedFoldersPanelProps) {
  const [folderState, dispatchFolderState] = useReducer(
    authorizedFoldersReducer,
    initialAuthorizedFoldersState,
  );
  const {
    folders: authorizedFolders,
    loading: authorizedFoldersLoading,
    saving: authorizedFoldersSaving,
    status: authorizedFoldersStatus,
    error: authorizedFoldersError,
  } = folderState;
  const setFolderState = <K extends keyof AuthorizedFoldersState>(
    key: K,
    value: SetStateAction<AuthorizedFoldersState[K]>,
  ) => dispatchFolderState({ type: "set", key, value });
  const setAuthorizedFolders = (value: SetStateAction<string[]>) => setFolderState("folders", value);
  const setAuthorizedFoldersSaving = (value: SetStateAction<boolean>) => setFolderState("saving", value);
  const setAuthorizedFoldersStatus = (value: SetStateAction<string | null>) => setFolderState("status", value);
  const setAuthorizedFoldersError = (value: SetStateAction<string | null>) => setFolderState("error", value);

  const onmyagentServerReady = props.onmyagentServerStatus === "connected";
  const onmyagentServerWorkspaceReady = Boolean(props.runtimeWorkspaceId);
  const canReadConfig =
    onmyagentServerReady &&
    onmyagentServerWorkspaceReady &&
    (props.onmyagentServerCapabilities?.config?.read ?? false);
  const canWriteConfig =
    onmyagentServerReady &&
    onmyagentServerWorkspaceReady &&
    (props.onmyagentServerCapabilities?.config?.write ?? false);

  const authorizedFoldersHint = useMemo(() => {
    if (!onmyagentServerReady) return t("context_panel.server_disconnected");
    if (!onmyagentServerWorkspaceReady) return t("context_panel.no_server_workspace");
    if (!canReadConfig) return t("context_panel.config_access_unavailable");
    if (!canWriteConfig) return t("context_panel.config_read_only");
    return null;
  }, [canReadConfig, canWriteConfig, onmyagentServerReady, onmyagentServerWorkspaceReady]);

  // Local (and any non-remote) desktop workspaces can add external folders.
  // Do not treat missing type as remote — that permanently disables the button.
  const isRemoteWorkspace = props.activeWorkspaceType === "remote";
  const canPickAuthorizedFolder =
    isDesktopRuntime() && canWriteConfig && !isRemoteWorkspace;

  const pickDisabledReason = useMemo(() => {
    if (!isDesktopRuntime()) return t("settings.desktop_only_hint");
    if (isRemoteWorkspace) return t("context_panel.remote_workspace_no_folders");
    if (!onmyagentServerReady) return t("context_panel.server_disconnected");
    if (!onmyagentServerWorkspaceReady) return t("context_panel.no_server_workspace");
    if (!canWriteConfig) {
      return (
        authorizedFoldersHint ?? t("context_panel.config_read_only")
      );
    }
    if (authorizedFoldersLoading) return t("context_panel.loading_folders");
    if (authorizedFoldersSaving) return t("context_panel.saving_folders");
    return null;
  }, [
    authorizedFoldersHint,
    authorizedFoldersLoading,
    authorizedFoldersSaving,
    canWriteConfig,
    isRemoteWorkspace,
    onmyagentServerReady,
    onmyagentServerWorkspaceReady,
  ]);

  const workspaceRootFolder = props.selectedWorkspaceRoot.trim();
  const workspaceRootNormalized =
    normalizeAuthorizedFolderPath(workspaceRootFolder);
  const authorizedNormalized = useMemo(
    () =>
      new Set(
        authorizedFolders
          .map((f) => normalizeAuthorizedFolderPath(f))
          .filter(Boolean),
      ),
    [authorizedFolders],
  );
  const visibleAuthorizedFolders = useMemo(() => {
    const root = workspaceRootFolder;
    return root ? [root, ...authorizedFolders] : authorizedFolders;
  }, [authorizedFolders, workspaceRootFolder]);

  useEffect(() => {
    const onmyagentClient = props.onmyagentServerClient;
    const onmyagentWorkspaceId = props.runtimeWorkspaceId;

    if (!onmyagentClient || !onmyagentWorkspaceId || !canReadConfig) {
      dispatchFolderState({ type: "reset" });
      return;
    }

    let cancelled = false;
    dispatchFolderState({ type: "loadStart" });

    void (async () => {
      try {
        const config = await onmyagentClient.getConfig(onmyagentWorkspaceId);
        if (cancelled) return;
        const next = readAuthorizedFoldersFromConfig(ensureRecord(config.opencode));
        dispatchFolderState({
          type: "loadSuccess",
          folders: next.folders,
          status: buildAuthorizedFoldersStatus(Object.keys(next.hiddenEntries).length),
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : safeStringify(error);
        dispatchFolderState({ type: "loadError", message });
      } finally {
        if (!cancelled) dispatchFolderState({ type: "loadDone" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canReadConfig, props.onmyagentServerClient, props.runtimeWorkspaceId]);

  const persistAuthorizedFolders = useCallback(async (nextFolders: string[]) => {
    const onmyagentClient = props.onmyagentServerClient;
    const onmyagentWorkspaceId = props.runtimeWorkspaceId;
    if (!onmyagentClient || !onmyagentWorkspaceId || !canWriteConfig) {
      setAuthorizedFoldersError(t("context_panel.writable_workspace_required"));
      return false;
    }

    setAuthorizedFoldersSaving(true);
    setAuthorizedFoldersError(null);
    setAuthorizedFoldersStatus(t("context_panel.saving_folders"));

    try {
      const currentConfig = await onmyagentClient.getConfig(onmyagentWorkspaceId);
      const currentAuthorizedFolders = readAuthorizedFoldersFromConfig(
        ensureRecord(currentConfig.opencode),
      );
      const nextExternalDirectory = mergeAuthorizedFoldersIntoExternalDirectory(
        nextFolders,
        currentAuthorizedFolders.hiddenEntries,
      );

      await onmyagentClient.patchConfig(onmyagentWorkspaceId, {
        opencode: {
          permission: {
            external_directory: nextExternalDirectory,
          },
        },
      });
      setAuthorizedFolders(nextFolders);
      setAuthorizedFoldersStatus(
        buildAuthorizedFoldersStatus(
          Object.keys(currentAuthorizedFolders.hiddenEntries).length,
          t("context_panel.folders_updated"),
        ),
      );
      props.onConfigUpdated();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : safeStringify(error);
      setAuthorizedFoldersError(message);
      setAuthorizedFoldersStatus(null);
      return false;
    } finally {
      setAuthorizedFoldersSaving(false);
    }
  }, [canWriteConfig, props]);

  const removeAuthorizedFolder = useCallback(async (folder: string) => {
    const nextFolders = authorizedFolders.filter((entry) => entry !== folder);
    await persistAuthorizedFolders(nextFolders);
  }, [authorizedFolders, persistAuthorizedFolders]);

  const pickAuthorizedFolder = useCallback(async () => {
    if (!canPickAuthorizedFolder) return;
    try {
      // multiSelections: user can authorize several folders in one dialog.
      const selection = await pickDirectory({
        title: t("onboarding.authorize_folder"),
        multiple: true,
      });
      const folders: string[] = Array.isArray(selection)
        ? selection
        : typeof selection === "string"
          ? [selection]
          : [];
      if (!folders.length) return;

      const next = [...authorizedFolders];
      let added = 0;
      let skippedRoot = 0;
      let skippedDup = 0;

      for (const folder of folders) {
        const normalized = normalizeAuthorizedFolderPath(folder);
        if (!normalized) continue;
        if (workspaceRootNormalized && normalized === workspaceRootNormalized) {
          skippedRoot += 1;
          continue;
        }
        if (
          authorizedNormalized.has(normalized) ||
          next.some((f) => normalizeAuthorizedFolderPath(f) === normalized)
        ) {
          skippedDup += 1;
          continue;
        }
        next.push(normalized);
        added += 1;
      }

      setAuthorizedFoldersError(null);
      if (added === 0) {
        if (skippedRoot > 0 && skippedDup === 0) {
          setAuthorizedFoldersStatus(t("context_panel.workspace_root_available"));
        } else if (skippedDup > 0) {
          setAuthorizedFoldersStatus(t("context_panel.folder_already_authorized"));
        }
        return;
      }
      await persistAuthorizedFolders(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : safeStringify(error);
      setAuthorizedFoldersError(message);
    }
  }, [
    authorizedFolders,
    authorizedNormalized,
    canPickAuthorizedFolder,
    persistAuthorizedFolders,
    workspaceRootNormalized,
  ]);

  return (
    <SettingsPageSection
      title={t("context_panel.authorized_folders")}
      description={t("context_panel.authorized_folders_desc")}
      actions={
        <Tooltip>
          <TooltipTrigger
            render={(
              <span className="inline-flex">
                <Button
                  onClick={() => void pickAuthorizedFolder()}
                  disabled={
                    authorizedFoldersLoading ||
                    authorizedFoldersSaving ||
                    !canPickAuthorizedFolder
                  }
                >
                  <Plus className="size-4" />
                  {t("context_panel.add_folder_button")}
                </Button>
              </span>
            )}
          />
          {pickDisabledReason ? (
            <TooltipContent>{pickDisabledReason}</TooltipContent>
          ) : (
            <TooltipContent>
              {t("context_panel.add_folder_hint")}
            </TooltipContent>
          )}
        </Tooltip>
      }
    >
      {!canReadConfig ? (
        <SettingsNotice>
          {authorizedFoldersHint ??
            t("context_panel.authorized_folders_no_access")}
        </SettingsNotice>
      ) : (
        <>
          {visibleAuthorizedFolders.length > 0 ? (
            <SettingsBlock>
              {visibleAuthorizedFolders.map((folder) => (
                <AuthorizedFolderItem
                  key={folder}
                  folder={folder}
                  workspaceRootFolder={workspaceRootFolder}
                  authorizedFoldersLoading={authorizedFoldersLoading}
                  authorizedFoldersSaving={authorizedFoldersSaving}
                  canWriteConfig={canWriteConfig}
                  onRemove={removeAuthorizedFolder}
                />
              ))}
            </SettingsBlock>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia>
                  <Folder className="text-dls-secondary" />
                </EmptyMedia>
                <EmptyTitle>
                  {t("context_panel.no_external_folders")}
                </EmptyTitle>
                <EmptyDescription>
                  {t("context_panel.add_folder_hint")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  onClick={() => void pickAuthorizedFolder()}
                  disabled={
                    authorizedFoldersLoading ||
                    authorizedFoldersSaving ||
                    !canPickAuthorizedFolder
                  }
                >
                  <Plus className="size-4" />
                  {t("context_panel.add_folder_button")}
                </Button>
              </EmptyContent>
            </Empty>
          )}

          {authorizedFoldersStatus ? (
            <SettingsNotice>{authorizedFoldersStatus}</SettingsNotice>
          ) : null}
          {authorizedFoldersError ? (
            <SettingsNotice tone="error">
              {authorizedFoldersError}
            </SettingsNotice>
          ) : null}
        </>
      )}
    </SettingsPageSection>
  );
}
