// Barrel: shell-facing API exposed to domains.
//
// Domains must not deep-link into shell/*; they should import from this
// barrel. The `check:boundaries` gate rejects new deep imports and freezes
// the historical ones into `scripts/checks/baselines/domain-shell-depth.json`
// (only shrink, never grow).
export * from "./app-inspector";
export * from "./boot-state";
export * from "./control/control-provider";
export * from "./dev-profiler";
export * from "./dot-ticker";
export * from "./react-render-watchdog";
export * from "./reload-coordinator";
export * from "./ui-state-store";
export * from "./workspace-routes";
export * from "./workspace-shell-layout";
export * from "./new-providers-toast";
export * from "./workspace-provider";
export * from "./font-zoom";
