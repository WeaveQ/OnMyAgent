/**
 * Map OfficeCLI invocations to ONMYAGENT_DELIVERABLE paths for session product cards.
 * Shared by the managed launcher and unit tests.
 */

const OFFICE_DOC_EXT = /\.(docx|xlsx|pptx)$/i;

/** Verbs that create or flush document bytes on disk. */
const MUTATING_VERBS = new Set([
  "create",
  "save",
  "close",
  "set",
  "add",
  "remove",
  "move",
  "swap",
  "batch",
  "raw-set",
  "add-part",
  "refresh",
  // merge <template> <output> --data … writes the output document
  "merge",
]);

/** Flags whose next token is a value, not a file path. */
const FLAGS_WITH_VALUE = new Set([
  "--type",
  "--locale",
  "--commands",
  "--input",
  "--prop",
  "--depth",
  "--after",
  "--before",
  "--to",
  "--from",
  "--index",
  "--path",
  "--path2",
  "--selector",
  "--mode",
  "--part",
  "--parent",
  "--out",
  "--data",
]);

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isOfficeCliDocumentPath(value) {
  const text = String(value ?? "").trim().replace(/^["']|["']$/g, "");
  if (!text) return false;
  return OFFICE_DOC_EXT.test(text);
}

/**
 * @param {string[]} argv process.argv.slice(2) style args (no binary name)
 * @returns {{ verb: string | null, file: string | null, template?: string | null }}
 */
export function parseOfficeCliArgv(argv) {
  const tokens = Array.isArray(argv) ? argv.map(String) : [];
  let index = 0;

  const skipFlag = () => {
    const flag = tokens[index];
    if (!flag?.startsWith("-")) return false;
    const name = flag.includes("=") ? flag.slice(0, flag.indexOf("=")) : flag;
    if (FLAGS_WITH_VALUE.has(name) && !flag.includes("=")) {
      index += 2;
      return true;
    }
    index += 1;
    return true;
  };

  while (index < tokens.length && tokens[index].startsWith("-")) {
    skipFlag();
  }

  const verbRaw = tokens[index];
  if (!verbRaw || verbRaw.startsWith("-")) {
    return { verb: null, file: null };
  }
  const verb = verbRaw.toLowerCase();
  index += 1;

  if (verb === "help" || verb === "plugins" || verb === "version") {
    return { verb, file: null };
  }

  // merge <template> <output> — deliverable is the output (2nd positional), not the template.
  if (verb === "merge") {
    const positionals = [];
    while (index < tokens.length) {
      if (tokens[index].startsWith("-")) {
        skipFlag();
        continue;
      }
      positionals.push(tokens[index].replace(/^["']|["']$/g, ""));
      index += 1;
    }
    const template = positionals[0] || null;
    const output = positionals[1] || null;
    return { verb, file: output, template };
  }

  while (index < tokens.length) {
    if (tokens[index].startsWith("-")) {
      skipFlag();
      continue;
    }
    const file = tokens[index].replace(/^["']|["']$/g, "");
    return { verb, file: file || null };
  }

  return { verb, file: null };
}

/**
 * @param {string} stdout
 * @returns {string[]}
 */
export function extractOfficeCliPathsFromStdout(stdout) {
  const text = String(stdout ?? "");
  if (!text.trim()) return [];
  const paths = [];

  for (const match of text.matchAll(/(?:^|\n)Created:\s*(.+?)(?:\s*\(|\s*$)/gim)) {
    const raw = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
    if (isOfficeCliDocumentPath(raw)) paths.push(raw);
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object") continue;
      if (parsed.success === false) continue;
      for (const key of ["message", "data"]) {
        const value = parsed[key];
        if (typeof value !== "string") continue;
        for (const match of value.matchAll(/Created:\s*(.+?)(?:\s*\(|\s*$)/gim)) {
          const raw = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
          if (isOfficeCliDocumentPath(raw)) paths.push(raw);
        }
        if (isOfficeCliDocumentPath(value.trim())) paths.push(value.trim());
      }
      if (typeof parsed.path === "string" && isOfficeCliDocumentPath(parsed.path)) {
        paths.push(parsed.path.trim());
      }
      // officecli merge --json: { success, data: { output: "…/out.docx", … } }
      if (parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
        const output = parsed.data.output;
        if (typeof output === "string" && isOfficeCliDocumentPath(output)) {
          paths.push(output.trim());
        }
        const pathAlt = parsed.data.path;
        if (typeof pathAlt === "string" && isOfficeCliDocumentPath(pathAlt)) {
          paths.push(pathAlt.trim());
        }
      }
    } catch {
      // ignore
    }
  }

  return paths;
}

/**
 * @param {{ argv?: string[], stdout?: string, exitCode?: number | null }} input
 * @returns {string[]}
 */
export function collectOfficeCliDeliverablePaths(input = {}) {
  const exitCode = input.exitCode;
  if (exitCode != null && exitCode !== 0) return [];

  const argv = Array.isArray(input.argv) ? input.argv : [];
  const stdout = String(input.stdout ?? "");
  const { verb, file } = parseOfficeCliArgv(argv);
  const paths = [];

  if (verb && MUTATING_VERBS.has(verb) && file && isOfficeCliDocumentPath(file)) {
    paths.push(file);
  }

  for (const item of extractOfficeCliPathsFromStdout(stdout)) {
    paths.push(item);
  }

  const seen = new Set();
  return paths.filter((value) => {
    const key = value.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {string[]} paths
 * @returns {string}
 */
export function formatOfficeCliDeliverableMarkers(paths) {
  const lines = [];
  for (const value of paths) {
    const pathText = String(value ?? "").trim();
    if (!pathText) continue;
    lines.push(`ONMYAGENT_DELIVERABLE: ${pathText}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
