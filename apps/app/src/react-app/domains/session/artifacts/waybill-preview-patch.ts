/** Client-side waybill-data.json merge for in-preview field edits. */

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Preview patches are string field values; keep ASCII-only so renderer CJK gate stays clean.
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cargoRows(data: Record<string, unknown>): Record<string, unknown>[] {
  const rows = data.cargo;
  if (!Array.isArray(rows)) return [];
  return rows.filter(isRecord);
}

function setNestedValue(data: Record<string, unknown>, path: string, value: string) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cursor: Record<string, unknown> = data;
  for (const part of parts.slice(0, -1)) {
    const nested = cursor[part];
    if (!isRecord(nested)) {
      const next: Record<string, unknown> = {};
      cursor[part] = next;
      cursor = next;
    } else {
      cursor = nested;
    }
  }
  const leaf = parts[parts.length - 1];
  if (leaf) cursor[leaf] = value;
}

/**
 * Apply a flat `a.b` / `cargo.*` patch from the preview widget onto waybill-data.json.
 * Mirrors apps/desktop/.../generate_waybill.py `apply_patch` for the editable field set.
 */
export function applyWaybillDataPatch(
  input: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = isRecord(input) ? { ...input } : {};
  // Shallow-clone nested objects we mutate so we don't alias the caller's tree.
  for (const [path, raw] of Object.entries(patch)) {
    const pathText = textValue(path);
    if (!pathText || pathText === "document.status" || pathText === "copy.label") continue;
    const value = textValue(raw);

    const indexedCargo = pathText.match(/^cargo\[(\d+)\]\.([A-Za-z]+)$/);
    if (indexedCargo) {
      const index = Number(indexedCargo[1]) - 1;
      const key = indexedCargo[2] ?? "";
      const rows = cargoRows(data).map((row) => ({ ...row }));
      while (rows.length <= index) rows.push({});
      const row = rows[index] ?? {};
      row[key] = value;
      rows[index] = row;
      data.cargo = rows;
      continue;
    }

    if (pathText.startsWith("cargo.")) {
      const key = pathText.slice("cargo.".length);
      const rows = cargoRows(data).map((row) => ({ ...row }));
      if (rows.length === 0) rows.push({});
      const row = rows[0] ?? {};
      if (key === "weightOrVolume") {
        if (value.includes("/")) {
          const [weight = "", volume = ""] = value.split("/", 2).map((part) => part.trim());
          row.weight = weight;
          row.volume = volume;
        } else {
          row.weight = value;
          row.volume = "";
        }
      } else {
        row[key] = value;
      }
      rows[0] = row;
      data.cargo = rows;
      continue;
    }

    setNestedValue(data, pathText, value);
  }
  data.userConfirmed = false;
  return data;
}

export function toWorkspaceRelativePath(
  catalogRoot: string,
  absoluteOrRelative: string,
): string | null {
  const root = catalogRoot.trim().replace(/[/\\]+$/, "").replace(/\\/g, "/");
  const target = absoluteOrRelative.trim().replace(/\\/g, "/");
  if (!target) return null;
  if (!root) return target.replace(/^\.\//, "");
  if (target === root) return "";
  const prefix = `${root}/`;
  if (target.toLowerCase().startsWith(prefix.toLowerCase())) {
    return target.slice(prefix.length);
  }
  if (!target.startsWith("/") && !/^[a-zA-Z]:\//.test(target)) {
    return target.replace(/^\.\//, "");
  }
  return null;
}

/** Prefer session-isolated waybill-data.json, then legacy output/, then root. */
export function waybillDataPathCandidates(input: {
  catalogRoot: string;
  sessionRoot?: string | null;
  sessionDirectory?: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const next = value?.trim().replace(/^\/+/, "");
    if (!next || seen.has(next)) return;
    seen.add(next);
    out.push(next);
  };

  const sessionDir =
    input.sessionDirectory?.trim() || input.sessionRoot?.trim() || "";
  if (sessionDir) {
    const relativeDir = toWorkspaceRelativePath(input.catalogRoot, sessionDir);
    if (relativeDir) {
      push(`${relativeDir}/waybill-data.json`);
      push(`${relativeDir}/output/waybill-data.json`);
    } else if (!sessionDir.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(sessionDir)) {
      push(`${sessionDir.replace(/[/\\]+$/, "")}/waybill-data.json`);
    }
  }

  push("waybill-data.json");
  push("output/waybill-data.json");
  return out;
}
