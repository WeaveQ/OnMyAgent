import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type DataDirFlags = Map<string, string | boolean>;

type ReadFlag = (flags: DataDirFlags, key: string) => string | undefined;

export function resolveRouterDataDir(
  flags: DataDirFlags,
  readFlag: ReadFlag,
): string {
  const override = readFlag(flags, "data-dir") ?? process.env.ONMYAGENT_DATA_DIR;
  if (override && override.trim()) {
    return resolve(override.trim());
  }
  return join(homedir(), ".onmyagent", "onmyagent-orchestrator");
}
