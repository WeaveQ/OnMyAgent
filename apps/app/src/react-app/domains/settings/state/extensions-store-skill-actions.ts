/**
 * Local skill install / import / reveal / uninstall / read / save actions
 * extracted from createExtensionsStore for file-size hygiene.
 */
import type { Client, ReloadReason, ReloadTrigger, SkillCard } from "../../../../app/types";
import skillCreatorTemplate from "../../../../../../desktop/resources/bundled-skills/skill-creator/SKILL.md?raw";
import {
  importSkill,
  installSkillTemplate,
  joinDesktopPath,
  listLocalSkills,
  openDesktopPath,
  pickDirectory,
  readLocalSkill,
  revealDesktopItemInDir,
  onmyagentSkillsRoot,
  writeLocalSkill,
} from "../../../../app/lib/desktop";
import type {
  OnMyAgentServerCapabilities,
  OnMyAgentServerClient,
  OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";
import type { OnMyAgentServerStore, OnMyAgentServerStoreSnapshot } from "../../shared";
import { t } from "../../../../i18n";
import {
  addOpencodeCacheHint,
  isDesktopRuntime,
  normalizeDirectoryPath,
} from "../../../../app/utils";
import {
  canUseOnMyAgentCapability,
  formatSkillPath,
  mapSkillCard,
  resolveOnMyAgentGateway,
} from "./extensions-store-model";
import type { ExtensionsStoreMutableState } from "./extensions-store-snapshot";

type MutableState = ExtensionsStoreMutableState;

type OnMyAgentGatewaySnapshot = OnMyAgentServerStoreSnapshot & {
  onmyagentServerClient: OnMyAgentServerClient | null;
  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
};

export type ExtensionsSkillActionsContext = {
  options: {
    selectedWorkspaceRoot: () => string;
    workspaceType: () => "local" | "remote";
    runtimeWorkspaceId: () => string | null;
    setBusy: (value: boolean) => void;
    setBusyLabel: (value: string | null) => void;
    setBusyStartedAt: (value: number | null) => void;
    setError: (value: string | null) => void;
    onmyagentServer: OnMyAgentServerStore;
    onmyagentServerConnection?: () => {
      onmyagentServerClient: OnMyAgentServerClient | null;
      onmyagentServerStatus: OnMyAgentServerStatus;
      onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
    };
    projectDir: () => string;
    client: () => Client | null;
    markReloadRequired?: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
  };
  /** Full store snapshot — skill actions only read skills/status fields. */
  get snapshot():
    | ExtensionsStoreMutableState
    | { skills: SkillCard[]; skillsStatus: string | null };
  mutateState: (updater: (current: MutableState) => MutableState) => void;
  setStateField: <K extends keyof MutableState>(key: K, value: MutableState[K]) => void;
  getOnMyAgentServerSnapshot: () => OnMyAgentGatewaySnapshot;
  findLoadedSkill: (name: string) => SkillCard | undefined;
  workspaceWriter: {
    upsertSkill: (
      name: string,
      content: string,
      description: string,
      optionsOverride?: { overwrite?: boolean },
    ) => Promise<void>;
    deleteSkill: (name: string) => Promise<void>;
  };
  get skillsRoot(): string;
  set skillsRoot(value: string);
  get skillsLoaded(): boolean;
  set skillsLoaded(value: boolean);
  refreshSkills: (optionsOverride?: { force?: boolean }) => Promise<void>;
  touch: () => void;
};

export function createExtensionsSkillActions(ctx: ExtensionsSkillActionsContext) {
  const options = ctx.options;
  const mutateState = ctx.mutateState;
  const setStateField = ctx.setStateField;
  const getOnMyAgentServerSnapshot = ctx.getOnMyAgentServerSnapshot;
  const findLoadedSkill = ctx.findLoadedSkill;
  const workspaceWriter = ctx.workspaceWriter;
  const refreshSkills = ctx.refreshSkills;
  const touch = ctx.touch;

  async function importLocalSkill() {
    const isLocalWorkspace = options.workspaceType() === "local";
    if (!isDesktopRuntime()) {
      options.setError(t("skills.desktop_required"));
      return;
    }
    if (!isLocalWorkspace) {
      options.setError("Local workers are required to import skills.");
      return;
    }
    const targetDir = options.projectDir().trim();
    if (!targetDir) {
      options.setError(t("skills.pick_project_first"));
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const selection = await pickDirectory({ title: t("skills.select_skill_folder") });
      const sourceDir =
        typeof selection === "string" ? selection : Array.isArray(selection) ? selection[0] : null;
      if (!sourceDir) return;
      const inferredName = sourceDir.split(/[\\/]/).filter(Boolean).pop();
      const result = (await importSkill(targetDir, sourceDir, { overwrite: false })) as {
        ok: boolean;
        stderr?: string;
        stdout?: string;
        status?: number;
      };
      if (!result.ok) {
        setStateField(
          "skillsStatus",
          result.stderr ||
            result.stdout ||
            t("skills.import_failed").replace("{status}", String(result.status)),
        );
      } else {
        setStateField("skillsStatus", result.stdout || t("skills.imported"));
        options.markReloadRequired?.("skills", {
          type: "skill",
          name: inferredName,
          action: "added",
        });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function installSkillCreator(): Promise<{ ok: boolean; message: string }> {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: onmyagentWorkspaceId,
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.skills?.write,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

    if (canUseOnMyAgentServer && onmyagentClient && onmyagentWorkspaceId) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", t("skills.installing_skill_creator"));
      try {
        await onmyagentGateway.client.upsertSkill(onmyagentWorkspaceId, {
          name: "skill-creator",
          content: skillCreatorTemplate,
        });
        const message = t("skills.skill_creator_installed");
        setStateField("skillsStatus", message);
        options.markReloadRequired?.("skills", {
          type: "skill",
          name: "skill-creator",
          action: "added",
        });
        await refreshSkills({ force: true });
        return { ok: true, message };
      } catch (error) {
        const raw = error instanceof Error ? error.message : t("skills.unknown_error");
        const message = addOpencodeCacheHint(raw);
        setStateField("skillsStatus", message);
        options.setError(message);
        return { ok: false, message };
      } finally {
        options.setBusy(false);
      }
    }

    if (isRemoteWorkspace) {
      const message = "OnMyAgent server unavailable. Connect to install skills.";
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }
    if (!isDesktopRuntime()) {
      const message = t("skills.desktop_required");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }
    if (!isLocalWorkspace) {
      const message = "Local workers are required to install skills.";
      options.setError(message);
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    const targetDir = options.selectedWorkspaceRoot().trim();
    if (!targetDir) {
      const message = t("skills.pick_workspace_first");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", t("skills.installing_skill_creator"));
    try {
      const result = (await installSkillTemplate(targetDir, "skill-creator", skillCreatorTemplate, {
        overwrite: false,
      })) as { ok: boolean; stderr: string; stdout: string };
      if (!result.ok && /already exists/i.test(result.stderr)) {
        const message = t("skills.skill_creator_already_installed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: true, message };
      }
      if (!result.ok) {
        const message = result.stderr || result.stdout || t("skills.install_failed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: false, message };
      }
      const message = result.stdout || t("skills.skill_creator_installed");
      setStateField("skillsStatus", message);
      options.markReloadRequired?.("skills", {
        type: "skill",
        name: "skill-creator",
        action: "added",
      });
      await refreshSkills({ force: true });
      return { ok: true, message };
    } catch (error) {
      const raw = error instanceof Error ? error.message : t("skills.unknown_error");
      const message = addOpencodeCacheHint(raw);
      setStateField("skillsStatus", message);
      options.setError(message);
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function revealSkillsFolder() {
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return;
    }
    try {
      const skillsDir = (await onmyagentSkillsRoot()) as string;
      const tryOpen = async (target: string) => {
        try {
          await openDesktopPath(target);
          return true;
        } catch {
          return false;
        }
      };
      if (await tryOpen(skillsDir)) return;
      await revealDesktopItemInDir(skillsDir);
    } catch (error) {
      setStateField(
        "skillsStatus",
        error instanceof Error ? error.message : t("skills.reveal_failed"),
      );
    }
  }

  async function uninstallSkill(name: string) {
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;
    if (findLoadedSkill(trimmed)?.readonly) {
      setStateField("skillsStatus", t("skills.builtin_readonly_uninstall"));
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      await workspaceWriter.deleteSkill(trimmed);
      setStateField("skillsStatus", t("skills.uninstalled"));
      options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "removed" });
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      setStateField("skillsStatus", message);
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function readSkill(
    name: string,
  ): Promise<{ name: string; path: string; content: string } | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return null;
    }

    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: onmyagentWorkspaceId,
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.skills?.read,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

    if (canUseOnMyAgentServer && onmyagentClient && onmyagentWorkspaceId) {
      try {
        setStateField("skillsStatus", null);
        const result = await onmyagentGateway.client.getSkill(onmyagentWorkspaceId, trimmed, {
          includeGlobal: isLocalWorkspace,
        });
        return { name: result.item.name, path: result.item.path, content: result.content };
      } catch (error) {
        setStateField(
          "skillsStatus",
          error instanceof Error ? error.message : t("skills.failed_to_load"),
        );
        return null;
      }
    }

    if (isRemoteWorkspace) {
      setStateField("skillsStatus", "OnMyAgent server unavailable. Connect to view skills.");
      return null;
    }
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return null;
    }
    if (!isLocalWorkspace) {
      setStateField("skillsStatus", "Local workers are required to view skills.");
      return null;
    }

    try {
      setStateField("skillsStatus", null);
      const result = (await readLocalSkill(root, trimmed)) as { path: string; content: string };
      return { name: trimmed, path: result.path, content: result.content };
    } catch (error) {
      setStateField(
        "skillsStatus",
        error instanceof Error ? error.message : t("skills.failed_to_load"),
      );
      return null;
    }
  }

  async function saveSkill(input: { name: string; content: string; description?: string }) {
    const trimmed = input.name.trim();
    if (!trimmed) return;
    if (findLoadedSkill(trimmed)?.readonly) {
      setStateField("skillsStatus", t("skills.builtin_readonly_edit"));
      return;
    }
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }

    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: onmyagentWorkspaceId,
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.skills?.write,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

    if (canUseOnMyAgentServer && onmyagentClient && onmyagentWorkspaceId) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", null);
      try {
        await onmyagentGateway.client.upsertSkill(onmyagentWorkspaceId, {
          name: trimmed,
          content: input.content,
          description: input.description,
        });
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
        await refreshSkills({ force: true });
        setStateField("skillsStatus", "Saved.");
      } catch (error) {
        const message = error instanceof Error ? error.message : t("skills.unknown_error");
        options.setError(addOpencodeCacheHint(message));
      } finally {
        options.setBusy(false);
      }
      return;
    }

    if (isRemoteWorkspace) {
      setStateField("skillsStatus", "OnMyAgent server unavailable. Connect to edit skills.");
      return;
    }
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return;
    }
    if (!isLocalWorkspace) {
      setStateField("skillsStatus", "Local workers are required to edit skills.");
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const result = (await writeLocalSkill(root, trimmed, input.content)) as {
        ok: boolean;
        stderr?: string;
        stdout?: string;
      };
      if (!result.ok) {
        setStateField("skillsStatus", result.stderr || result.stdout || t("skills.unknown_error"));
      } else {
        setStateField("skillsStatus", result.stdout || "Saved.");
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  return {
    importLocalSkill,
    installSkillCreator,
    revealSkillsFolder,
    uninstallSkill,
    readSkill,
    saveSkill,
  };
}
