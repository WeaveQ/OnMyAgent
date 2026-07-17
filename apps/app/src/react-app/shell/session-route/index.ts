/**
 * Session-route public facade.
 *
 * Logical public modules (≤5 entrypoints):
 *   1. intent.ts       — intent / URL / panel switching
 *   2. chrome-state.ts — chrome + orchestration hooks barrel
 *   3. composer.ts     — composer runtime wiring
 *   4. render.tsx      — render composition (page-view / modals re-exported)
 *   5. index.ts        — this facade (SessionRoute + control/model/actions)
 *
 * Implementation details remain in sibling files under this folder.
 * Prefer these entrypoints for new shell call sites.
 */

export { SessionRouteRender as SessionRoute, SessionRouteRender } from "./render";
export { SessionRoutePageView } from "./page-view";
export { SessionRouteModals } from "./modals";

export * from "./intent";
export * from "./control";
export * from "./composer";
export * from "./model";
export * from "./sessions";
export * from "./state";
export * from "./storage";
export * from "./workspace-actions";
export * from "./server-actions";
export * from "./created-session-actions";
export * from "./agent-context";
export * from "./model-options";
export * from "./model-picker-events";
export * from "./remote-workspace-actions";
export * from "./chrome-state";
