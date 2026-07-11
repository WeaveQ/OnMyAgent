import { t } from "../../../../i18n";
import { isDesktopRuntime } from "../../../../app/utils";
import {
  installSkillTemplate,
  uninstallSkill as uninstallSkillCommand,
} from "../../../../app/lib/desktop";
import type {
  OnMyAgentServerCapabilities,
  OnMyAgentServerClient,
  OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";

export type ExtensionsWorkspaceWriterOptions = {
  onmyagentServerConnection: () => {
    onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
    onmyagentServerClient: OnMyAgentServerClient | null;
    onmyagentServerStatus: OnMyAgentServerStatus;
  };
  runtimeWorkspaceId: () => string | null;
  selectedWorkspaceRoot: () => string;
  workspaceType: () => "local" | "remote";
};

function getServerWorkspaceWriteContext(options: ExtensionsWorkspaceWriterOptions) {
  const snapshot = options.onmyagentServerConnection();
  const client = snapshot.onmyagentServerClient;
  const workspaceId = options.runtimeWorkspaceId();
  return { snapshot, client, workspaceId };
}

function canWriteWorkspaceSkills(context: ReturnType<typeof getServerWorkspaceWriteContext>) {
  return Boolean(
    context.snapshot.onmyagentServerStatus === "connected" &&
    context.client &&
    context.workspaceId &&
    context.snapshot.onmyagentServerCapabilities?.skills?.write,
  );
}

function assertLocalSkillWorkspace(options: ExtensionsWorkspaceWriterOptions, unavailableMessage: string) {
  const isRemoteWorkspace = options.workspaceType() === "remote";
  const isLocalWorkspace = options.workspaceType() === "local";
  const root = options.selectedWorkspaceRoot().trim();

  if (isRemoteWorkspace) {
    throw new Error(unavailableMessage);
  }

  if (!isDesktopRuntime()) {
    throw new Error(t("skills.desktop_required"));
  }

  if (!isLocalWorkspace || !root) {
    throw new Error(t("skills.pick_workspace_first"));
  }

  return root;
}

export function createExtensionsWorkspaceWriter(options: ExtensionsWorkspaceWriterOptions) {
  const upsertSkill = async (
    name: string,
    content: string,
    description: string,
    optionsOverride?: { overwrite?: boolean },
  ) => {
    const serverContext = getServerWorkspaceWriteContext(options);

    if (canWriteWorkspaceSkills(serverContext)) {
      await serverContext.client?.upsertSkill(serverContext.workspaceId ?? "", {
        name,
        content,
        description,
      });
      return;
    }

    const root = assertLocalSkillWorkspace(options, "OnMyAgent server unavailable. Connect to import skills.");

    const result = (await installSkillTemplate(root, name, content, {
      overwrite: optionsOverride?.overwrite ?? false,
    })) as { ok: boolean; stderr?: string; stdout?: string };
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || t("skills.install_failed"));
    }
  };

  const deleteSkill = async (name: string) => {
    const serverContext = getServerWorkspaceWriteContext(options);

    if (canWriteWorkspaceSkills(serverContext)) {
      await serverContext.client?.deleteSkill(serverContext.workspaceId ?? "", name);
      return;
    }

    const root = assertLocalSkillWorkspace(options, "OnMyAgent server unavailable. Connect to remove skills.");

    const result = (await uninstallSkillCommand(root, name)) as { ok: boolean; stderr?: string; stdout?: string };
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || t("skills.uninstall_failed"));
    }
  };

  const upsertMcpConfig = async (name: string, config: Record<string, unknown>) => {
    const onmyagentSnapshot = options.onmyagentServerConnection();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    if (
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.mcp?.write
    ) {
      await onmyagentClient.addMcp(onmyagentWorkspaceId, { name, config });
      return;
    }
    throw new Error("OnMyAgent server unavailable. Connect to import MCP servers into this workspace.");
  };

  const deleteMcpConfig = async (name: string) => {
    const onmyagentSnapshot = options.onmyagentServerConnection();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    if (
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.mcp?.write
    ) {
      await onmyagentClient.removeMcp(onmyagentWorkspaceId, name);
      return;
    }
    throw new Error("OnMyAgent server unavailable. Connect to remove imported MCP servers from this workspace.");
  };

  const writeWorkspaceFile = async (path: string, content: string) => {
    const onmyagentSnapshot = options.onmyagentServerConnection();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    if (
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      typeof onmyagentClient.writeWorkspaceFile === "function"
    ) {
      await onmyagentClient.writeWorkspaceFile(onmyagentWorkspaceId, { path, content, force: true });
      return;
    }
    throw new Error("OnMyAgent server unavailable. Connect to import plugin files into this workspace.");
  };

  return {
    deleteMcpConfig,
    deleteSkill,
    upsertMcpConfig,
    upsertSkill,
    writeWorkspaceFile,
  };
}
