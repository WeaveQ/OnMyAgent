const noop = async () => undefined;

export function createBrowserLocatorEngine(adapter) {
  if (typeof adapter?.observe !== "function") {
    throw new TypeError("locator observation adapter is required");
  }
  const scrollIntoView = adapter.scrollIntoView ?? noop;
  const waitForStable = adapter.waitForStable ?? noop;
  const hitTest = adapter.hitTest ?? (async (target) => target.hitTarget !== false);
  const authorize = adapter.authorize ?? noop;
  const verify = adapter.verify ?? noop;

  return {
    async act(input) {
      const candidates = await adapter.observe(input.selector);
      if (!Array.isArray(candidates)) throw new Error("locator observation is invalid");
      if (candidates.length !== 1) {
        throw new Error(`locator matched ${candidates.length} elements; expected exactly 1`);
      }
      const target = candidates[0];
      if (target.visible !== true) throw new Error("locator target is not visible");
      if (["fill", "type"].includes(input.action) && target.editable !== true) {
        throw new Error("locator target is not editable");
      }
      await scrollIntoView(target);
      await waitForStable(target);
      if (!(await hitTest(target))) throw new Error("locator target is covered");
      await authorize({
        action: input.action,
        selector: input.selector,
        target,
        value: input.value,
      });
      if (input.action === "click") {
        if (typeof adapter.click !== "function") throw new Error("locator click is unavailable");
        await adapter.click(target);
      } else if (input.action === "fill" || input.action === "type") {
        if (typeof adapter.type !== "function") throw new Error("locator text input is unavailable");
        await adapter.type(target, input.value ?? "", { replace: input.action === "fill" });
      } else {
        if (typeof adapter.action !== "function") throw new Error(`locator action is unavailable: ${input.action}`);
        await adapter.action(target, input.action, input);
      }
      return verify({ target, action: input.action });
    },
  };
}
