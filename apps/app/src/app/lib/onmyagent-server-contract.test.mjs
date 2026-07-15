import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "../../../../../packages/types/node_modules/typescript/lib/typescript.js";

import {
  serverClientMethodGroups,
  serverClientMethodNames,
} from "../../../../../packages/types/src/server-client-methods.mjs";

const clientUrl = new URL("./onmyagent-server/client.ts", import.meta.url);

function clientMethodNames(source) {
  const file = ts.createSourceFile("client.ts", source, ts.ScriptTarget.Latest, true);
  let result = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node)
      && node.name?.text === "createOnMyAgentServerClient"
    ) {
      const returned = node.body?.statements.find(ts.isReturnStatement)?.expression;
      if (returned && ts.isObjectLiteralExpression(returned)) {
        result = returned.properties.flatMap((property) => {
          if (!property.name) return [];
          if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
            return [property.name.text];
          }
          return [];
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

test("server client methods are assigned to exactly one domain", () => {
  const grouped = Object.values(serverClientMethodGroups).flat();
  assert.deepEqual(grouped, serverClientMethodNames);
  assert.equal(new Set(grouped).size, grouped.length);
});

test("shared HTTP client contract has exact parity with the implementation", async () => {
  const source = await readFile(clientUrl, "utf8");
  assert.deepEqual(clientMethodNames(source).sort(), [...serverClientMethodNames].sort());
});
