import type { ArtifactPluginConnectionState } from "@onmyagent/types/artifact-plugin";
import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";

import type { OnMyAgentServerClient } from "@/app/lib/onmyagent-server";

export type ArtifactPluginDetail = ArtifactPluginCatalogItem & {
  connection?: ArtifactPluginConnectionState;
};

export type ArtifactPluginClient = Pick<
  OnMyAgentServerClient,
  | "listArtifactPlugins"
  | "getArtifactPlugin"
  | "setArtifactPluginEnabled"
  | "setArtifactPluginSkillEnabled"
  | "getArtifactPluginConnection"
>;

export async function loadArtifactPluginCatalog(
  client: ArtifactPluginClient,
  workspaceId: string,
) {
  return client.listArtifactPlugins(workspaceId);
}

export async function loadArtifactPluginDetail(
  client: ArtifactPluginClient,
  workspaceId: string,
  pluginId: string,
): Promise<ArtifactPluginDetail> {
  const [{ item }, connection] = await Promise.all([
    client.getArtifactPlugin(workspaceId, pluginId),
    pluginId === "spreadsheets"
      ? client.getArtifactPluginConnection(workspaceId, pluginId)
      : Promise.resolve(undefined),
  ]);
  return { ...item, connection };
}
