export type TranscriptToolFamily =
  | "read"
  | "write"
  | "command"
  | "search"
  | "list"
  | "delete"
  | "lint"
  | "web-fetch"
  | "web-search"
  | "plan"
  | "task"
  | "image-gen"
  | "generic";

export type TranscriptLintIssue = {
  message: string;
  location: string | null;
  severity: string | null;
};

export type TranscriptWebSearchResult = {
  title: string;
  url: string;
  site: string | null;
  snippet: string | null;
  favicon: string | null;
};

export type TranscriptTodoItem = {
  content: string;
  activeForm: string | null;
  status: "pending" | "in_progress" | "completed" | "cancelled";
};

export type TranscriptTaskToolItem = {
  name: string;
  status: string | null;
  summary: string | null;
};

export type TranscriptGeneratedImage = {
  url: string | null;
  base64: string | null;
  localPath: string | null;
};

export type TranscriptMcpContent =
  | { type: "text" | "resource"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type TranscriptMcpResourcePresentation = "download" | "http" | "image" | "text";

export type TranscriptDiffLine = {
  kind: "added" | "removed" | "unchanged";
  text: string;
};

export type TranscriptWriteEdit = {
  addedLines: number;
  removedLines: number;
  lines: TranscriptDiffLine[];
  omittedCount: number;
};

export type TranscriptFileResult = {
  path: string;
  fileName: string;
  isDirectory: boolean;
  startLine: number | null;
  endLine: number | null;
  content: string | null;
};

export type TranscriptSearchReference = {
  fileName: string;
  source: string;
  sourceType: string | null;
  startPos: number | null;
  endPos: number | null;
  knowledgeBaseId: string | null;
  chunk: string | null;
};

export type TranscriptSpecializedToolDetails =
  | { kind: "delete"; fileName: string; filePath: string }
  | {
      kind: "command";
      command: string;
      description: string | null;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      requiresApproval: boolean;
      standaloneTerminal: boolean;
    }
  | {
      kind: "write";
      fileName: string;
      filePath: string;
      operation: "create" | "modify" | "append";
      addedLines: number;
      removedLines: number;
      lines: TranscriptDiffLine[];
      edits: TranscriptWriteEdit[];
      omittedCount: number;
    }
  | {
      kind: "file-results";
      mode: "list" | "search";
      query: string;
      directory: string;
      items: TranscriptFileResult[];
      omittedCount: number;
    }
  | {
      kind: "references";
      referenceType: "codebase" | "knowledge";
      query: string;
      references: TranscriptSearchReference[];
    }
  | {
      kind: "lint";
      pathText: string;
      errorCount: number;
      issues: TranscriptLintIssue[];
      omittedCount: number;
    }
  | {
      kind: "web-fetch";
      url: string;
      title: string | null;
      favicon: string | null;
      content: string | null;
    }
  | { kind: "web-search"; query: string; results: TranscriptWebSearchResult[] }
  | {
      kind: "plan";
      name: string | null;
      overview: string | null;
      todos: TranscriptTodoItem[];
    }
  | {
      kind: "task";
      description: string;
      subagentName: string | null;
      toolItems: TranscriptTaskToolItem[];
      finalResult: string | null;
    }
  | {
      kind: "image-gen";
      prompt: string;
      status: "generating" | "completed" | "error";
      images: TranscriptGeneratedImage[];
      errorMessage: string | null;
    }
  | {
      kind: "compact-tool";
      variant: "memory" | "preview-url" | "read-rules" | "upload-file" | "skill-manage" | "present-files" | "cloud-service" | "generic";
      action: string | null;
      title: string | null;
      summary: string | null;
      result: string | null;
    }
  | {
      kind: "mcp";
      serverName: string;
      toolName: string;
      args: Record<string, unknown>;
      content: TranscriptMcpContent[];
      errorMessage: string | null;
      progress: { current: number; total: number | null; message: string | null } | null;
    }
  | {
      kind: "mcp-resource";
      server: string;
      uri: string;
      content: string;
      downloadPath: string | null;
      presentation: TranscriptMcpResourcePresentation;
    }
  | { kind: "skill"; skillName: string }
  | { kind: "visualizer-read-me"; result: string | null }
  | { kind: "completion"; message: string; success: boolean; details: string | null }
  | { kind: "open-result"; target: string; viewType: "preview" | "changes" | "artifacts" }
  | { kind: "mcp-match"; requests: Array<{ serverName: string; toolName: string }> }
  | {
      kind: "integration";
      integrationName: string;
      actionName: string | null;
      result: string | null;
      searchResults: Array<{ integrationId: string; integrationName: string; toolName: string }>;
      hint: string | null;
    };

export type TranscriptToolPresentation = {
  family: TranscriptToolFamily;
  secondary: string | null;
  lineRange: string | null;
  addedLines: number;
  removedLines: number;
  details: TranscriptSpecializedToolDetails | null;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function stringValue(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function rawStringValue(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function booleanValue(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "boolean") return value;
  }
  return false;
}

function optionalBooleanValue(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function optionalNumberValue(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  }
  return null;
}

function numberValue(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return 0;
}

function arrayValue(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  const direct = recordValue(value);
  if (direct) return direct;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function resultPayload(value: unknown) {
  const outer = parseRecord(value);
  if (!outer) return null;
  const result = parseRecord(outer.result);
  return result ?? outer;
}

function formattedValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parsedArguments(value: unknown) {
  if (typeof value !== "string") return recordValue(value) ?? {};
  try {
    return recordValue(JSON.parse(value)) ?? { arguments: value };
  } catch {
    return { arguments: value };
  }
}

function compactToolVariant(name: string): Extract<TranscriptSpecializedToolDetails, { kind: "compact-tool" }>["variant"] | null {
  if (["updatememory", "creatememory", "deletememory"].includes(name)) return "memory";
  if (name === "previewurl") return "preview-url";
  if (name === "readrules") return "read-rules";
  if (name === "uploadfile") return "upload-file";
  if (name === "skillmanage") return "skill-manage";
  if (name === "presentfiles") return "present-files";
  if (name === "connectcloudservice") return "cloud-service";
  return null;
}

function mcpResourcePresentation(input: {
  uri: string;
  content: string;
  downloadPath: string | null;
}): TranscriptMcpResourcePresentation {
  if (input.downloadPath && input.content.includes("Resource saved to:")) return "download";
  if (/^https?:\/\//i.test(input.uri)) return "http";
  if (/\.(?:png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#].*)?$/i.test(input.uri) && input.content.startsWith("data:image")) {
    return "image";
  }
  return "text";
}

function basename(value: string) {
  const normalized = value.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function normalizedToolName(value: string) {
  return value.toLowerCase().replace(/[-_]/g, "");
}

function isVisualizerReadMeToolName(value: string) {
  return [
    "readme",
    "visualize:readme",
    "visualizer:readme",
    "visualizer:readmetool",
    "getdesignspec",
  ].includes(normalizedToolName(value));
}

function visualizerReadMePayload(value: unknown): Record<string, unknown> | null {
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      const parsed = parseRecord(current);
      if (parsed) pending.push(parsed);
      continue;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (typeof current !== "object" || current === null) continue;
    const record = recordValue(current);
    if (!record || visited.has(current)) continue;
    visited.add(current);
    if (record.type === "visualizer_read_me_result") return record;
    for (const key of ["result", "output", "data", "content", "text"]) {
      const nested = record[key];
      if (nested !== undefined && nested !== current) pending.push(nested);
    }
  }
  return null;
}

function toolFamily(toolName: string): TranscriptToolFamily {
  const name = normalizedToolName(toolName);
  if (["read", "readfile"].includes(name)) return "read";
  if ([
    "write",
    "writefile",
    "edit",
    "editfile",
    "replaceinfile",
    "multiedit",
    "applypatch",
    "patch",
    "appendtofile",
  ].includes(name)) {
    return "write";
  }
  if (["bash", "shell", "execute", "executecommand", "runterminalcmd"].includes(name)) {
    return "command";
  }
  if ([
    "grep",
    "glob",
    "search",
    "searchfile",
    "searchcontent",
    "codebasesearch",
    "ragsearch",
    "find",
  ].includes(name)) {
    return "search";
  }
  if (["list", "listfiles", "listdir", "ls"].includes(name)) return "list";
  if (["delete", "deletefile", "deletefiles", "removefile"].includes(name)) return "delete";
  if (["readlint", "readlints", "lint", "diagnostics"].includes(name)) return "lint";
  if (["webfetch", "fetchurl"].includes(name)) return "web-fetch";
  if (["websearch", "searchweb"].includes(name)) return "web-search";
  if (["todowrite", "todoread", "plancreate", "planupdate"].includes(name)) return "plan";
  if (["task", "subagent", "runagent"].includes(name)) return "task";
  if (["imagegen", "generateimage"].includes(name)) return "image-gen";
  return "generic";
}

function normalizeGeneratedImage(value: unknown): TranscriptGeneratedImage | null {
  const record = recordValue(value);
  const url = stringValue(record, ["url"]);
  const base64 = stringValue(record, ["b64_json", "base64"]);
  const localPath = stringValue(record, ["localPath", "local_path", "path"]);
  return url || base64 || localPath ? { url, base64, localPath } : null;
}

function imageGenerationPayload(value: unknown) {
  let payload = resultPayload(value);
  for (let depth = 0; depth < 2; depth += 1) {
    const nested = parseRecord(payload?.result);
    if (!nested) break;
    payload = nested;
  }
  return payload;
}

function normalizeLintIssue(value: unknown): TranscriptLintIssue | null {
  const record = recordValue(value);
  const message = stringValue(record, ["message", "text", "description"]);
  if (!message) return null;
  const line = numberValue(record, ["line", "startLine", "lineNumber"]);
  const column = numberValue(record, ["column", "startColumn", "columnNumber"]);
  const explicitLocation = stringValue(record, ["location", "range"]);
  return {
    message,
    location: explicitLocation ?? (line > 0 ? `L${line}${column > 0 ? `:${column}` : ""}` : null),
    severity: stringValue(record, ["severity", "level", "type"]),
  };
}

function normalizeWebSearchResult(value: unknown): TranscriptWebSearchResult | null {
  const record = recordValue(value);
  const url = stringValue(record, ["url", "sourceUrl", "link"]) ?? "";
  const title = stringValue(record, ["title", "name", "description"]) ?? url;
  if (!url && !title) return null;
  return {
    title,
    url,
    site: stringValue(record, ["site", "siteName", "domain"]),
    snippet: stringValue(record, ["snippet", "content", "description"]),
    favicon: stringValue(record, ["favicon", "icon"]),
  };
}

function normalizeTodo(value: unknown): TranscriptTodoItem | null {
  const record = recordValue(value);
  const content = stringValue(record, ["content", "title", "text", "description"]);
  if (!content) return null;
  const status = stringValue(record, ["status"]);
  return {
    content,
    activeForm: stringValue(record, ["activeForm", "active_form"]),
    status:
      status === "in_progress" || status === "completed" || status === "cancelled"
        ? status
        : "pending",
  };
}

function normalizeTaskToolItem(value: unknown): TranscriptTaskToolItem | null {
  const record = recordValue(value);
  const name = stringValue(record, ["toolName", "name"]);
  if (!name) return null;
  const info = record?.info;
  return {
    name,
    status: stringValue(record, ["executeStatus", "status"]),
    summary:
      typeof info === "string"
        ? info.trim() || null
        : stringValue(recordValue(info), ["summary", "title", "path"]),
  };
}

const WRITE_RENDER_LINE_LIMIT = 500;

function splitLines(value: string) {
  return value.split(/\r?\n/);
}

function matrixRow(matrix: Uint16Array[], index: number) {
  const row = matrix[index];
  if (!row) throw new Error("Incomplete transcript diff matrix");
  return row;
}

function trimUnchangedEdges(lines: TranscriptDiffLine[]) {
  const firstChanged = lines.findIndex((line) => line.kind !== "unchanged");
  if (firstChanged < 0) return lines;
  let lastChanged = lines.length - 1;
  while (lastChanged > firstChanged && lines[lastChanged]?.kind === "unchanged") {
    lastChanged -= 1;
  }
  return lines.slice(firstChanged, lastChanged + 1);
}

function buildDiff(oldText: string, newText: string): TranscriptWriteEdit {
  const allOldLines = splitLines(oldText);
  const allNewLines = splitLines(newText);
  const oldLines = allOldLines.slice(0, WRITE_RENDER_LINE_LIMIT);
  const newLines = allNewLines.slice(0, WRITE_RENDER_LINE_LIMIT);
  const matrix = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint16Array(newLines.length + 1),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    const row = matrixRow(matrix, oldIndex);
    const nextRow = matrixRow(matrix, oldIndex + 1);
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      row[newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? nextRow[newIndex + 1] + 1
        : Math.max(nextRow[newIndex], row[newIndex + 1]);
    }
  }

  const rawLines: TranscriptDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      rawLines.push({ kind: "unchanged", text: oldLines[oldIndex] ?? "" });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    const nextOldScore = matrixRow(matrix, oldIndex + 1)[newIndex];
    const nextNewScore = matrixRow(matrix, oldIndex)[newIndex + 1];
    if (nextOldScore >= nextNewScore) {
      rawLines.push({ kind: "removed", text: oldLines[oldIndex] ?? "" });
      oldIndex += 1;
    } else {
      rawLines.push({ kind: "added", text: newLines[newIndex] ?? "" });
      newIndex += 1;
    }
  }
  while (oldIndex < oldLines.length) {
    rawLines.push({ kind: "removed", text: oldLines[oldIndex] ?? "" });
    oldIndex += 1;
  }
  while (newIndex < newLines.length) {
    rawLines.push({ kind: "added", text: newLines[newIndex] ?? "" });
    newIndex += 1;
  }

  const changedLines = trimUnchangedEdges(rawLines);
  const displayedLines = changedLines.slice(0, WRITE_RENDER_LINE_LIMIT);
  const sourceTailCount = Math.max(
    allOldLines.length - oldLines.length,
    allNewLines.length - newLines.length,
  );
  return {
    addedLines: rawLines.filter((line) => line.kind === "added").length,
    removedLines: rawLines.filter((line) => line.kind === "removed").length,
    lines: displayedLines,
    omittedCount: Math.max(0, changedLines.length - displayedLines.length) + sourceTailCount,
  };
}

function normalizeWriteEdit(value: unknown): TranscriptWriteEdit | null {
  const record = recordValue(value);
  const oldText = rawStringValue(record, ["oldString", "old_string"]);
  const newText = rawStringValue(record, ["newString", "new_string"]);
  if (!oldText && !newText) return null;
  return buildDiff(oldText ?? "", newText ?? "");
}

function addedContentLines(content: string) {
  const allLines = splitLines(content);
  return {
    lines: allLines
      .slice(0, WRITE_RENDER_LINE_LIMIT)
      .map((text): TranscriptDiffLine => ({ kind: "added", text })),
    omittedCount: Math.max(0, allLines.length - WRITE_RENDER_LINE_LIMIT),
  };
}

function parsePatchText(value: string) {
  const parsedLines: TranscriptDiffLine[] = [];
  let filePath = "";
  let operation: "create" | "modify" = "modify";
  let insideHunk = false;
  for (const line of splitLines(value)) {
    const fileHeader = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
    if (fileHeader) {
      if (!filePath) filePath = fileHeader[2]?.trim() ?? "";
      if (fileHeader[1] === "Add") operation = "create";
      insideHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      insideHunk = true;
      continue;
    }
    if (
      line === "*** Begin Patch" ||
      line === "*** End Patch" ||
      line.startsWith("*** Move to:") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (!insideHunk) continue;
    if (line.startsWith("+")) {
      parsedLines.push({ kind: "added", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      parsedLines.push({ kind: "removed", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      parsedLines.push({ kind: "unchanged", text: line.slice(1) });
    }
  }
  const displayedLines = parsedLines.slice(0, WRITE_RENDER_LINE_LIMIT);
  return {
    filePath,
    operation,
    lines: displayedLines,
    omittedCount: Math.max(0, parsedLines.length - displayedLines.length),
    addedLines: parsedLines.filter((line) => line.kind === "added").length,
    removedLines: parsedLines.filter((line) => line.kind === "removed").length,
  };
}

function normalizeFileResult(value: unknown): TranscriptFileResult | null {
  if (typeof value === "string") {
    const path = value.trim();
    if (!path) return null;
    const isDirectory = path.endsWith("/");
    return {
      path,
      fileName: basename(isDirectory ? path.slice(0, -1) : path),
      isDirectory,
      startLine: null,
      endLine: null,
      content: null,
    };
  }
  const record = recordValue(value);
  const path = stringValue(record, ["path", "filePath", "file", "name"]);
  if (!path) return null;
  const isDirectory = path.endsWith("/");
  const matches = record?.matches;
  return {
    path,
    fileName: basename(isDirectory ? path.slice(0, -1) : path),
    isDirectory,
    startLine: optionalNumberValue(record, ["line", "startLine"]),
    endLine: optionalNumberValue(record, ["endLine"]),
    content:
      typeof matches === "number"
        ? String(matches)
        : rawStringValue(record, ["matches", "content"]),
  };
}

function lineOrientedSearchResults(value: string) {
  return splitLines(value).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    const match = trimmed.match(/^(.+?):(\d+):(.*)$/);
    if (!match) {
      const item = normalizeFileResult(trimmed);
      return item ? [item] : [];
    }
    const path = match[1]?.trim() ?? "";
    const lineNumber = Number.parseInt(match[2] ?? "", 10);
    if (!path || !Number.isFinite(lineNumber)) return [];
    return [{
      path,
      fileName: basename(path),
      isDirectory: false,
      startLine: lineNumber,
      endLine: lineNumber,
      content: match[3]?.trim() || null,
    } satisfies TranscriptFileResult];
  });
}

function normalizeSearchReference(value: unknown): TranscriptSearchReference | null {
  const record = recordValue(value);
  const metadata = recordValue(record?.metadata);
  const source = stringValue(metadata, ["source"]) ?? "";
  const fileName = stringValue(metadata, ["file_name"]) ?? basename(source);
  if (!source && !fileName) return null;
  return {
    fileName,
    source,
    sourceType: stringValue(metadata, ["source_type"]),
    startPos: optionalNumberValue(metadata, ["start_pos"]),
    endPos: optionalNumberValue(metadata, ["end_pos"]),
    knowledgeBaseId: stringValue(record, ["knowledgeBaseId", "knowledge_base_id"]),
    chunk: rawStringValue(record, ["chunk"]),
  };
}

function specializedToolDetails(input: {
  toolName: string;
  family: TranscriptToolFamily;
  toolInput: Record<string, unknown> | undefined;
  toolOutput: unknown;
  toolMetadata: Record<string, unknown> | undefined;
}): TranscriptSpecializedToolDetails | null {
  const toolInput = input.toolInput ?? null;
  const payload = resultPayload(input.toolOutput);
  const normalizedName = normalizedToolName(input.toolName);

  if (isVisualizerReadMeToolName(input.toolName)) {
    const semanticPayload = visualizerReadMePayload(input.toolOutput);
    return {
      kind: "visualizer-read-me",
      result: formattedValue(semanticPayload ?? input.toolOutput),
    };
  }

  if (normalizedName === "mcpcalltool") {
    const output = parseRecord(input.toolOutput);
    const result = parseRecord(output?.result) ?? output;
    const progress = recordValue(input.toolMetadata?.mcpProgress) ?? recordValue(toolInput?.mcpProgress);
    const content = arrayValue(result, ["data"]).flatMap((value): TranscriptMcpContent[] => {
      const item = recordValue(value);
      const type = stringValue(item, ["type"]);
      if (type === "image") {
        const data = rawStringValue(item, ["data"]);
        return data ? [{ type: "image", data, mimeType: stringValue(item, ["mimeType"]) ?? "image/png" }] : [];
      }
      if (type === "resource") {
        const resource = recordValue(item?.resource);
        const text = rawStringValue(resource, ["text"]) ?? formattedValue(resource);
        return text ? [{ type: "resource", text }] : [];
      }
      const text = rawStringValue(item, ["text"]) ?? formattedValue(value);
      return text ? [{ type: "text", text }] : [];
    });
    const current = optionalNumberValue(progress, ["progress"]);
    return {
      kind: "mcp",
      serverName: stringValue(toolInput, ["serverName"]) ?? stringValue(result, ["serverName"]) ?? "",
      toolName: stringValue(toolInput, ["toolName"]) ?? stringValue(result, ["toolName"]) ?? "",
      args: parsedArguments(toolInput?.arguments),
      content,
      errorMessage: stringValue(result, ["error", "errorMessage"]),
      progress: current === null ? null : {
        current,
        total: optionalNumberValue(progress, ["total"]),
        message: stringValue(progress, ["message"]),
      },
    };
  }

  if (normalizedName === "fetchmcpresource") {
    const uri = stringValue(toolInput, ["uri"]) ?? stringValue(payload, ["uri"]) ?? "";
    const content = rawStringValue(payload, ["content"]) ?? "";
    const downloadPath = stringValue(payload, ["downloadPath"]) ?? stringValue(toolInput, ["downloadPath"]);
    return {
      kind: "mcp-resource",
      server: stringValue(toolInput, ["server"]) ?? stringValue(payload, ["server"]) ?? "",
      uri,
      content,
      downloadPath,
      presentation: mcpResourcePresentation({ uri, content, downloadPath }),
    };
  }

  if (normalizedName === "useskill") {
    return { kind: "skill", skillName: stringValue(toolInput, ["command"]) ?? "" };
  }

  if (["completion", "finishtask"].includes(normalizedName)) {
    return {
      kind: "completion",
      message: stringValue(toolInput, ["message"]) ?? stringValue(payload, ["message"]) ?? "",
      success: optionalBooleanValue(toolInput, ["success"])
        ?? optionalBooleanValue(payload, ["success"])
        ?? true,
      details: stringValue(payload, ["details"]),
    };
  }

  if (normalizedName === "openresultview") {
    const requestedView = stringValue(toolInput, ["viewType"]);
    return {
      kind: "open-result",
      target: stringValue(toolInput, ["target", "target_file", "filePath", "file_path", "path"]) ?? "",
      viewType: requestedView === "preview" || requestedView === "changes" ? requestedView : "artifacts",
    };
  }

  if (normalizedName === "mcpgettooldescription") {
    const rawRequests = toolInput?.toolRequests;
    let requestValues: unknown[] = [];
    if (Array.isArray(rawRequests)) requestValues = rawRequests;
    else if (typeof rawRequests === "string") {
      try {
        const parsed: unknown = JSON.parse(rawRequests);
        if (Array.isArray(parsed)) requestValues = parsed;
      } catch {
        requestValues = [];
      }
    }
    return {
      kind: "mcp-match",
      requests: requestValues.flatMap((value) => {
        if (!Array.isArray(value)) return [];
        const serverName = typeof value[0] === "string" ? value[0] : "";
        const toolName = typeof value[1] === "string" ? value[1] : "";
        return serverName || toolName ? [{ serverName, toolName }] : [];
      }),
    };
  }

  if ([
    "calltcbintegration",
    "calleopintegration",
    "callanydevintegration",
    "calllighthouseintegration",
    "callintegration",
    "searchintegrationtool",
  ].includes(normalizedName)) {
    const integrationLabels: Record<string, string> = {
      calltcbintegration: "CloudBase Integration",
      calleopintegration: "EOP Integration",
      callanydevintegration: "AnyDev Integration",
      calllighthouseintegration: "Lighthouse Integration",
      callintegration: "Integration",
      searchintegrationtool: "Search Integration Tool",
    };
    const searchResults = arrayValue(payload, ["data"]).flatMap((value) => {
      const item = recordValue(value);
      const integrationId = stringValue(item, ["integrationId"]) ?? "";
      const toolName = stringValue(item, ["toolName"]) ?? "";
      if (!integrationId && !toolName) return [];
      return [{
        integrationId,
        integrationName: stringValue(item, ["integrationName"]) ?? integrationId,
        toolName,
      }];
    });
    const dataRecord = recordValue(payload?.data);
    return {
      kind: "integration",
      integrationName: integrationLabels[normalizedName] ?? "Integration",
      actionName: stringValue(toolInput, ["toolName", "tool", "action"]),
      result: rawStringValue(dataRecord, ["text"]) ?? (searchResults.length === 0 ? formattedValue(payload?.data) : null),
      searchResults,
      hint: stringValue(payload, ["hint"]),
    };
  }

  const compactVariant = compactToolVariant(normalizedName);
  if (compactVariant) {
    return {
      kind: "compact-tool",
      variant: compactVariant,
      action: stringValue(toolInput, ["action"]),
      title: stringValue(toolInput, ["title", "name"]),
      summary: compactVariant === "memory"
        ? stringValue(toolInput, ["knowledge_to_store"])
        : compactVariant === "cloud-service"
          ? stringValue(toolInput, ["serviceName", "service", "name"])
        : compactVariant === "preview-url"
          ? stringValue(toolInput, ["url"])
          : compactVariant === "read-rules"
            ? stringValue(toolInput, ["ruleNames"])
            : stringValue(toolInput, ["name", "path", "file"]),
      result: compactVariant === "cloud-service" ? null : formattedValue(payload),
    };
  }

  if (input.family === "command") {
    const plainOutput = typeof input.toolOutput === "string" ? input.toolOutput : "";
    return {
      kind: "command",
      command: stringValue(toolInput, ["command", "cmd"]) ?? "",
      description: stringValue(toolInput, ["description"]),
      stdout: rawStringValue(payload, ["stdout"]) ?? plainOutput,
      stderr: rawStringValue(payload, ["stderr"]) ?? "",
      exitCode: optionalNumberValue(payload, ["exit_code", "exitCode"]),
      requiresApproval: booleanValue(toolInput, ["requires_approval", "requiresApproval"]),
      standaloneTerminal: booleanValue(payload, [
        "use_standalone_terminal",
        "standaloneTerminal",
      ]),
    };
  }

  if (input.family === "write") {
    const inputFilePath = stringValue(toolInput, [
      "filePath",
      "file_path",
      "name",
      "file",
      "path",
    ]) ?? "";
    const patchText = rawStringValue(toolInput, ["patchText", "patch", "diff"])
      ?? rawStringValue(payload, ["patch", "diff"]);
    const parsedPatch = patchText ? parsePatchText(patchText) : null;
    const filePath = inputFilePath || parsedPatch?.filePath || "";
    const content = rawStringValue(toolInput, ["content", "new_str"]);
    const oldContent = rawStringValue(payload, ["oldContent"])
      ?? rawStringValue(toolInput, ["old_str"]);
    const edits = arrayValue(toolInput, ["edits"]).flatMap((value) => {
      const edit = normalizeWriteEdit(value);
      return edit ? [edit] : [];
    });
    const operation = normalizedName === "appendtofile"
      ? "append"
      : parsedPatch?.operation
      ?? (oldContent !== null || edits.length > 0 ? "modify" : "create");
    const directDiff = oldContent !== null && content !== null
      ? buildDiff(oldContent, content)
      : content !== null
        ? { ...addedContentLines(content), addedLines: splitLines(content).length, removedLines: 0 }
        : parsedPatch ?? { lines: [], omittedCount: 0, addedLines: 0, removedLines: 0 };
    const editAddedLines = edits.reduce((total, edit) => total + edit.addedLines, 0);
    const editRemovedLines = edits.reduce((total, edit) => total + edit.removedLines, 0);
    return {
      kind: "write",
      fileName: basename(filePath),
      filePath,
      operation,
      addedLines: edits.length > 0 ? editAddedLines : directDiff.addedLines,
      removedLines: edits.length > 0 ? editRemovedLines : directDiff.removedLines,
      lines: edits.length > 0 ? [] : directDiff.lines,
      edits,
      omittedCount: edits.length > 0
        ? edits.reduce((total, edit) => total + edit.omittedCount, 0)
        : directDiff.omittedCount,
    };
  }

  if (input.family === "list" || input.family === "search") {
    const rawInput = recordValue(toolInput?._rawInput) ?? toolInput;
    const query = stringValue(rawInput, ["pattern", "key", "query"]) ?? "";
    const referenceValues = payload
      ? Object.entries(payload).flatMap(([key, value]) => /^\d+$/.test(key) ? [value] : [])
      : [];
    const references = referenceValues.flatMap((value) => {
      const reference = normalizeSearchReference(value);
      return reference ? [reference] : [];
    });
    if (references.length > 0 || normalizedName === "ragsearch") {
      return {
        kind: "references",
        referenceType: normalizedName === "ragsearch" ? "knowledge" : "codebase",
        query,
        references,
      };
    }
    const directItems = Array.isArray(input.toolOutput)
      ? input.toolOutput
      : typeof input.toolOutput === "string" && !parseRecord(input.toolOutput)
        ? lineOrientedSearchResults(input.toolOutput)
        : [];
    const itemValues = directItems.length > 0
      ? directItems
      : [
          ...arrayValue(payload, ["files"]),
          ...arrayValue(payload, ["results"]),
          ...arrayValue(payload, ["matches"]),
        ];
    const allItems = itemValues.flatMap((value) => {
      const item = normalizeFileResult(value);
      return item ? [item] : [];
    });
    return {
      kind: "file-results",
      mode: input.family === "list" ? "list" : "search",
      query,
      directory:
        stringValue(payload, ["path"]) ??
        stringValue(rawInput, ["target_directory", "directory"]) ??
        "",
      items: allItems.slice(0, 50),
      omittedCount: Math.max(0, allItems.length - 50),
    };
  }

  if (input.family === "image-gen") {
    const imagePayload = imageGenerationPayload(input.toolOutput);
    const rawStatus = stringValue(imagePayload, ["status"]);
    const status = rawStatus === "completed" || rawStatus === "executed"
      ? "completed"
      : rawStatus === "error" || rawStatus === "failed" || rawStatus === "cancelled"
        ? "error"
        : "generating";
    const images = arrayValue(imagePayload, ["images", "data"]).flatMap((value) => {
      const image = normalizeGeneratedImage(value);
      return image ? [image] : [];
    });
    return {
      kind: "image-gen",
      prompt:
        stringValue(imagePayload, ["prompt"]) ??
        stringValue(toolInput, ["prompt", "description"]) ??
        "",
      status,
      images,
      errorMessage: stringValue(imagePayload, ["errorMessage", "error", "message"]),
    };
  }

  if (input.family === "delete") {
    const filePath = stringValue(toolInput, [
      "target_file",
      "filePath",
      "file_path",
      "path",
      "file",
    ]);
    return filePath ? { kind: "delete", fileName: basename(filePath), filePath } : null;
  }

  if (input.family === "lint") {
    const paths = arrayValue(toolInput, ["paths", "files"])
      .flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []);
    const directPath = stringValue(toolInput, ["path", "filePath", "file"]);
    const issueValues = arrayValue(payload, ["diagnostics", "errors", "issues", "items"]);
    const allIssues = issueValues.flatMap((value) => {
      const issue = normalizeLintIssue(value);
      return issue ? [issue] : [];
    });
    const pathText = basename(directPath ?? paths[0] ?? "workspace");
    return {
      kind: "lint",
      pathText,
      errorCount: allIssues.length,
      issues: allIssues.slice(0, 20),
      omittedCount: Math.max(0, allIssues.length - 20),
    };
  }

  if (input.family === "web-fetch") {
    const url = stringValue(toolInput, ["url", "uri"]) ?? stringValue(payload, ["url"]) ?? "";
    const plainContent = typeof input.toolOutput === "string" ? input.toolOutput.trim() : "";
    return {
      kind: "web-fetch",
      url,
      title: stringValue(payload, ["title", "name"]),
      favicon: stringValue(payload, ["favicon", "icon"]),
      content: stringValue(payload, ["content", "data", "text"]) ?? (plainContent || null),
    };
  }

  if (input.family === "web-search") {
    const query = stringValue(payload, ["query"]) ?? stringValue(toolInput, ["query", "q"]) ?? "";
    const results = [
      ...arrayValue(payload, ["results", "items"]),
      ...arrayValue(payload, ["images"]),
    ].flatMap((value) => {
      const result = normalizeWebSearchResult(value);
      return result ? [result] : [];
    });
    return { kind: "web-search", query, results };
  }

  if (input.family === "plan") {
    const data = parseRecord(payload?.data) ?? payload;
    const todos = [
      ...arrayValue(toolInput, ["todos", "todolist", "tasks"]),
      ...arrayValue(data, ["todos", "todolist", "tasks"]),
    ].flatMap((value) => {
      const todo = normalizeTodo(value);
      return todo ? [todo] : [];
    });
    return {
      kind: "plan",
      name: stringValue(data, ["name", "title"]),
      overview: stringValue(data, ["overview", "description", "summary"]),
      todos,
    };
  }

  if (input.family === "task") {
    const toolItems = arrayValue(payload, ["toolInfo", "tools", "toolCalls"])
      .flatMap((value) => {
        const item = normalizeTaskToolItem(value);
        return item ? [item] : [];
      });
    const rawResult = typeof input.toolOutput === "string" ? input.toolOutput.trim() : "";
    return {
      kind: "task",
      description: stringValue(toolInput, ["description", "prompt", "task"]) ?? "",
      subagentName: stringValue(toolInput, ["subagent_name", "subagent_type", "agent"]),
      toolItems,
      finalResult: stringValue(payload, ["finalResult", "result", "summary"]) ?? (rawResult || null),
    };
  }

  if (input.family === "generic") {
    return {
      kind: "compact-tool",
      variant: "generic",
      action: null,
      title: null,
      summary: input.toolName,
      result: formattedValue(payload ?? input.toolOutput),
    };
  }

  return null;
}

function diffStats(value: unknown) {
  if (typeof value !== "string") return { addedLines: 0, removedLines: 0 };
  let addedLines = 0;
  let removedLines = 0;
  value.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) addedLines += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removedLines += 1;
  });
  return { addedLines, removedLines };
}

export function buildTranscriptToolPresentation(input: {
  toolName: string;
  toolInput: Record<string, unknown> | undefined;
  toolOutput: unknown;
  toolMetadata?: Record<string, unknown>;
}): TranscriptToolPresentation {
  const family = toolFamily(input.toolName);
  const outputRecord = resultPayload(input.toolOutput) ?? recordValue(input.toolOutput);
  const path = stringValue(input.toolInput ?? null, [
    "filePath",
    "file_path",
    "path",
    "file",
    "target_file",
    "target_directory",
    "root",
  ]);
  const command = stringValue(input.toolInput ?? null, ["command", "cmd"]);
  const query = stringValue(input.toolInput ?? null, ["query", "pattern", "key"]);
  const startLine = numberValue(input.toolInput ?? null, ["startLine", "start", "offset"]);
  const endLine = numberValue(input.toolInput ?? null, ["endLine", "end"]);
  const directAdded = numberValue(outputRecord, ["addLineCount", "addedLines", "added"]);
  const directRemoved = numberValue(outputRecord, ["removedLines", "removed"]);
  const patch =
    stringValue(input.toolInput ?? null, ["patchText", "patch", "diff"]) ??
    stringValue(outputRecord, ["patch", "diff"]) ??
    (typeof input.toolOutput === "string" ? input.toolOutput : null);
  const counted = diffStats(patch);
  const details = specializedToolDetails({
    toolName: input.toolName,
    family,
    toolInput: input.toolInput,
    toolOutput: input.toolOutput,
    toolMetadata: input.toolMetadata,
  });
  const specializedSecondary = (() => {
    if (!details) return null;
    if (details.kind === "command") return details.description ?? details.command;
    if (details.kind === "write") return details.filePath;
    if (details.kind === "file-results") return details.query || details.directory;
    if (details.kind === "references") return details.query;
    if (details.kind === "delete") return details.filePath;
    if (details.kind === "lint") return details.pathText;
    if (details.kind === "web-fetch") return details.title ?? details.url;
    if (details.kind === "web-search") return details.query;
    if (details.kind === "plan") return details.name ?? details.overview;
    if (details.kind === "image-gen") return details.prompt;
    if (details.kind === "task") return details.subagentName;
    if (details.kind === "mcp") return [details.serverName, details.toolName].filter(Boolean).join(" · ");
    if (details.kind === "mcp-resource") return details.uri;
    if (details.kind === "skill") return details.skillName;
    if (details.kind === "visualizer-read-me") return null;
    if (details.kind === "completion") return details.message;
    if (details.kind === "open-result") return details.target;
    if (details.kind === "mcp-match") return details.requests.map((request) => request.serverName).filter(Boolean).join(", ");
    if (details.kind === "integration") return details.actionName ?? details.integrationName;
    return details.variant === "generic" ? null : details.summary;
  })();

  return {
    family,
    secondary:
      family === "read"
        ? null
        : specializedSecondary ?? (family === "command"
        ? command
        : family === "search"
          ? query
          : path),
    lineRange:
      family === "read" && (startLine > 0 || endLine > 0)
        ? `L${startLine || 1}-${endLine || "end"}`
        : null,
    addedLines:
      directAdded || (details?.kind === "write" ? details.addedLines : counted.addedLines),
    removedLines:
      directRemoved || (details?.kind === "write" ? details.removedLines : counted.removedLines),
    details,
  };
}
