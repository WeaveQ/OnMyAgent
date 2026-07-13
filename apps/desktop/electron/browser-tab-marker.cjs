const BROWSER_TAB_ARGUMENT_PREFIX = "--onmyagent-browser-tab-id=";
const BROWSER_TAB_MARKER_PREFIX = "onmyagent-browser:";

function normalizeBrowserTabOwner(value) {
  const ownerId = typeof value === "string" ? value.trim() : "";
  if (!ownerId || ownerId.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(ownerId) ? ownerId : null;
}

function browserTabMarker(tabId) {
  return `${BROWSER_TAB_MARKER_PREFIX}${tabId}`;
}

function browserTabAdditionalArguments(tabId) {
  return [`${BROWSER_TAB_ARGUMENT_PREFIX}${encodeURIComponent(tabId)}`];
}

function browserTabIdFromArgv(argv) {
  const argument = argv.find((entry) =>
    String(entry).startsWith(BROWSER_TAB_ARGUMENT_PREFIX),
  );
  if (!argument) return null;
  const encoded = String(argument).slice(BROWSER_TAB_ARGUMENT_PREFIX.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

module.exports = {
  BROWSER_TAB_ARGUMENT_PREFIX,
  BROWSER_TAB_MARKER_PREFIX,
  browserTabAdditionalArguments,
  browserTabIdFromArgv,
  browserTabMarker,
  normalizeBrowserTabOwner,
};
