/**
 * Whether the session surface may offer a live Pi engine switch.
 * Events, abort, and session get must all be routed; a 501 OpenCode
 * proxy on those paths keeps the switcher off.
 */
export function shouldEnablePiEngineSwitcher(input: {
  hasEngineEventSse: boolean;
  hasEngineAbortRoute: boolean;
  hasPiReadWorkspaceSession: boolean;
  piOpencodeProxyReturns501: boolean;
}): boolean {
  if (input.piOpencodeProxyReturns501) return false;
  return (
    input.hasEngineEventSse &&
    input.hasEngineAbortRoute &&
    input.hasPiReadWorkspaceSession
  );
}
