import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "../../../../../packages/types/node_modules/typescript/lib/typescript.js";

import {
  serverClientMethodGroups,
  serverClientMethodNames,
} from "../../../../../packages/types/src/server-client-methods.mjs";

const clientDir = new URL("./onmyagent-server/", import.meta.url);

/**
 * Collect property names from object literals returned by create*ClientMethods /
 * createOnMyAgentServerClient factories (including object-spread compositions).
 */
function clientMethodNamesFromSource(source, fileName = "client.ts") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names = new Set();

  function collectObjectLiteralKeys(expression) {
    if (!expression) return;
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isSpreadAssignment(property)) {
          // Domain modules are spread into the facade; keys come from those modules.
          continue;
        }
        if (!property.name) continue;
        if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
          names.add(property.name.text);
        }
      }
      return;
    }
    if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
      // createXClientMethods(ctx) — keys are collected when visiting that factory.
      return;
    }
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node)
      && node.name
      && (
        node.name.text === "createOnMyAgentServerClient"
        || /^create\w+ClientMethods$/.test(node.name.text)
      )
    ) {
      const returned = node.body?.statements.find(ts.isReturnStatement)?.expression;
      collectObjectLiteralKeys(returned);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...names];
}

async function collectClientMethodNames() {
  const dirPath = path.dirname(new URL(clientDir.href).pathname);
  // fileURLToPath is safer for spaces; keep simple path from URL for this repo layout
  const { fileURLToPath } = await import("node:url");
  const absoluteDir = fileURLToPath(clientDir);
  const entries = await readdir(absoluteDir);
  const clientFiles = entries.filter(
    (name) => name === "client.ts" || /^client-[\w-]+\.ts$/.test(name),
  );
  const names = new Set();
  for (const name of clientFiles) {
    // Skip pure shared transport/types — no method factories required, but safe to scan
    if (name === "client-shared.ts") continue;
    const source = await readFile(path.join(absoluteDir, name), "utf8");
    for (const method of clientMethodNamesFromSource(source, name)) {
      names.add(method);
    }
  }
  return [...names];
}

test("server client methods are assigned to exactly one domain", () => {
  const grouped = Object.values(serverClientMethodGroups).flat();
  assert.deepEqual(grouped, serverClientMethodNames);
  assert.equal(new Set(grouped).size, grouped.length);
});

test("shared HTTP client contract has exact parity with the implementation", async () => {
  const names = await collectClientMethodNames();
  assert.deepEqual(names.sort(), [...serverClientMethodNames].sort());
});
