// Unit tests for recent-workspaces LRU helpers.
// Run with: node --test apps/app/scripts/local-agent-recent-workspaces.test.mjs
// (Node 24 strips TS types natively, so the .ts source is imported directly.)
import { test } from "node:test";
import assert from "node:assert/strict";

// Shim a minimal window.localStorage so the module exercises its real storage path.
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

const KEY = "test:recent-workspaces";

// Reset storage + define window before importing the module under test.
const storage = new MemoryStorage();
globalThis.window = { localStorage: storage };

const {
  RECENT_WORKSPACES_KEY,
  getRecentWorkspaces,
  addRecentWorkspace,
  removeRecentWorkspace,
} = await import("../src/react-app/domains/local-agents/workspace-picker/recent-workspaces.ts");

test("addRecentWorkspace prepends and caps at 5", () => {
  storage.map.clear();
  for (const n of ["a", "b", "c", "d", "e", "f", "g"]) {
    addRecentWorkspace(n, KEY);
  }
  const list = getRecentWorkspaces(KEY);
  assert.equal(list.length, 5);
  // most recently added first
  assert.deepEqual(list, ["g", "f", "e", "d", "c"]);
});

test("addRecentWorkspace dedupes and moves existing to front", () => {
  storage.map.clear();
  addRecentWorkspace("a", KEY);
  addRecentWorkspace("b", KEY);
  addRecentWorkspace("c", KEY);
  addRecentWorkspace("a", KEY); // re-add "a" moves it to front
  const list = getRecentWorkspaces(KEY);
  assert.deepEqual(list, ["a", "c", "b"]);
});

test("empty string is never stored", () => {
  storage.map.clear();
  const result = addRecentWorkspace("   ", KEY);
  assert.deepEqual(result, []);
  assert.equal(getRecentWorkspaces(KEY).length, 0);
});

test("removeRecentWorkspace drops a path", () => {
  storage.map.clear();
  addRecentWorkspace("a", KEY);
  addRecentWorkspace("b", KEY);
  const next = removeRecentWorkspace("a", KEY);
  assert.deepEqual(next, ["b"]);
});

test("getRecentWorkspaces tolerates corrupt json", () => {
  storage.map.clear();
  storage.setItem(KEY, "not-json");
  assert.deepEqual(getRecentWorkspaces(KEY), []);
});

test("getRecentWorkspaces ignores non-string entries and trims", () => {
  storage.map.clear();
  storage.setItem(KEY, JSON.stringify([" a ", 123, null, "b"]));
  assert.deepEqual(getRecentWorkspaces(KEY), ["a", "b"]);
});
