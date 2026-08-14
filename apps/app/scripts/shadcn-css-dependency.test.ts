import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");

test("index.css imports shadcn/tailwind.css and the package is declared so Vite can resolve it", () => {
  const css = readFileSync(resolve(appRoot, "src/app/index.css"), "utf8");
  expect(css).toContain('@import "shadcn/tailwind.css"');

  const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared =
    packageJson.dependencies?.shadcn ?? packageJson.devDependencies?.shadcn;
  expect(declared, "shadcn must stay installed while index.css imports shadcn/tailwind.css").toBeTruthy();
  expect(packageJson.dependencies?.shadcn).toBeUndefined();

  const require = createRequire(resolve(appRoot, "package.json"));
  const cssPath = require.resolve("shadcn/tailwind.css");
  expect(existsSync(cssPath), `expected ${cssPath}`).toBe(true);
});
