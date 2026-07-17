import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const scriptsDir = join(import.meta.dir);

/**
 * Safety net: waitForHealthy(client, { server: NAME }) must bind NAME in-file.
 * Prevents browser-entry-style regressions after spawn-handle renames.
 */
function collectBindings(source: string): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/g,
    /\b(?:const|let|var)\s+\{\s*([^}]+)\s*\}\s*=/g,
    /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source))) {
      const raw = match[1];
      if (raw.includes(",")) {
        for (const part of raw.split(",")) {
          const id = part.trim().split(/\s+as\s+|\s*=\s*/)[0]?.trim();
          if (id && /^[A-Za-z_$]/.test(id)) names.add(id);
        }
      } else if (raw) {
        names.add(raw.trim());
      }
    }
  }
  return names;
}

describe("e2e scripts health binding contract", () => {
  const scriptFiles = readdirSync(scriptsDir).filter((name) => name.endsWith(".mjs"));

  test("every waitForHealthy server: binding resolves in the same file", () => {
    const failures: string[] = [];

    for (const file of scriptFiles) {
      const source = readFileSync(join(scriptsDir, file), "utf8");
      if (!source.includes("waitForHealthy")) continue;
      const bindings = collectBindings(source);

      if (/waitForHealthy\s*\(\s*[^,]+,\s*\{\s*server\s*\}/.test(source)) {
        if (!bindings.has("server")) {
          failures.push(
            `${file}: waitForHealthy(..., { server }) but no 'server' binding`,
          );
        }
      }

      for (const match of source.matchAll(
        /waitForHealthy\s*\(\s*[^,]+,\s*\{\s*server\s*:\s*([A-Za-z_$][\w$]*)\s*\}/g,
      )) {
        const alias = match[1];
        if (!bindings.has(alias)) {
          failures.push(
            `${file}: waitForHealthy(..., { server: ${alias} }) but '${alias}' is not bound`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test("browser-entry binds the spawn handle as opencode for waitForHealthy", () => {
    const source = readFileSync(join(scriptsDir, "browser-entry.mjs"), "utf8");
    expect(source).toContain("opencode = await spawnOpencodeServe");
    expect(source).toContain("waitForHealthy(client, { server: opencode })");
    expect(source).not.toMatch(/waitForHealthy\s*\(\s*client\s*,\s*\{\s*server\s*\}/);
  });
});
