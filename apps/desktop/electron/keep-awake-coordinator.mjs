/**
 * Main-process keep-awake aggregation.
 *
 * The renderer owns the user's preference and interactive-session activity,
 * while the detached Task Supervisor owns durable task activity.  Keeping the
 * aggregate in Electron main means a hidden/reloaded renderer cannot
 * accidentally release the blocker while a Task Center run is still active.
 */
export function createKeepAwakeCoordinator(options = {}) {
  const powerSaveBlocker = options.powerSaveBlocker;
  if (!powerSaveBlocker?.start || !powerSaveBlocker?.stop || !powerSaveBlocker?.isStarted) {
    throw new Error("powerSaveBlocker is required");
  }
  const blockerType = String(options.blockerType ?? "prevent-app-suspension");
  let blockerId = null;
  let preferenceEnabled = false;
  let interactiveBusy = false;
  let taskCenterBusy = false;
  let lastError = null;

  function shouldBlock() {
    return preferenceEnabled && (interactiveBusy || taskCenterBusy);
  }

  function apply() {
    try {
      if (shouldBlock()) {
        if (blockerId == null || !powerSaveBlocker.isStarted(blockerId)) {
          blockerId = powerSaveBlocker.start(blockerType);
        }
      } else if (blockerId != null) {
        if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
        blockerId = null;
      }
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      blockerId = null;
    }
    return status();
  }

  function status() {
    const enabled = blockerId != null && powerSaveBlocker.isStarted(blockerId);
    return {
      enabled,
      id: enabled ? blockerId : null,
      blockerType,
      preferenceEnabled,
      interactiveBusy,
      taskCenterBusy,
      ...(lastError ? { error: lastError } : {}),
    };
  }

  return {
    setRendererState(input = {}) {
      preferenceEnabled = input.preferenceEnabled === true;
      interactiveBusy = input.interactiveBusy === true;
      return apply();
    },
    setTaskCenterBusy(active) {
      taskCenterBusy = active === true;
      return apply();
    },
    status,
    dispose() {
      preferenceEnabled = false;
      interactiveBusy = false;
      taskCenterBusy = false;
      return apply();
    },
  };
}
