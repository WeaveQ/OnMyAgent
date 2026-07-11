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
  SettingsActionRow,
  SettingsNotice,
} from "../settings-section";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
} from "../settings-layout";

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
    <SettingsActionRow as="li">
      <div className="flex min-w-0 gap-3">
        <div className="min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Folder size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-dls-text">{folderName}</span>
            {isWorkspaceRoot ? (
              <StatusBadge tone="neutral">
                {t("context_panel.workspace_root_badge")}
              </StatusBadge>
            ) : null}
          </div>
          <span className="truncate font-mono text-xs text-muted-foreground ps-6">{props.folder}</span>
        </div>
      </div>
      {!isWorkspaceRoot ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => void props.onRemove(props.folder)}
          disabled={props.authorizedFoldersLoading || props.authorizedFoldersSaving || !props.canWriteConfig}
          aria-label={t("context_panel.remove_folder", undefined, { name: folderName })}
        >
          <X size={14} />
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={(
              <span
                className="inline-flex shrink-0 items-center text-muted-foreground mr-2"
                tabIndex={0}
              >
                <Info className="size-4" />
              </span>
            )}
          />
          <TooltipContent>{t("context_panel.always_available")}</TooltipContent>
        </Tooltip>
      )}
    </SettingsActionRow>
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

  const canPickAuthorizedFolder =
    isDesktopRuntime() && canWriteConfig && props.activeWorkspaceType === "local";
  const workspaceRootFolder = props.selectedWorkspaceRoot.trim();
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
    if (!isDesktopRuntime()) return;
    try {
      const selection = await pickDirectory({
        title: t("onboarding.authorize_folder"),
      });
      const folder =
        typeof selection === "string"
          ? selection
          : Array.isArray(selection)
            ? selection[0]
            : null;
      const normalized = normalizeAuthorizedFolderPath(folder);
      const workspaceRoot = normalizeAuthorizedFolderPath(workspaceRootFolder);
      if (!normalized) return;
      if (workspaceRoot && normalized === workspaceRoot) {
        setAuthorizedFoldersStatus(t("context_panel.workspace_root_available"));
        setAuthorizedFoldersError(null);
        return;
      }
      if (authorizedFolders.includes(normalized)) {
        setAuthorizedFoldersStatus(t("context_panel.folder_already_authorized"));
        setAuthorizedFoldersError(null);
        return;
      }
      await persistAuthorizedFolders([...authorizedFolders, normalized]);
    } catch (error) {
      const message = error instanceof Error ? error.message : safeStringify(error);
      setAuthorizedFoldersError(message);
    }
  }, [authorizedFolders, persistAuthorizedFolders, workspaceRootFolder]);

  return (
    <LayoutSectionItem className="gap-4">
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>
          {t("context_panel.authorized_folders")}
        </LayoutSectionItemTitle>
        <LayoutSectionItemDescription>
          {t("context_panel.authorized_folders_desc")}
        </LayoutSectionItemDescription>
        <LayoutSectionItemHeaderActions>
          <Button
            onClick={() => void pickAuthorizedFolder()}
            disabled={authorizedFoldersLoading || authorizedFoldersSaving || !canPickAuthorizedFolder}
          >
            <Plus className="size-4" />
            {t("context_panel.add_folder_button")}
          </Button>
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>

      {!canReadConfig ? (
        <SettingsNotice>
          {authorizedFoldersHint ?? t("context_panel.authorized_folders_no_access")}
        </SettingsNotice>
      ) : (
        <>
          {/* Folder list */}
          {visibleAuthorizedFolders.length > 0 ? (
            <ul className="flex flex-col gap-2">
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
            </ul>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia>
                  <Folder className="text-muted-foreground" />
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
                disabled={authorizedFoldersLoading || authorizedFoldersSaving || !canPickAuthorizedFolder}
              >
                <Plus className="size-4" />
                {t("context_panel.add_folder_button")}
              </Button>
            </EmptyContent>
            </Empty>
          )}

          {/* Status / error */}
          {authorizedFoldersStatus ? (
            <SettingsNotice>{authorizedFoldersStatus}</SettingsNotice>
          ) : null}
          {authorizedFoldersError ? (
            <SettingsNotice tone="error">{authorizedFoldersError}</SettingsNotice>
          ) : null}
        </>
      )}
    </LayoutSectionItem>
  );
}
