#!/usr/bin/env node
/**
 * Ensures ARCHITECTURE.md-referenced top-level domain dirs exist, and that
 * product modules live under their owner domains (not only as shared shims).
 * Run: node scripts/checks/architecture-paths.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const domains = join(root, "apps/app/src/react-app/domains");
const designSystem = join(root, "apps/app/src/react-app/design-system");
const shell = join(root, "apps/app/src/react-app/shell");

const requiredDirs = [
  "session",
  "settings",
  "workspace",
  "connections",
  "agents",
  "local-agents",
  "cloud",
  "shared",
  "shell-feedback",
  "plugins",
];

const requiredFiles = [
  join(domains, "agents/agent-registry-store.ts"),
  join(domains, "agents/pending-agent-store.ts"),
  join(domains, "connections/provider-auth-modal.tsx"),
  join(domains, "connections/provider-list-query.ts"),
  join(domains, "connections/add-mcp-modal.tsx"),
  join(domains, "plugins/plugins-page.tsx"),
  join(domains, "shell-feedback/status-toasts.tsx"),
  join(domains, "workspace/share-workspace-modal.tsx"),
  join(designSystem, "modal-styles.ts"),
  join(shell, "session-route.tsx"),
  join(shell, "session-route-render.tsx"),
  join(shell, "settings-route.tsx"),
  join(shell, "settings-route-render.tsx"),
];

const missingDirs = requiredDirs.filter((name) => !existsSync(join(domains, name)));
const missingFiles = requiredFiles.filter((p) => !existsSync(p));

// Thin route entry guard: session-route / settings-route should stay small
function lineCount(file) {
  return readFileSync(file, "utf8").split("\n").length;
}
const thinRoutes = [
  join(shell, "session-route.tsx"),
  join(shell, "settings-route.tsx"),
];
const fatEntries = thinRoutes.filter((p) => existsSync(p) && lineCount(p) > 80);

if (missingDirs.length || missingFiles.length || fatEntries.length) {
  if (missingDirs.length) console.error("[architecture-paths] missing dirs:", missingDirs.join(", "));
  if (missingFiles.length) console.error("[architecture-paths] missing files:", missingFiles.map((p) => p.replace(root + "/", "")).join(", "));
  if (fatEntries.length) console.error("[architecture-paths] route entry too large (>80 lines):", fatEntries.map((p) => p.replace(root + "/", "")).join(", "));
  process.exit(1);
}
console.log("[architecture-paths] ok — domains, owner files, thin route entries");
