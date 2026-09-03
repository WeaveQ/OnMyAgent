/**
 * DESIGN.md YAML front-matter parser (same shape as extract-tokens).
 */
import { readFileSync } from "node:fs";

export function readFrontMatter(path) {
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error(`No YAML front matter found at ${path}`);
  }
  return match[1];
}

export function parseFrontMatter(yaml) {
  const lines = yaml.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.slice(indent);

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    const listMatch = line.match(/^-\s+(.+)$/);
    if (listMatch) {
      const lastKey = getLastKey(parent);
      if (lastKey === null) continue;
      if (!Array.isArray(parent[lastKey])) parent[lastKey] = [];
      parent[lastKey].push(coerceScalar(listMatch[1]));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const rawValue = kv[2];
    if (rawValue === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else if (rawValue.trim().startsWith("{") && rawValue.trim().includes("}")) {
      const mapSrc = rawValue.trim().match(/^(\{.*\})/);
      parent[key] = parseInlineMap(mapSrc ? mapSrc[1] : rawValue);
    } else {
      parent[key] = coerceScalar(rawValue);
    }
  }
  return root;
}

function getLastKey(obj) {
  const keys = Object.keys(obj);
  return keys.length ? keys[keys.length - 1] : null;
}

function coerceScalar(v) {
  const s = v.trim();
  const quoted = s.match(/^"([^"]*)"/);
  if (quoted) return quoted[1];
  const unquoted = s.replace(/\s+#.*$/, "").trim();
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  if (/^-?\d+$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function parseInlineMap(s) {
  const inner = s.slice(1, -1).trim();
  const out = {};
  for (const pair of splitInlineList(inner)) {
    const [k, ...rest] = pair.split(":");
    out[k.trim()] = coerceScalar(rest.join(":").trim());
  }
  return out;
}

function splitInlineList(s) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      if (ch === ")" || ch === "]" || ch === "}") depth--;
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function loadDesignYaml(designMdPath) {
  return parseFrontMatter(readFrontMatter(designMdPath));
}

export function resolveYamlRef(yaml, value) {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const ref = value.match(/^\{([A-Za-z0-9_.-]+)\}$/);
  if (!ref) return value;
  let cur = yaml;
  for (const part of ref[1].split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}
