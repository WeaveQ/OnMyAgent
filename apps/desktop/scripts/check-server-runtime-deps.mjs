// Smoke gate for the packaged embedded server: every bare (non-relative)
// module specifier statically imported/required by apps/desktop/server/dist
// must resolve against the staged apps/desktop/server/node_modules.
//
// This is the guard that prevents a repeat of the "Cannot find package
// 'jsonc-parser' imported from .../app.asar/server/dist/core/jsonc.js" boot
// crash: tsc emits bare ESM imports and the desktop build must ship the
// matching production dependencies (see pnpm deploy in electron-build.mjs).
//
// Run after electron-build.mjs has staged apps/desktop/server. Node's own
// resolver is the authority — we use import.meta.resolve against a file URL
// inside the staged dist so the exact packaged layout is exercised.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = process.env.ONMYAGENT_DESKTOP_ROOT
  ? resolve(process.env.ONMYAGENT_DESKTOP_ROOT)
  : resolve(__dirname, "..");
const packagedServerRoot = resolve(desktopRoot, "server");
const serverDistDir = resolve(packagedServerRoot, "dist");

// Built-ins (and the Bun-only sqlite alias) are provided by the runtime, not
// by node_modules. The embedded server dynamically requires sqlite with a
// node:sqlite / bun:sqlite fallback chain, so neither is a packaging failure.
const BUILTIN_PREFIXES = ["node:", "bun:"];
const isBuiltin = (spec) =>
  spec.startsWith("node:") ||
  spec.startsWith("bun:") ||
  ["assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns",
   "domain", "events", "fs", "http", "http2", "https", "net", "os", "path",
   "perf_hooks", "process", "punycode", "querystring", "readline", "stream",
   "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm",
   "wasi", "worker_threads", "zlib"].includes(spec);

if (!existsSync(serverDistDir) || !statSync(serverDistDir).isDirectory()) {
  console.error(
    `[check-server-runtime-deps] Missing ${serverDistDir}. ` +
      "Run pnpm --filter @onmyagent/desktop build first.",
  );
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

// Strip comments and template literals before scanning. We deliberately keep
// single- and double-quoted strings because import/export specifiers are
// themselves string literals. Generated plugin source is emitted via array
// literals (indented string lines) or backtick templates — both are excluded:
// backtick strings are removed here, and indented quote-lines are filtered by
// the line-start anchor in SPECIFIER_RE.
function stripNonCode(source) {
  let out = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  let result = "";
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === "`") {
      i += 1;
      while (i < out.length && out[i] !== "`") {
        if (out[i] === "\\") i += 1;
        i += 1;
      }
    } else {
      result += out[i];
    }
  }
  return result;
}

function collectBareSpecifiers(file) {
  const source = stripNonCode(readFileSync(file, "utf8"));
  const specs = new Set();
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    // Skip string-literal lines emitted as data (generated plugin source
    // arrays): they are themselves a quoted string, e.g.
    //   'import { tool } from "@opencode-ai/plugin"',
    if (
      (line.startsWith("'") || line.startsWith('"') || line.startsWith("`"))
    ) {
      continue;
    }
    for (const match of line.matchAll(SPECIFIER_RE)) {
      const spec = match[1] || match[2] || match[3];
      if (
        !spec ||
        spec.startsWith(".") ||
        spec.startsWith("/") ||
        isBuiltin(spec)
      ) {
        continue;
      }
      specs.add(spec);
    }
  }
  return specs;
}

// Matches, within a single code line: ESM import/export ... from "x",
// dynamic import("x"), and CJS require("x"). Only group 2/3/4 carry specs.
const SPECIFIER_RE =
  /(?:(?:import|export)\s+(?:[^"'\n;]*?\sfrom\s+)?["']([^"']+)["'])|(?:import\(\s*["']([^"']+)["']\s*\))|(?:require\(\s*["']([^"']+)["']\s*\))/g;

// Resolve a bare specifier the way Node will at runtime, anchored to the
// staged dist directory. require.resolve covers CJS deps; createRequire with a
// dummy path inside server/dist/ ensures node_modules walks upward from the
// staged location (not from this script's source checkout).
const requireAnchor = join(serverDistDir, "__resolver_anchor__.cjs");
const requireFromStaged = createRequire(requireAnchor);
function resolvableFromStaged(spec) {
  try {
    requireFromStaged.resolve(spec);
    return true;
  } catch {
    return importResolvableFromStaged.has(spec);
  }
}

const files = walk(serverDistDir);
const allSpecs = new Map();
for (const file of files) {
  for (const spec of collectBareSpecifiers(file)) {
    if (!allSpecs.has(spec)) allSpecs.set(spec, new Set());
    allSpecs.get(spec).add(file.replace(packagedServerRoot + "/", ""));
  }
}

// createRequire.resolve uses the `require` export condition, so it rejects
// valid ESM-only packages such as @opencode-ai/sdk/v2/client. Run one inert
// import.meta.resolve probe with cwd anchored inside the staged dist. For an
// eval module Node uses cwd as the parent URL, which exercises the packaged
// node_modules tree without importing or executing dependency code.
const importProbe = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    `const specs=${JSON.stringify([...allSpecs.keys()])};const ok=[];for(const spec of specs){try{import.meta.resolve(spec);ok.push(spec)}catch{}}process.stdout.write(JSON.stringify(ok))`,
  ],
  { cwd: serverDistDir, encoding: "utf8" },
);
const importResolvableFromStaged = new Set(
  importProbe.status === 0
    ? JSON.parse(importProbe.stdout || "[]")
    : [],
);

const missing = [];
for (const spec of [...allSpecs.keys()].sort()) {
  if (!resolvableFromStaged(spec)) {
    missing.push({ spec, usedIn: [...allSpecs.get(spec)].sort() });
  }
}

if (missing.length > 0) {
  console.error(
    "[check-server-runtime-deps] Packaged server has bare imports that do not " +
      "resolve against apps/desktop/server/node_modules:",
  );
  for (const { spec, usedIn } of missing) {
    console.error(`  - ${spec}`);
    for (const file of usedIn.slice(0, 5)) {
      console.error(`      used by ${file}`);
    }
  }
  console.error(
    "\nFix: declare the dependency in apps/server/package.json and ensure " +
      "electron-build.mjs stages it (pnpm deploy --prod). This gate prevents " +
      "the packaged 'Cannot find package' boot crash.",
  );
  process.exit(1);
}

console.log(
  `[check-server-runtime-deps] OK — ${allSpecs.size} bare specifier(s) in ` +
    `${files.length} dist file(s) all resolve against staged node_modules:`,
);
for (const spec of [...allSpecs.keys()].sort()) {
  console.log(`  - ${spec}`);
}
