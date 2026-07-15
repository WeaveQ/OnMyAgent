/**
 * Compatibility entrypoint. Desktop wire contracts are owned by
 * @onmyagent/types so Electron and renderer cannot drift independently.
 */
export type * from "@onmyagent/types/desktop-ipc";
