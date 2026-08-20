/**
 * Compatibility entrypoint for legacy renderer imports.
 *
 * The shared desktop IPC package is the only wire-contract source of truth;
 * keeping this file as a type-only re-export prevents a second compile-time
 * contract from drifting behind Electron/preload implementations.
 */
export type * from "@onmyagent/types/desktop-ipc";
