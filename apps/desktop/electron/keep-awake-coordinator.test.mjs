import assert from "node:assert/strict";
import test from "node:test";

import { createKeepAwakeCoordinator } from "./keep-awake-coordinator.mjs";

function fakePowerSaveBlocker() {
  let nextId = 1;
  const active = new Map();
  const starts = [];
  return {
    starts,
    start(type) {
      const id = nextId++;
      active.set(id, type);
      starts.push({ id, type });
      return id;
    },
    stop(id) { return active.delete(id); },
    isStarted(id) { return active.has(id); },
  };
}

test("aggregates interactive and Task Center activity in Electron main", () => {
  const blocker = fakePowerSaveBlocker();
  const coordinator = createKeepAwakeCoordinator({ powerSaveBlocker: blocker });

  assert.equal(coordinator.setRendererState({ preferenceEnabled: true, interactiveBusy: false }).enabled, false);
  const taskActive = coordinator.setTaskCenterBusy(true);
  assert.equal(taskActive.enabled, true);
  assert.equal(taskActive.taskCenterBusy, true);
  assert.equal(blocker.starts[0].type, "prevent-app-suspension");

  // A renderer reload/session-idle update must not release a durable task.
  assert.equal(coordinator.setRendererState({ preferenceEnabled: true, interactiveBusy: false }).enabled, true);
  assert.equal(coordinator.setTaskCenterBusy(false).enabled, false);
});

test("preference off always releases the blocker without losing task activity", () => {
  const blocker = fakePowerSaveBlocker();
  const coordinator = createKeepAwakeCoordinator({ powerSaveBlocker: blocker });
  coordinator.setTaskCenterBusy(true);
  assert.equal(coordinator.setRendererState({ preferenceEnabled: true, interactiveBusy: false }).enabled, true);
  const disabled = coordinator.setRendererState({ preferenceEnabled: false, interactiveBusy: true });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.taskCenterBusy, true);
});

test("uses one blocker for overlapping activity sources and disposes it", () => {
  const blocker = fakePowerSaveBlocker();
  const coordinator = createKeepAwakeCoordinator({ powerSaveBlocker: blocker });
  coordinator.setRendererState({ preferenceEnabled: true, interactiveBusy: true });
  coordinator.setTaskCenterBusy(true);
  assert.equal(blocker.starts.length, 1);
  assert.equal(coordinator.setRendererState({ preferenceEnabled: true, interactiveBusy: false }).enabled, true);
  assert.equal(coordinator.dispose().enabled, false);
});
