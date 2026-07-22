export type ArtifactEditingBridge = {
  openForEditing?: (request: { filePath: string }) => Promise<{ ok: boolean }>;
};

export async function openArtifactForEditing(
  filePath: string,
  bridge?: ArtifactEditingBridge,
): Promise<void> {
  const editingBridge = bridge ?? (
    typeof window === "undefined" ? undefined : window.__ONMYAGENT_ELECTRON__?.artifactPreview
  );
  if (!editingBridge?.openForEditing) throw new Error("Artifact editing is unavailable");
  const result = await editingBridge.openForEditing({ filePath });
  if (!result.ok) throw new Error("Artifact editing failed");
}
