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

export type TranscriptSpecializedToolDetails =
  | { kind: "delete"; fileName: string; filePath: string }
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

function basename(value: string) {
  const normalized = value.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function normalizedToolName(value: string) {
  return value.toLowerCase().replace(/[-_]/g, "");
}

function toolFamily(toolName: string): TranscriptToolFamily {
  const name = normalizedToolName(toolName);
  if (["read", "readfile"].includes(name)) return "read";
  if (["write", "writefile", "edit", "editfile", "multiedit", "applypatch", "patch"].includes(name)) {
    return "write";
  }
  if (["bash", "shell", "execute", "executecommand", "runterminalcmd"].includes(name)) {
    return "command";
  }
  if (["grep", "glob", "search", "searchfile", "searchcontent", "find"].includes(name)) {
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

function specializedToolDetails(input: {
  family: TranscriptToolFamily;
  toolInput: Record<string, unknown> | undefined;
  toolOutput: unknown;
}): TranscriptSpecializedToolDetails | null {
  const toolInput = input.toolInput ?? null;
  const payload = resultPayload(input.toolOutput);

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
}): TranscriptToolPresentation {
  const family = toolFamily(input.toolName);
  const outputRecord = recordValue(input.toolOutput);
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
  const directAdded = numberValue(outputRecord, ["addedLines", "added"]);
  const directRemoved = numberValue(outputRecord, ["removedLines", "removed"]);
  const patch =
    stringValue(input.toolInput ?? null, ["patchText", "patch", "diff"]) ??
    stringValue(outputRecord, ["patch", "diff"]) ??
    (typeof input.toolOutput === "string" ? input.toolOutput : null);
  const counted = diffStats(patch);
  const details = specializedToolDetails({
    family,
    toolInput: input.toolInput,
    toolOutput: input.toolOutput,
  });
  const specializedSecondary = (() => {
    if (!details) return null;
    if (details.kind === "delete") return details.filePath;
    if (details.kind === "lint") return details.pathText;
    if (details.kind === "web-fetch") return details.title ?? details.url;
    if (details.kind === "web-search") return details.query;
    if (details.kind === "plan") return details.name ?? details.overview;
    if (details.kind === "image-gen") return details.prompt;
    return details.subagentName;
  })();

  return {
    family,
    secondary:
      specializedSecondary ?? (family === "command"
        ? command
        : family === "search"
          ? query
          : path),
    lineRange:
      family === "read" && (startLine > 0 || endLine > 0)
        ? `L${startLine || 1}-${endLine || "end"}`
        : null,
    addedLines: directAdded || counted.addedLines,
    removedLines: directRemoved || counted.removedLines,
    details,
  };
}
