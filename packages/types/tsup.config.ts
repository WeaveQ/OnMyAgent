import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "den/desktop-app-restrictions": "src/den/desktop-app-restrictions.ts",
    "den/desktop-policies": "src/den/desktop-policies.ts",
    "den/inference": "src/den/inference.ts",
    server: "src/server.ts",
    "desktop-ipc": "src/desktop-ipc.ts",
    "session-archive": "src/session-archive.ts",
    browser: "src/browser.ts",
    channel: "src/channel.ts",
    "artifact-plugin": "src/artifact-plugin.ts",
  },
  tsconfig: "./tsconfig.json",
  format: ["esm"],
  dts: {
    tsconfig: "./tsconfig.json",
  },
  clean: true,
  target: "es2022",
  platform: "neutral",
  sourcemap: false,
  splitting: false,
  treeshake: true,
  external: ["zod"],
})
