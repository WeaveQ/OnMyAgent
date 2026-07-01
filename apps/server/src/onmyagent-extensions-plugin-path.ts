import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function onmyagentExtensionsPreviewPluginPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const extension = basename(here) === "dist" ? "js" : "ts";
  return join(here, "opencode-plugins", `onmyagent-extensions-preview.${extension}`);
}
