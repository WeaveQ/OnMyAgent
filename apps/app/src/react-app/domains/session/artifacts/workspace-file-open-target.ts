import {
  classifyOpenTarget,
  type OpenTarget,
  type OpenTargetPreview,
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

function fileUrlForPath(path: string) {
  const url = new URL("file:///");
  url.pathname = path;
  return url.toString();
}

function isBrowserOpenablePreview(preview: OpenTargetPreview) {
  return preview === "html";
}

export function workspaceFileOpenTarget(
  input: WorkspaceFileOpenTargetInput,
): OpenTarget {
  const preview = classifyOpenTarget(input.path, "file");
  const absolutePath = absoluteFilePath(input.fileRoot, input.path);
  const isBrowserOpenable = isBrowserOpenablePreview(preview);
  return {
    id: `${isBrowserOpenable ? "url" : "file"}:${absolutePath.toLowerCase()}`,
    kind: isBrowserOpenable ? "url" : "file",
    value: isBrowserOpenable ? fileUrlForPath(absolutePath) : input.path,
    name: input.name,
    preview: isBrowserOpenable ? "browser" : preview,
    confidence: 100,
    reason: "workspace file click",
    exists: true,
    size: input.size,
    updatedAt: input.mtimeMs,
  };
}
