import { isDesktopRuntime } from "../../../../app/utils";
import {
  workspaceOnMyAgentRead,
  workspaceOnMyAgentWrite,
} from "../../../../app/lib/desktop";
import type { WorkspaceCloudImports } from "../../../../app/cloud/import-state";
import {
  readWorkspaceCloudImports,
  withWorkspaceCloudImports,
} from "../../../../app/cloud/import-state";
import type {
  OnMyAgentServerCapabilities,
  OnMyAgentServerClient,
  OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";

type CloudImportKey = "plugins" | "skillHubs" | "skills";

type CloudImportValue<K extends CloudImportKey> = WorkspaceCloudImports[K];

const cloudImportUnavailableMessage = {
  plugins: "OnMyAgent server unavailable. Connect to manage imported cloud plugins.",
  skillHubs: "OnMyAgent server unavailable. Connect to manage imported cloud skill hubs.",
  skills: "OnMyAgent server unavailable. Connect to manage imported cloud skills.",
} satisfies Record<CloudImportKey, string>;

export type ExtensionsWorkspaceConfigGatewayOptions = {
  onmyagentServerConnection: () => {
    onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
    onmyagentServerClient: OnMyAgentServerClient | null;
    onmyagentServerStatus: OnMyAgentServerStatus;
  };
  runtimeWorkspaceId: () => string | null;
  selectedWorkspaceRoot: () => string;
  workspaceType: () => "local" | "remote";
};

export function createExtensionsWorkspaceConfigGateway(options: ExtensionsWorkspaceConfigGatewayOptions) {
  const readRecord = async (): Promise<Record<string, unknown>> => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = options.onmyagentServerConnection();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOnMyAgentServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.config?.read;

    if (canUseOnMyAgentServer) {
      const config = await onmyagentClient.getConfig(onmyagentWorkspaceId);
      return config.onmyagent ?? {};
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      return await workspaceOnMyAgentRead({ workspacePath: root }) as unknown as Record<string, unknown>;
    }

    return {};
  };

  const writeRecord = async (config: Record<string, unknown>) => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = options.onmyagentServerConnection();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOnMyAgentServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.config?.write;

    if (canUseOnMyAgentServer) {
      await onmyagentClient.patchConfig(onmyagentWorkspaceId, { onmyagent: config });
      return true;
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      const result = (await workspaceOnMyAgentWrite({
        workspacePath: root,
        config: config as never,
      })) as { ok: boolean; stderr?: string; stdout?: string };
      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "Failed to write .opencode/onmyagent.json");
      }
      return true;
    }

    return false;
  };

  const readCloudImports = async <K extends CloudImportKey>(key: K): Promise<CloudImportValue<K>> => {
    const config = await readRecord();
    const cloudImports = readWorkspaceCloudImports(config);
    return cloudImports[key];
  };

  const writeCloudImports = async <K extends CloudImportKey>(key: K, next: CloudImportValue<K>) => {
    const config = await readRecord();
    const cloudImports = readWorkspaceCloudImports(config);
    const nextConfig = withWorkspaceCloudImports(config, {
      ...cloudImports,
      [key]: next,
    });
    const persisted = await writeRecord(nextConfig);
    if (!persisted) {
      throw new Error(cloudImportUnavailableMessage[key]);
    }
  };

  return {
    readRecord,
    writeRecord,
    readCloudImports,
    writeCloudImports,
  };
}
