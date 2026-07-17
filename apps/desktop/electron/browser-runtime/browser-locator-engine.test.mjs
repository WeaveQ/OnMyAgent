import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserLocatorEngine } from "./browser-locator-engine.mjs";

function candidate(overrides = {}) {
  return {
    nodeId: 7,
    visible: true,
    editable: true,
    stable: true,
    hitTarget: true,
    center: { x: 20, y: 30 },
    ...overrides,
  };
}

test("locator click enforces the observation-to-verification action order", async () => {
  const events = [];
  const engine = createBrowserLocatorEngine({
    observe: async () => { events.push("observe"); return [candidate()]; },
    scrollIntoView: async () => events.push("scroll"),
    waitForStable: async () => events.push("stable"),
    hitTest: async () => { events.push("hit-test"); return true; },
    authorize: async () => events.push("authorize"),
    click: async () => events.push("input"),
    verify: async () => events.push("verify"),
  });

  await engine.act({ selector: { role: "button", name: "Submit" }, action: "click" });

  assert.deepEqual(events, ["observe", "scroll", "stable", "hit-test", "authorize", "input", "verify"]);
});

test("locator rejects non-unique matches before any input", async () => {
  let clicked = false;
  const engine = createBrowserLocatorEngine({
    observe: async () => [candidate(), candidate({ nodeId: 8 })],
    click: async () => { clicked = true; },
  });

  await assert.rejects(
    engine.act({ selector: { text: "Continue" }, action: "click" }),
    /matched 2 elements/i,
  );
  assert.equal(clicked, false);
});

test("locator rejects hidden, non-editable, or covered targets", async () => {
  /** @type {Array<[{ visible?: boolean, editable?: boolean, hitTarget?: boolean }, "click" | "fill", RegExp]>} */
  const cases = [
    [{ visible: false }, "click", /not visible/i],
    [{ editable: false }, "fill", /not editable/i],
    [{ hitTarget: false }, "click", /covered/i],
  ];
  for (const [overrides, action, pattern] of cases) {
    const engine = createBrowserLocatorEngine({
      observe: async () => [candidate(overrides)],
      hitTest: async (target) => target.hitTarget,
    });
    await assert.rejects(
      engine.act({ selector: { label: "Email" }, action, value: "a" }),
      pattern,
    );
  }
});

test("locator authorization runs before consequential input", async () => {
  let clicked = false;
  const engine = createBrowserLocatorEngine({
    observe: async () => [candidate()],
    hitTest: async () => true,
    authorize: async () => { throw new Error("approval denied"); },
    click: async () => { clicked = true; },
  });

  await assert.rejects(
    engine.act({ selector: { role: "button", name: "Purchase" }, action: "click" }),
    /approval denied/i,
  );
  assert.equal(clicked, false);
});
