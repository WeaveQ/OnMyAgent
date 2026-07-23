import { describe, expect, test } from "bun:test";
import { ensureWritable, requireClientScope, scopeRank } from "../src/core/server-scope.js";

describe("server-scope helpers (shipped)", () => {
  test("scopeRank orders viewer < collaborator < owner", () => {
    expect(scopeRank("viewer")).toBeLessThan(scopeRank("collaborator"));
    expect(scopeRank("collaborator")).toBeLessThan(scopeRank("owner"));
  });

  test("ensureWritable throws when read-only", () => {
    expect(() => ensureWritable({ readOnly: true })).toThrow();
    expect(() => ensureWritable({ readOnly: false })).not.toThrow();
  });

  test("requireClientScope rejects insufficient scopes", () => {
    expect(() =>
      requireClientScope(
        { actor: { type: "token", scope: "viewer" } } as never,
        "owner",
      ),
    ).toThrow();
    expect(() =>
      requireClientScope(
        { actor: { type: "token", scope: "owner" } } as never,
        "collaborator",
      ),
    ).not.toThrow();
  });
});
