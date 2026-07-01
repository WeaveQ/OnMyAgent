import { execSync } from "node:child_process";

execSync("pnpm --filter @onmyagent/desktop build", { stdio: "inherit" });
