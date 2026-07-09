/** @jsxImportSource react */
/**
 * Workspace / palette / model-picker modals for the session route.
 * Keeps session-route-render focused on data orchestration + SessionPage.
 */
import type { Dispatch, SetStateAction } from "react";

import { pickDirectory } from "../../app/lib/desktop";
import { unwrap } from "../../app/lib/opencode";
import type { ModelOption, ModelRef } from "../../app/types";
import { t } from "../../i18n";
import { ModelPickerModal } from "../domains/session";
import type { OpenTarget } from "../domains/session";
import { CreateRemoteWorkspaceModal } from "../domains/workspace/create-remote-workspace-modal";
import { CreateWorkspaceModal } from "../domains/workspace/create-workspace-modal";
import { RenameWorkspaceModal } from "../domains/workspace/rename-workspace-modal";
import { CommandPalette } from "./command-palette";

export type SessionRouteModalsProps = {
  createWorkspaceOpen: boolean;
  setCreateWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceError: Dispatch<SetStateAction<string | null>>;
  handleCreateWorkspace: (...args: any[]) => any;
  handleCreateRemoteWorkspace: (...args: any[]) => any;
  createWorkspaceBusy: boolean;
  createWorkspaceError: string | null;
  createWorkspaceRemoteBusy: boolean;
  createWorkspaceRemoteError: string | null;
  remoteWorkspaceConnectionEditor: {
    workspace: unknown;
    close: () => void;
    save: (input: any) => any;
    initialValues: any;
    busy: boolean;
    error: string | null;
  };
  renameWorkspaceId: string | null;
  renameWorkspaceTitle: string;
  renameWorkspaceBusy: boolean;
  setRenameWorkspaceId: Dispatch<SetStateAction<string | null>>;
  setRenameWorkspaceTitle: Dispatch<SetStateAction<string>>;
  handleSaveRenameWorkspace: () => any;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  selectedWorkspaceId: string;
  handleCreateTaskInWorkspace: (workspaceId: string) => any;
  navigateToWorkspaceSession: (
    workspaceId: string,
    sessionId?: string | null,
    options?: { replace?: boolean },
  ) => void;
  handleOpenSettings: (route?: string) => void;
  paletteAccessibleTargets: OpenTarget[];
  paletteSessionOptions: any[];
  modelPickerOpen: boolean;
  setModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  allowedModelOptions: ModelOption[];
  modelPickerQuery: string;
  setModelPickerQuery: Dispatch<SetStateAction<string>>;
  defaultModel: ModelRef | null | undefined;
  setPrefs: (updater: (previous: any) => any) => void;
  updateDefaultModelPrefs: (previous: any, next: ModelRef) => any;
  disabledProviderIds: string[];
  setDisabledProviderIds: Dispatch<SetStateAction<string[]>>;
  setRecentProviderIds: Dispatch<SetStateAction<Set<string>>>;
  opencodeClient: any;
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
    updateDefaultModelPrefs,
    disabledProviderIds,
    setDisabledProviderIds,
    setRecentProviderIds,
    opencodeClient,
  } = props;

  const local = {
    prefs: { defaultModel },
    setPrefs,
  };

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
          onConfirm={(input) =>
            void remoteWorkspaceConnectionEditor.save(input)
          }
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
            local.prefs.defaultModel ??
            ({ providerID: "", modelID: "" } satisfies ModelRef)
          }
          onSelect={(next: ModelRef) => {
            local.setPrefs((previous) => updateDefaultModelPrefs(previous, next));
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
            } catch {}
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
