/**
 * Typed Desktop IPC invoke helpers for the renderer.
 *
 * `invokeDesktopCommand` is map-backed via `DesktopCommandMap` so args/result
 * stay aligned with `@onmyagent/types`. Prefer it over ad-hoc casts.
 */
import type {
  DesktopCommandMap,
  DesktopCommandName,
  DesktopInvoke,
} from "@onmyagent/types/desktop-ipc";

export type {
  DesktopCommandMap,
  DesktopCommandName,
  DesktopCommandArgsOf,
  DesktopCommandResultOf,
  DesktopInvoke,
} from "@onmyagent/types/desktop-ipc";

/** Untyped-compatible helper; prefer `invokeDesktopCommand` for map-backed typing. */
export async function invokeElectronHelper<T>(
  command: DesktopCommandName,
  ...args: unknown[]
): Promise<T> {
  const invokeDesktop = window.__ONMYAGENT_ELECTRON__?.invokeDesktop as
    | DesktopInvoke
    | undefined;
  if (!invokeDesktop) {
    throw new Error(`Electron desktop helper is unavailable: ${command}`);
  }
  return (await invokeDesktop(command, ...(args as never[]))) as T;
}

/** Map-backed typed invoke for renderer call sites and public wrappers. */
export async function invokeDesktopCommand<C extends DesktopCommandName>(
  command: C,
  ...args: DesktopCommandMap[C]["args"]
): Promise<DesktopCommandMap[C]["result"]> {
  return invokeElectronHelper(command, ...args);
}
