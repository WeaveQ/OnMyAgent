/** @jsxImportSource react */
/**
 * Workspace / palette / model-picker modals for the session route.
 * Keeps session-route-render focused on data orchestration + SessionPage.
 */
import type { Dispatch, SetStateAction } from "react";

import { pickDirectory } from "../../../app/lib/desktop";
import { unwrap } from "../../../app/lib/opencode";
import type { Client, ModelOption, ModelRef, WorkspacePreset } from "../../../app/types";
import { t } from "../../../i18n";
import { ModelPickerModal, type OpenTarget } from "../../domains/session";
import {
  CreateRemoteWorkspaceModal,
  CreateWorkspaceModal,
  RenameWorkspaceModal,
} from "../../domains/workspace";
import type { useRemoteWorkspaceConnectionEditor } from "../../domains/workspace";
import type { LocalPreferences } from "../../kernel/local-provider";
import { CommandPalette } from "../command-palette";
import type { SessionOption } from "../command-palette";
import type { RouteWorkspace } from "./model";
import { updateDefaultModelPrefs } from "./composer";

type RemoteWorkspaceConnectionEditor = ReturnType<
  typeof useRemoteWorkspaceConnectionEditor<RouteWorkspace>
>;

export type SessionRouteModalsProps = {
  createWorkspaceOpen: boolean;
  setCreateWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceError: Dispatch<SetStateAction<string | null>>;
  handleCreateWorkspace: (
    preset: WorkspacePreset,
    folder: string | null,
  ) => Promise<void> | void;
  handleCreateRemoteWorkspace: (input: {
    onmyagentHostUrl?: string | null;
    onmyagentToken?: string | null;
    directory?: string | null;
    displayName?: string | null;
  }) => Promise<boolean> | boolean;
  createWorkspaceBusy: boolean;
  createWorkspaceError: string | null;
  createWorkspaceRemoteBusy: boolean;
  createWorkspaceRemoteError: string | null;
  remoteWorkspaceConnectionEditor: RemoteWorkspaceConnectionEditor;
  renameWorkspaceId: string | null;
  renameWorkspaceTitle: string;
  renameWorkspaceBusy: boolean;
  setRenameWorkspaceId: Dispatch<SetStateAction<string | null>>;
  setRenameWorkspaceTitle: Dispatch<SetStateAction<string>>;
  handleSaveRenameWorkspace: () => Promise<void> | void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  selectedWorkspaceId: string;
  handleCreateTaskInWorkspace: (workspaceId: string) => Promise<void> | void;
  navigateToWorkspaceSession: (
    workspaceId: string,
    sessionId?: string | null,
    options?: { replace?: boolean },
  ) => void;
  handleOpenSettings: (route?: string) => void;
  paletteAccessibleTargets: OpenTarget[];
  paletteSessionOptions: SessionOption[];
  modelPickerOpen: boolean;
  setModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  allowedModelOptions: ModelOption[];
  modelPickerQuery: string;
  setModelPickerQuery: Dispatch<SetStateAction<string>>;
  defaultModel: LocalPreferences["defaultModel"];
  setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void;
  disabledProviderIds: string[];
  setDisabledProviderIds: Dispatch<SetStateAction<string[]>>;
  setRecentProviderIds: Dispatch<SetStateAction<Set<string>>>;
  opencodeClient: Client | null;
};

export function SessionRouteModals(props: SessionRouteModalsProps) {
  const {
    createWorkspaceOpen,
    setCreateWorkspaceOpen,
    setCreateWorkspaceError,
    handleCreateWorkspace,
    handleCreateRemoteWorkspace,
    createWorkspaceBusy,
    createWorkspaceError,
    createWorkspaceRemoteBusy,
    createWorkspaceRemoteError,
    remoteWorkspaceConnectionEditor,
    renameWorkspaceId,
    renameWorkspaceTitle,
    renameWorkspaceBusy,
    setRenameWorkspaceId,
    setRenameWorkspaceTitle,
    handleSaveRenameWorkspace,
    commandPaletteOpen,
    setCommandPaletteOpen,
    selectedWorkspaceId,
    handleCreateTaskInWorkspace,
    navigateToWorkspaceSession,
    handleOpenSettings,
    paletteAccessibleTargets,
    paletteSessionOptions,
    modelPickerOpen,
    setModelPickerOpen,
    allowedModelOptions,
    modelPickerQuery,
    setModelPickerQuery,
    defaultModel,
    setPrefs,
    disabledProviderIds,
    setDisabledProviderIds,
    setRecentProviderIds,
    opencodeClient,
  } = props;

  return (
    <>
      <CreateWorkspaceModal
        open={createWorkspaceOpen}
        onClose={() => {
          setCreateWorkspaceOpen(false);
          setCreateWorkspaceError(null);
        }}
        onConfirm={handleCreateWorkspace}
        onConfirmRemote={handleCreateRemoteWorkspace}
        onPickFolder={() =>
          pickDirectory({
            title: t("onboarding.authorize_folder"),
          }) as Promise<string | null>
        }
        submitting={createWorkspaceBusy}
        localError={createWorkspaceError}
        remoteSubmitting={createWorkspaceRemoteBusy}
        remoteError={createWorkspaceRemoteError}
      />
      <CreateRemoteWorkspaceModal
        open={remoteWorkspaceConnectionEditor.workspace !== null}
        onClose={remoteWorkspaceConnectionEditor.close}
        onConfirm={(input) => void remoteWorkspaceConnectionEditor.save(input)}
        initialValues={remoteWorkspaceConnectionEditor.initialValues}
        submitting={remoteWorkspaceConnectionEditor.busy}
        error={remoteWorkspaceConnectionEditor.error}
        title={t("dashboard.edit_remote_workspace_title")}
        subtitle={t("dashboard.edit_remote_workspace_subtitle")}
        confirmLabel={t("dashboard.edit_remote_workspace_confirm")}
      />
      <RenameWorkspaceModal
        open={renameWorkspaceId !== null}
        title={renameWorkspaceTitle}
        busy={renameWorkspaceBusy}
        canSave={
          !renameWorkspaceBusy && renameWorkspaceTitle.trim().length > 0
        }
        onClose={() => {
          if (renameWorkspaceBusy) return;
          setRenameWorkspaceId(null);
          setRenameWorkspaceTitle("");
        }}
        onSave={() => void handleSaveRenameWorkspace()}
        onTitleChange={setRenameWorkspaceTitle}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onCreateNewSession={() => {
          if (selectedWorkspaceId) {
            void handleCreateTaskInWorkspace(selectedWorkspaceId);
          }
        }}
        onOpenSession={(workspaceId, sessionId) =>
          navigateToWorkspaceSession(workspaceId, sessionId)
        }
        onOpenSettings={(route) =>
          handleOpenSettings(route ?? "/settings/general")
        }
        accessibleTargets={paletteAccessibleTargets}
        onOpenAccessibleTarget={(target) => {
          try {
            window.dispatchEvent(
              new CustomEvent("onmyagent-open-accessible-target", {
                detail: target,
              }),
            );
          } catch {
            // ignore event dispatch failures
          }
        }}
        onHideAccessibleTarget={(target) => {
          try {
            window.dispatchEvent(
              new CustomEvent("onmyagent-hide-accessible-target", {
                detail: target,
              }),
            );
          } catch {
            // ignore event dispatch failures
          }
        }}
        sessions={paletteSessionOptions}
      />
      <ModelPickerModal
        open={modelPickerOpen}
        options={allowedModelOptions}
        query={modelPickerQuery}
        setQuery={setModelPickerQuery}
        target="default"
        current={
          defaultModel ??
          ({ providerID: "", modelID: "" } satisfies ModelRef)
        }
        onSelect={(next: ModelRef) => {
          setPrefs((previous) => updateDefaultModelPrefs(previous, next));
          setModelPickerOpen(false);
        }}
        disabledProviders={disabledProviderIds}
        onBehaviorChange={() => {}}
        onToggleProvider={async (providerId, enable) => {
          if (!opencodeClient) return;
          try {
            const config = unwrap(await opencodeClient.config.get()) as {
              disabled_providers?: string[];
            };
            const current = Array.isArray(config.disabled_providers)
              ? config.disabled_providers
              : [];
            const next = enable
              ? current.filter((id: string) => id !== providerId)
              : [...current, providerId];
            await opencodeClient.config.update({
              config: { ...config, disabled_providers: next },
            });
            setDisabledProviderIds(next);
          } catch {
            // ignore toggle failures
          }
        }}
        onOpenSettings={() => {
          setModelPickerOpen(false);
          handleOpenSettings("/settings/general");
        }}
        onClose={() => {
          setModelPickerOpen(false);
          setRecentProviderIds(new Set());
        }}
      />
    </>
  );
}
