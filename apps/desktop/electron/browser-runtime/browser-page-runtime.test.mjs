import assert from "node:assert/strict";
import test from "node:test";

import {
  domActionExpression,
  domObservationExpression,
  locatorActionExpression,
  locatorObservationExpression,
} from "./browser-page-runtime.mjs";

test("page runtime expressions encode selectors and values as inert JSON", () => {
  const hostile = `x'); globalThis.pwned = true; ('`;
  const observation = locatorObservationExpression({ text: hostile });
  const action = locatorActionExpression({ label: hostile }, "fill", { value: hostile });
  assert.match(observation, /const selector = \{"text":/);
  assert.match(action, /const selector = \{"label":/);
  assert.equal(action.includes(JSON.stringify(hostile)), true);
  assert.equal(observation.includes("const selector = x');"), false);
  assert.equal(action.includes("const value = x');"), false);
});

test("DOM-CUA expressions use generated page refs without returning live nodes", () => {
  assert.match(domObservationExpression(), /data-onmyagent-dom-ref/);
  assert.match(domActionExpression({ selector: "#button" }, "click", {}), /document\.querySelector/);
});
