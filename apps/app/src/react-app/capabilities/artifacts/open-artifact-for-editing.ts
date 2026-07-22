export type ArtifactEditingBridge = {
  openForEditing?: (request: { filePath: string }) => Promise<{ ok: boolean }>;
};

type EditableArtifactTarget = {
  preview: string;
  name?: string;
  value?: string;
};

const EDITABLE_ARTIFACT_EXTENSIONS = new Set([
  ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".rtf", ".odt",
  ".xls", ".xlsx", ".xlsm", ".xlsb", ".xlt", ".xltx", ".xltm", ".ods", ".fods",
  ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm", ".pot", ".potx", ".potm", ".odp",
  ".pdf",
]);

export function canEditArtifactTarget(target: EditableArtifactTarget): boolean {
  const filename = target.name || target.value || "";
  const extensionIndex = filename.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? filename.slice(extensionIndex).toLowerCase() : "";
  return EDITABLE_ARTIFACT_EXTENSIONS.has(extension);
}

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
