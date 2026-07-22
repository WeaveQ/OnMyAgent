import {
  classifyOpenTarget,
  type OpenTarget,
} from "./open-target";

type WorkspaceFileOpenTargetInput = {
  fileRoot: string;
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
};

function absoluteFilePath(fileRoot: string, filePath: string) {
  if (filePath.startsWith("/")) return filePath;
  return `${fileRoot.replace(/[/\\]+$/, "")}/${filePath.replace(/^[/\\]+/, "")}`;
}

export function workspaceFileOpenTarget(
  input: WorkspaceFileOpenTargetInput,
): OpenTarget {
  const preview = classifyOpenTarget(input.path, "file");
  const absolutePath = absoluteFilePath(input.fileRoot, input.path);
  return {
    id: `file:${absolutePath.toLowerCase()}`,
    kind: "file",
    value: input.path,
    name: input.name,
    preview,
    confidence: 100,
    reason: "workspace file click",
    exists: true,
    size: input.size,
    updatedAt: input.mtimeMs,
  };
}
