import { expect, test } from "bun:test";

import { hasVisibleNativePreviewOccluder } from "../src/react-app/capabilities/native-preview-occlusion";

test("detects a visible menu but ignores a hidden menu", () => {
  let rectCount = 1;
  const menu = {
    getClientRects: () => ({ length: rectCount }),
  } as HTMLElement;
  const root = {
    querySelectorAll: (selector: string) =>
      selector.includes('[role="menu"]') ? [menu] : [],
  } as unknown as ParentNode;

  expect(hasVisibleNativePreviewOccluder(root)).toBe(true);
  rectCount = 0;
  expect(hasVisibleNativePreviewOccluder(root)).toBe(false);
});
