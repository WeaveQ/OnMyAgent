import os from "node:os";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { fileViewerRenderers } from "@file-viewer/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const portValue = Number.parseInt(process.env.PORT ?? "", 10);
const devPort = Number.isFinite(portValue) && portValue > 0 ? portValue : 5173;
const allowedHosts = new Set<string>();
const envAllowedHosts = process.env.VITE_ALLOWED_HOSTS ?? "";

const addHost = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return;
  allowedHosts.add(trimmed);
};

envAllowedHosts.split(",").forEach(addHost);
addHost(process.env.ONMYAGENT_PUBLIC_HOST ?? null);
const hostname = os.hostname();
addHost(hostname);
const shortHostname = hostname.split(".")[0];
if (shortHostname && shortHostname !== hostname) {
  addHost(shortHostname);
}
const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(appRoot, "../..");
const appPackagePath = resolve(appRoot, "package.json");
const desktopPackagePath = resolve(appRoot, "..", "desktop", "package.json");
const marketplaceResourcesRoot = resolve(repoRoot, "apps/desktop/resources/marketplace");
const marketplaceManifestScript = resolve(appRoot, "scripts/generate-marketplace-manifests.mjs");
const fileViewerDevAssetsRoot = resolve(repoRoot, ".loop/runtime/file-viewer-assets");

function readPackageVersion(packagePath: string): string | null {
  if (!existsSync(packagePath)) return null;

  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return parsed.version?.trim() || null;
}

const buildAppVersion =
  process.env.VITE_ONMYAGENT_APP_VERSION?.trim() ||
  readPackageVersion(desktopPackagePath) ||
  readPackageVersion(appPackagePath) ||
  "0.0.0";

// Electron packaged builds load index.html via `file://`, so asset URLs
// must be relative.
const isElectronPackagedBuild = process.env.ONMYAGENT_ELECTRON_BUILD === "1";

type BabelPluginApi = {
  types: {
    jsxAttribute: (name: unknown, value: unknown) => unknown;
    jsxIdentifier: (name: string) => unknown;
    stringLiteral: (value: string) => unknown;
  };
};

type JsxOpeningElementPath = {
  node: {
    name?: { type?: string; name?: string };
    attributes: unknown[];
    loc?: { start?: { line?: number } };
  };
};

type BabelPluginState = {
  filename?: string;
};

function onmyagentDevSourceBabelPlugin(api: BabelPluginApi) {
  const sourceRoot = appRoot.replace(/\\/g, "/");
  return {
    name: "onmyagent-dev-source-attributes",
    visitor: {
      JSXOpeningElement(path: JsxOpeningElementPath, state: BabelPluginState) {
        const elementName = path.node.name;
        if (elementName?.type !== "JSXIdentifier" || !elementName.name?.match(/^[a-z]/)) return;
        if (
          path.node.attributes.some((attribute) => {
            const candidate = attribute as { name?: { name?: string } };
            return candidate.name?.name === "data-oma-source";
          })
        ) return;
        const filename = state.filename?.replace(/\\/g, "/");
        if (!filename || filename.includes("node_modules")) return;
        const relativePath = filename.startsWith(`${sourceRoot}/`)
          ? filename.slice(sourceRoot.length + 1)
          : filename;
        const line = path.node.loc?.start?.line ?? 1;
        path.node.attributes.push(
          api.types.jsxAttribute(
            api.types.jsxIdentifier("data-oma-source"),
            api.types.stringLiteral(`${relativePath}:${line}`),
          ),
        );
      },
    },
  };
}

function generateMarketplaceManifests() {
  const result = spawnSync(process.execPath, [marketplaceManifestScript], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status === 0) return;
  const message = result.stderr.trim() || result.stdout.trim();
  throw new Error(
    message
      ? `Failed to generate marketplace manifests: ${message}`
      : "Failed to generate marketplace manifests",
  );
}

export default defineConfig({
  base: isElectronPackagedBuild ? "./" : "/",
  define: {
    "import.meta.env.VITE_ONMYAGENT_APP_VERSION": JSON.stringify(buildAppVersion),
  },
  plugins: [
    {
      name: "onmyagent-marketplace-manifests",
      buildStart() {
        generateMarketplaceManifests();
      },
      configureServer(server) {
        server.watcher.add(marketplaceResourcesRoot);
        server.watcher.on("all", (_event, changedPath) => {
          if (!changedPath.startsWith(marketplaceResourcesRoot)) return;
          generateMarketplaceManifests();
        });
      },
    },
    {
      name: "onmyagent-dev-server-id",
      configureServer(server) {
        server.middlewares.use("/__onmyagent_dev_server_id", (_req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ appRoot }));
        });
      },
    },
    // Prevent Electron/Chromium from caching optimize-deps chunks across
    // re-optimizes (stale chunk-*.js imports → permanent blank renderer).
    {
      name: "onmyagent-dev-no-store-optimize-deps",
      configureServer(server) {
        if (process.env.ONMYAGENT_DEV_MODE !== "1") return;
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (
            url.includes("/node_modules/.vite/deps/") ||
            url.startsWith("/@vite/") ||
            url.startsWith("/@fs/") ||
            url.startsWith("/@id/")
          ) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            res.setHeader("Pragma", "no-cache");
          }
          next();
        });
      },
    },
    fileViewerRenderers({
      formats: ["doc", "docx", "rtf", "odt", "xls", "xlsx", "ods", "ppt", "pptx", "odp"],
      inject: false,
      copyAssets: {
        publicDir: fileViewerDevAssetsRoot,
        mode: "both",
      },
    }),
    tailwindcss(),
    react({
      babel: {
        plugins: [
          ...(process.env.ONMYAGENT_DEV_MODE === "1" ? [onmyagentDevSourceBabelPlugin] : []),
          ["babel-plugin-react-compiler", { compilationMode: "annotation" }],
        ],
      },
    }),
  ],
  server: {
    port: devPort,
    strictPort: true,
    ...(allowedHosts.size > 0 ? { allowedHosts: Array.from(allowedHosts) } : {}),
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        app: resolve(appRoot, "index.html"),
        overlay: resolve(appRoot, "overlay.html"),
        officeViewer: resolve(appRoot, "office-viewer.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(appRoot, "src"),
    },
  },
});
