const OCCLUDER_SELECTOR = [
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-slot="dropdown-menu-content"][data-open]',
].join(",");

export function hasVisibleNativePreviewOccluder(root: ParentNode = document) {
  return [...root.querySelectorAll<HTMLElement>(OCCLUDER_SELECTOR)].some(
    (element) => element.getClientRects().length > 0,
  );
}
