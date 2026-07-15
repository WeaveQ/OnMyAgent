export type TranscriptToolFamily =
  | "read"
  | "write"
  | "command"
  | "search"
  | "list"
  | "generic";

export type TranscriptToolPresentation = {
  family: TranscriptToolFamily;
  secondary: string | null;
  lineRange: string | null;
  addedLines: number;
  removedLines: number;
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

function toolFamily(toolName: string): TranscriptToolFamily {
  const name = toolName.toLowerCase().replace(/[-_]/g, "");
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
  return "generic";
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

  return {
    family,
    secondary:
      family === "command"
        ? command
        : family === "search"
          ? query
          : path,
    lineRange:
      family === "read" && (startLine > 0 || endLine > 0)
        ? `L${startLine || 1}-${endLine || "end"}`
        : null,
    addedLines: directAdded || counted.addedLines,
    removedLines: directRemoved || counted.removedLines,
  };
}
