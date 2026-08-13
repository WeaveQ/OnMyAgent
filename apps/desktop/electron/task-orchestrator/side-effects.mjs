import { createHash } from "node:crypto";

import { ACTIVE_RUN_STATUSES, findAttempt } from "./definitions.mjs";
import { redactSensitiveText, safeStructuredText, safeText } from "./durable-redaction.mjs";

const TERMINAL = new Map([
  ["completed", "completed"],
  ["complete", "completed"],
  ["succeeded", "completed"],
  ["success", "completed"],
  ["failed", "failed"],
  ["error", "failed"],
  ["cancelled", "cancelled"],
  ["canceled", "cancelled"],
]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "timeout", "missing"]);
const READ_ONLY_COMMANDS = new Set([
  ":", "[", "basename", "cat", "cd", "cmp", "column", "cut", "date", "df", "diff", "dirname", "du",
  "echo", "egrep", "false", "fgrep", "file", "grep", "head", "hexdump", "id", "jq", "lsof", "ls", "md5", "md5sum",
  "nl", "od", "pgrep", "printf", "ps", "pwd", "read", "readlink", "realpath", "rg", "ripgrep", "shasum", "sha1sum",
  "sha256sum", "sort", "stat", "strings", "sw_vers", "tail", "test", "tr", "tree", "true", "type", "uname",
  "uniq", "wc", "whereis", "which", "whoami", "yq",
]);
const READ_ONLY_GIT_COMMANDS = new Set([
  "blame", "cat-file", "describe", "diff", "grep", "help", "log", "ls-files", "ls-tree", "name-rev", "rev-parse",
  "shortlog", "show", "status", "version",
]);

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function shellWords(value) {
  const words = [];
  let word = "";
  let quote = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) { word += character; escaped = false; continue; }
    if (character === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = null;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (/\s/.test(character)) {
      if (word) { words.push(word); word = ""; }
      continue;
    }
    word += character;
  }
  if (escaped || quote) return null;
  if (word) words.push(word);
  return words;
}

function shellSegments(value) {
  const command = value
    .replace(/(?:^|\s)\d*>\s*\/dev\/null\b/g, " ")
    // File-descriptor duplication changes only where this command's existing
    // stdout/stderr stream is observed; it does not persist an external write.
    .replace(/(?:^|\s)\d*>&(?:\d+|-)(?=\s|$|[;|&)])/g, " ");
  if (/\$\(|`|<<|<\(|>\(/.test(command)) return null;
  const segments = [];
  let segment = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) { segment += character; escaped = false; continue; }
    if (character === "\\" && quote !== "'") { segment += character; escaped = true; continue; }
    if (quote) {
      segment += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; segment += character; continue; }
    if (character === ">" || character === "&" && command[index + 1] !== "&") return null;
    // Plain subshell grouping is only a control boundary. Command/process
    // substitution was rejected above, and each command inside the group is
    // still classified independently, so `(git status)` is read-only while
    // `(rm file)` remains blocked.
    if (character === "(" || character === ")") {
      if (segment.trim()) segments.push(segment.trim());
      segment = "";
      continue;
    }
    const separator = character === "\n" || character === ";" || character === "|" || character === "&";
    if (separator) {
      if (segment.trim()) segments.push(segment.trim());
      segment = "";
      if ((character === "|" || character === "&") && command[index + 1] === character) index += 1;
      continue;
    }
    segment += character;
  }
  if (escaped || quote) return null;
  if (segment.trim()) segments.push(segment.trim());
  return segments;
}

function isReadOnlyGit(words) {
  let index = 1;
  while (index < words.length && words[index].startsWith("-")) {
    const option = words[index];
    if (option === "-C" || option === "--git-dir" || option === "--work-tree" || option === "--namespace") index += 2;
    else if (/^--(?:git-dir|work-tree|namespace)=/.test(option) || ["--no-pager", "--literal-pathspecs", "--no-optional-locks"].includes(option)) index += 1;
    else return false;
  }
  const subcommand = words[index] ?? "";
  const rest = words.slice(index + 1);
  if (READ_ONLY_GIT_COMMANDS.has(subcommand)) return true;
  if (subcommand === "branch") {
    // `git branch` and its listing variants are observational, but the same
    // subcommand also owns delete/move/copy mutations. Reject every mutating
    // switch first, then allow only bounded list/show forms (`-a` included).
    if (rest.some((value) => /^(?:-[dDmMcCf]|--(?:delete|move|copy|force|edit-description|set-upstream-to|unset-upstream))$/.test(value))) return false;
    if (!rest.length) return true;
    return rest.some((value) => /^(?:-[arv]+|--(?:all|remotes|verbose|list|show-current|contains|merged|no-merged))$/.test(value));
  }
  if (subcommand === "tag") return rest.some((value) => value === "--list" || value === "-l");
  if (subcommand === "worktree") return rest[0] === "list";
  if (subcommand === "submodule") return rest[0] === "status";
  if (subcommand === "remote") return rest[0] === "-v" || rest[0] === "get-url";
  if (subcommand === "config") return rest.some((value) => /^(?:--get(?:-all|-regexp)?|--list|--show-origin|--show-scope|get)$/.test(value));
  return false;
}

function isReadOnlySed(words) {
  if (words.some((value) => value === "--in-place" || /^-i/.test(value))) return false;
  const programIndex = words.findIndex((value, index) => index > 0 && !value.startsWith("-") && words[index - 1] !== "-e");
  const program = programIndex > 0 ? words[programIndex] : null;
  if (!program) return false;
  if (words.includes("-n") && /^(?:(?:\d+(?:,\d+)?|\$)?p)(?:;\s*(?:\d+(?:,\d+)?|\$)?p)*$/.test(program)) return true;
  // A plain substitution writes only to stdout unless `-i` is present or the
  // substitution carries sed's `w`/`e` side-effect flags. Parse the delimiter
  // instead of allowing arbitrary sed programs so `w file` remains blocked.
  if (program[0] !== "s" || program.length < 4) return false;
  const delimiter = program[1];
  if (/\s|[A-Za-z0-9\\]/.test(delimiter)) return false;
  let separators = 0;
  let escaped = false;
  let flags = "";
  for (let index = 2; index < program.length; index += 1) {
    const character = program[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character === delimiter) {
      separators += 1;
      if (separators === 2) flags = program.slice(index + 1);
    }
  }
  return separators === 2 && /^(?:[gIp]|\d)*$/.test(flags);
}

function isReadOnlyXxd(words) {
  const positional = words.slice(1).filter((value) => !value.startsWith("-"));
  // `xxd input` writes only a hex dump to stdout. A second positional path is
  // an output file, and reverse mode can mutate it, so keep those denied.
  return !words.includes("-r") && !words.includes("--revert") && positional.length <= 1;
}

function unwrapReadOnlyProcessSubstitutions(value, depth) {
  if (!value.includes("<(")) return value;
  if (depth >= 2 || value.includes(">(")) return null;
  let normalized = "";
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("<(", cursor);
    if (start < 0) { normalized += value.slice(cursor); break; }
    normalized += value.slice(cursor, start);
    let quote = null;
    let escaped = false;
    let nesting = 1;
    let end = start + 2;
    for (; end < value.length; end += 1) {
      const character = value[end];
      if (escaped) { escaped = false; continue; }
      if (character === "\\" && quote !== "'") { escaped = true; continue; }
      if (quote) { if (character === quote) quote = null; continue; }
      if (character === "'" || character === '"') { quote = character; continue; }
      if (character === "(") nesting += 1;
      else if (character === ")" && --nesting === 0) break;
    }
    if (nesting !== 0) return null;
    const body = value.slice(start + 2, end);
    if (!isReadOnlyShellCommand(body, depth + 1)) return null;
    normalized += "/dev/fd/0";
    cursor = end + 1;
  }
  return normalized;
}

function unwrapReadOnlyCommandSubstitutions(value, depth) {
  if (!value.includes("$(")) return value;
  if (depth >= 2 || value.includes("$((")) return null;
  let normalized = "";
  let cursor = 0;
  let outerQuote = null;
  let escaped = false;
  while (cursor < value.length) {
    const character = value[cursor];
    if (escaped) {
      normalized += character;
      escaped = false;
      cursor += 1;
      continue;
    }
    if (character === "\\" && outerQuote !== "'") {
      normalized += character;
      escaped = true;
      cursor += 1;
      continue;
    }
    if (character === "'") {
      outerQuote = outerQuote === "'" ? null : outerQuote === null ? "'" : outerQuote;
      normalized += character;
      cursor += 1;
      continue;
    }
    if (character === '"') {
      outerQuote = outerQuote === '"' ? null : outerQuote === null ? '"' : outerQuote;
      normalized += character;
      cursor += 1;
      continue;
    }
    if (outerQuote !== "'" && character === "$" && value[cursor + 1] === "(") {
      let quote = null;
      let innerEscaped = false;
      let nesting = 1;
      let end = cursor + 2;
      for (; end < value.length; end += 1) {
        const inner = value[end];
        if (innerEscaped) { innerEscaped = false; continue; }
        if (inner === "\\" && quote !== "'") { innerEscaped = true; continue; }
        if (quote) { if (inner === quote) quote = null; continue; }
        if (inner === "'" || inner === '"') { quote = inner; continue; }
        if (inner === "(") nesting += 1;
        else if (inner === ")" && --nesting === 0) break;
      }
      if (nesting !== 0) return null;
      const body = value.slice(cursor + 2, end);
      if (!isReadOnlyShellCommand(body, depth + 1)) return null;
      normalized += "readonly_substitution";
      cursor = end + 1;
      continue;
    }
    normalized += character;
    cursor += 1;
  }
  return normalized;
}

function isReadOnlyFind(value) {
  return /(?:^|\s)find(?:\s|$)/.test(value)
    && !/(?:^|\s)-(?:delete|exec(?:dir)?|ok(?:dir)?|fprint(?:f)?|fls)\b|(?:^|\s)>\s*|[;&|`]|\$\(/.test(value);
}

function literalShellBody(value) {
  // Parse the wrapper using the same shell-word rules as the command itself.
  // A regex cannot safely unwrap real ACP commands that use adjacent quote
  // fragments (for example: `zsh -lc "rg '"'pattern|more'"' file"`).
  // shellWords preserves the single -c argument while normalizing those quote
  // transitions, so separators inside the pattern stay quoted on the next pass.
  const words = shellWords(value);
  if (words?.length !== 3) return null;
  const executable = words[0].split("/").at(-1);
  if (!["bash", "dash", "sh", "zsh"].includes(executable)) return null;
  if (!["-c", "-cl", "-lc"].includes(words[1])) return null;
  return words[2];
}

function isReadOnlyShellCommand(value, depth = 0) {
  const wrapped = depth < 2 ? literalShellBody(value) : null;
  if (wrapped !== null) return isReadOnlyShellCommand(wrapped, depth + 1);
  const processNormalized = unwrapReadOnlyProcessSubstitutions(value, depth);
  if (processNormalized === null) return false;
  const normalized = unwrapReadOnlyCommandSubstitutions(processNormalized, depth);
  if (normalized === null) return false;
  const segments = shellSegments(normalized);
  if (!segments?.length) return false;
  return segments.every((segment) => {
    const words = shellWords(segment);
    if (!words?.length) return false;
    while (["!", "do", "elif", "else", "if", "then"].includes(words[0])) words.shift();
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? "")) words.shift();
    if (!words.length || ["done", "fi"].includes(words[0])) return true;
    if (words[0] === "for") return words.length >= 4 && words[2] === "in";
    const executable = words[0].split("/").at(-1);
    if (READ_ONLY_COMMANDS.has(executable)) return true;
    if (executable === "command") return words[1] === "-v";
    if (executable === "find") return isReadOnlyFind(segment);
    if (executable === "git") return isReadOnlyGit(words);
    if (executable === "sed") return isReadOnlySed(words);
    if (executable === "xxd") return isReadOnlyXxd(words);
    return false;
  });
}

function shellCommandForTool(tool) {
  const input = safeText(tool.input).trim();
  if (input.startsWith("{")) {
    try {
      const parsed = JSON.parse(input);
      const command = safeText(parsed?.command ?? parsed?.cmd).trim();
      if (command) return command;
    } catch { /* fall through to the durable display operation */ }
  }
  const display = safeText(tool.operation).trim();
  if (!/^["'](?=[A-Za-z/])/.test(display)) return display;
  const quote = display[0];
  // ACP command cards sometimes wrap the entire display command in quotes.
  // Remove the matching closing wrapper too; stripping only the opening quote
  // leaves a synthetic unterminated shell quote and misclassifies a bounded
  // read such as `"nl ... | sed ..."` as a write. If the display was truncated,
  // retain the previous conservative leading-wrapper normalization.
  return display.endsWith(quote) ? display.slice(1, -1) : display.slice(1);
}

function eventToolParts(event) {
  const call = event.toolCall && typeof event.toolCall === "object" ? event.toolCall : null;
  const update = event.update && typeof event.update === "object" ? event.update : null;
  const rawInput = call?.input ?? update?.rawInput ?? update?.raw_input ?? update?.input ?? null;
  const toolCallId = safeText(
    call?.id ?? call?.callId ?? update?.toolCallId ?? update?.tool_call_id ?? update?.id ?? "",
  ).trim().slice(0, 240);
  return { call, update, rawInput, toolCallId };
}

function taskControlToolCallId(event) {
  if (event?.type !== "tool" && event?.type !== "acp_tool_call") return null;
  const { rawInput, toolCallId } = eventToolParts(event);
  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    const server = safeText(rawInput.server ?? rawInput.serverName ?? rawInput.server_name).trim();
    if (server === "onmyagent-task-control") return toolCallId || null;
  }
  return null;
}

function eventTool(event, ignoredToolCallIds = null) {
  if (event?.type !== "tool" && event?.type !== "acp_tool_call") return null;
  const { call, update, rawInput, toolCallId } = eventToolParts(event);
  if (!toolCallId) return null;
  if (ignoredToolCallIds?.has(toolCallId)) return null;
  // Codex ACP reports Task MCP bootstrap as a synthetic failed tool call. It is
  // transport diagnostics, not an operation requested by the provider, and it
  // has no rawInput.server field for the normal Task MCP exclusion above.
  if (toolCallId === "mcp_startup.onmyagent-task-control") return null;
  const operationValue = call?.name ?? update?.title ?? update?.name ?? call?.kind ?? update?.kind ?? "";
  const operation = redactSensitiveText(operationValue, 240).trim();
  if (operation === "mcp__onmyagent-task-control__startup") return null;
  const kind = safeText(call?.kind ?? update?.kind ?? "").trim();
  const input = safeStructuredText(rawInput ?? "");
  const output = safeStructuredText(call?.output ?? update?.output ?? update?.rawOutput ?? update?.raw_output ?? "");
  const status = safeText(call?.status ?? update?.status ?? update?.state ?? "").trim().toLowerCase().replaceAll("_", "-");
  return { toolCallId, operation, kind, input, output, status, at: Number.isInteger(event.at) ? event.at : null };
}

export function classifySideEffect(tool) {
  const descriptor = `${tool.operation} ${tool.kind} ${tool.input}`.toLowerCase();
  // Task Center MCP calls are already serialized, lease-fenced and audited by
  // the durable control plane. They are not external provider side effects and
  // must not be left as unknown receipts when ACP omits their terminal cards.
  if (/mcp[._-]onmyagent-task-control[._-]|["']server["']\s*:\s*["']onmyagent-task-control["']/.test(descriptor)) {
    return "read-only";
  }
  // ACP exposes first-class read/search tool kinds. Their titles legitimately
  // contain source identifiers such as `writeFile`, `rename`, `abort`, or
  // `delete`, which describe search terms rather than invoked operations. Keep
  // this semantic signal ahead of keyword-based write detection; shell/execute
  // tools still go through the conservative command parser below.
  if (["read", "search"].includes(safeText(tool.kind).trim().toLowerCase())) return "read-only";
  // Codex does not request approval for read-only terminal inspection. Parse a
  // conservative shell subset and require every command in a compound script
  // to be read-only. This covers real sed/git/find/for/if inspection flows but
  // rejects redirects, substitution, interpreters and any unknown executable.
  if (isReadOnlyShellCommand(shellCommandForTool(tool))) return "read-only";
  if (/\b(delete|remove|unlink|rm\b|force[- ]?push|deploy|publish|release|send|message|email|post|payment|purchase)\b|(?:^|\s)>\s*/.test(descriptor)) {
    return "non-idempotent";
  }
  if (/\b(write|edit|patch|apply|create|mkdir|move|rename|copy|execute|exec|shell|bash|terminal|command)\b/.test(descriptor)) {
    return "non-idempotent";
  }
  if (/^\s*(?:read|grep|glob|search|list|stat|inspect|view|query|fetch|get|head|tail|pwd|ls|cat)\b/.test(descriptor)) return "read-only";
  return "unknown";
}

function receiptFor(status) {
  return TERMINAL.get(status) ?? "unknown";
}

function collect(snapshot) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events.slice(-5_000) : [];
  const ignoredToolCallIds = new Set(events.map(taskControlToolCallId).filter(Boolean));
  const latest = new Map();
  for (const event of events) {
    const tool = eventTool(event, ignoredToolCallIds);
    if (!tool) continue;
    const previous = latest.get(tool.toolCallId);
    latest.set(tool.toolCallId, {
      ...previous,
      ...tool,
      operation: tool.operation || previous?.operation || "Provider tool",
      kind: tool.kind || previous?.kind || "",
      input: tool.input || previous?.input || "",
      output: tool.output || previous?.output || "",
      // A pending card may be emitted before the blocking permission hook and
      // a terminal update after execution. Receipt time belongs to the latest
      // observed update, never the first pending announcement; otherwise the
      // durable audit can claim a receipt predates its pre-execute intent.
      at: tool.at ?? previous?.at,
    });
  }
  return [...latest.values()];
}

function declinedToolCallIds(snapshot) {
  return new Set((Array.isArray(snapshot?.events) ? snapshot.events : [])
    .filter((event) => event?.type === "task_permission_decision" && event?.decision === "decline")
    .map((event) => safeText(event.toolCallId).trim().slice(0, 240))
    .filter(Boolean));
}

export function unsafeUnknownSideEffects(run, attemptIds = null) {
  const selected = attemptIds ? new Set(attemptIds) : null;
  return run.sideEffects.filter((sideEffect) => (
    (!selected || selected.has(sideEffect.attemptId))
    && sideEffect.receiptStatus === "unknown"
    // Historical rows keep their original audit classification immutable, but
    // retry/recovery safety may apply a newer, stricter proof that the recorded
    // operation was read-only.  Only downgrade to read-only; never upgrade an
    // unknown historical operation into something replayable.
    && classifySideEffect(sideEffect) !== "read-only"
    && (sideEffect.idempotency === "non-idempotent" || sideEffect.idempotency === "unknown")
  ));
}

export function untrustedObservedSideEffects(run, attemptIds = null) {
  const selected = attemptIds ? new Set(attemptIds) : null;
  return run.sideEffects.filter((sideEffect) => (
    (!selected || selected.has(sideEffect.attemptId))
    && sideEffect.intentSource !== "pre-execute"
    && sideEffect.receiptStatus !== "not-started"
    && classifySideEffect(sideEffect) !== "read-only"
    && sideEffect.idempotency !== "read-only"
  ));
}

export function createSideEffectController({ store, serialized, now, createId }) {
  async function recordIntent(taskId, taskRunId, attemptId, leaseId, input = {}) {
    const tool = {
      toolCallId: safeText(input.toolCallId ?? input.id).trim().slice(0, 240),
      operation: redactSensitiveText(input.operation ?? input.title ?? input.method ?? "Provider operation", 240).trim() || "Provider operation",
      kind: safeText(input.kind ?? "").trim(),
      input: safeStructuredText(input.input ?? input.params ?? input),
    };
    if (!tool.toolCallId) throw new Error("Provider side-effect intent requires a stable tool call id");
    const idempotency = classifySideEffect(tool);
    if (idempotency === "read-only") return { recorded: false, idempotency };
    return serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = findAttempt(run, attemptId);
      if (!attempt || attempt.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) {
        throw new Error("Provider side-effect intent lost its active attempt lease");
      }
      const existing = run.sideEffects.find((candidate) => candidate.attemptId === attemptId && candidate.toolCallId === tool.toolCallId);
      if (existing) {
        if (existing.intentSource === "pre-execute") {
          return { recorded: true, idempotency: existing.idempotency, sideEffectId: existing.id };
        }
        throw new Error("Provider side-effect was observed without a durable pre-execute intent");
      }
      const record = {
        id: createId("effect"),
        attemptId,
        turnId: attempt.turnId ?? null,
        toolCallId: tool.toolCallId,
        operation: tool.operation,
        idempotency,
        intentHash: sha256(redactSensitiveText(tool.input, 24_000)),
        intentAt: now(),
        intentSource: "pre-execute",
        receiptStatus: "unknown",
        receiptAt: null,
        resultHash: null,
      };
      run.sideEffects.push(record);
      run.updatedAt = now();
      await store.writeRun(run);
      return { recorded: true, idempotency, sideEffectId: record.id };
    });
  }

  async function synchronize(taskId, taskRunId, attemptId, leaseId, snapshot) {
    const observed = collect(snapshot);
    if (!observed.length) return;
    const declined = declinedToolCallIds(snapshot);
    const snapshotTerminal = TERMINAL_RUN_STATUSES.has(safeText(snapshot?.status).trim().toLowerCase());
    await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = findAttempt(run, attemptId);
      if (!attempt || attempt.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return;
      let changed = false;
      for (const tool of observed) {
        let record = run.sideEffects.find((candidate) => (
          candidate.attemptId === attemptId && candidate.toolCallId === tool.toolCallId
        ));
        const terminalReceipt = receiptFor(tool.status);
        // A matching decline proves that a failed/cancelled card never crossed
        // the ACP permission boundary. It must not excuse a provider that
        // reports the same tool as completed despite the decline.
        const wasDeclined = declined.has(tool.toolCallId) && terminalReceipt !== "completed";
        const receiptStatus = wasDeclined ? "not-started" : terminalReceipt;
        const receiptAt = receiptStatus === "unknown" ? null : (tool.at ?? now());
        const resultHash = receiptStatus === "unknown" ? null : sha256(redactSensitiveText(tool.output, 24_000));
        if (!record) {
          // ACP adapters may announce a pending tool card before invoking the
          // blocking permission/intent hook. Give that hook a chance to persist
          // the durable pre-execute record. If the provider itself becomes
          // terminal with no intent, preserve the observation and fail closed.
          if (receiptStatus === "unknown" && !snapshotTerminal) continue;
          record = {
            id: createId("effect"),
            attemptId,
            turnId: attempt.turnId ?? null,
            toolCallId: tool.toolCallId,
            operation: tool.operation,
            idempotency: classifySideEffect(tool),
            intentHash: sha256(redactSensitiveText(tool.input, 24_000)),
            intentAt: tool.at ?? now(),
            intentSource: "observed-terminal",
            receiptStatus,
            receiptAt,
            resultHash,
          };
          run.sideEffects.push(record);
          changed = true;
          continue;
        }
        if (receiptStatus !== "unknown" && record.receiptStatus !== receiptStatus) {
          record.receiptStatus = receiptStatus;
          record.receiptAt = receiptAt;
          record.resultHash = resultHash;
          changed = true;
        }
      }
      if (!changed) return;
      run.updatedAt = now();
      await store.writeRun(run);
    });
  }
  return { recordIntent, synchronize };
}

export function createSideEffectSynchronizer(options) {
  return createSideEffectController(options).synchronize;
}
