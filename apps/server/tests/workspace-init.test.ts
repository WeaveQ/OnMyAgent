import { describe, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_NAME } from "../src/core/brand.js";

import { ensureWorkspaceFiles } from "../src/workspace/workspace-init.js";
import { onmyagentExtensionsPreviewPluginPath } from "../src/onmyagent-extensions-plugin-path.js";

async function withWorkspace(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-workspace-init-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("ensureWorkspaceFiles", () => {
  test("creates default agent with artifact guidance for new workspaces", async () => {
    await withWorkspace(async (root) => {
      const result = await ensureWorkspaceFiles(root, "starter");
      const config = await readFile(join(root, "opencode.jsonc"), "utf8");
      const agent = await readFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      const designSpecTool = await readFile(
        join(root, ".opencode", "tools", "get_design_spec.ts"),
        "utf8",
      );
      const renderVisualTool = await readFile(
        join(root, ".opencode", "tools", "render_visual.ts"),
        "utf8",
      );
      const browserNodeReplTool = await readFile(
        join(root, ".opencode", "tools", "onmyagent_browser_node_repl.ts"),
        "utf8",
      );
      expect(config).toContain('"default_agent": "onmyagent"');
      expect(agent).toContain(`${APP_NAME} Artifacts`);
      expect(agent).toContain("reports/artifact-eval.xlsx");
      expect(agent).toContain("Keep each file-mutation tool call bounded");
      expect(agent).toContain("write a small skeleton first");
      expect(agent).toContain("edit or append in multiple calls");
      expect(agent).toContain(`${APP_NAME} can render safe SVG/HTML fragments`);
      expect(agent).toContain('request `modules: ["chart"]`');
      expect(agent).toContain("pass its workspace-relative path as `file_path`");
      expect(agent).toContain("use responsive Chart.js HTML");
      expect(agent).toContain("Do not read the file back into the tool call");
      expect(designSpecTool).toContain("inline visual design spec");
      expect(designSpecTool).toContain("var(--dls-text-primary)");
      expect(designSpecTool).toContain("Chart module (Chart.js)");
      expect(designSpecTool).toContain("Do not hand-calculate a large chart as SVG");
      expect(designSpecTool).toContain("repeat(N,minmax(0,1fr))");
      expect(designSpecTool).toContain("min-width:0");
      expect(designSpecTool).toContain("white-space:nowrap");
      expect(designSpecTool).toContain("text-overflow:ellipsis");
      expect(designSpecTool).not.toContain("repeat(auto-fit,minmax(150px,1fr))");
      expect(designSpecTool).toContain('tool.schema.enum(["diagram", "mockup", "interactive", "chart", "art"])');
      expect(renderVisualTool).toContain('widget_code: tool.schema.string()');
      expect(renderVisualTool).toContain('file_path: tool.schema.string()');
      expect(renderVisualTool).toContain("Provide exactly one of widget_code or file_path");
      expect(renderVisualTool).toContain("file_path must stay inside the current workspace");
      expect(renderVisualTool).toContain("await realpath(resolve(workspaceRoot, filePath))");
      expect(renderVisualTool).toContain("ALLOWED_SCRIPT_HOSTS");
      expect(renderVisualTool).toContain("script outside the widget CDN allowlist");
      expect(browserNodeReplTool).toContain("context.sessionID");
      expect(browserNodeReplTool).toContain("ONMYAGENT_BROWSER_RPC_ENDPOINT");
      expect(browserNodeReplTool).toContain('method: "getCapability"');
      expect(browserNodeReplTool).toContain('method: "nodeReplWrite"');
      expect(result.reloadReasons.sort()).toEqual(["agents", "commands", "config"]);

      const secondResult = await ensureWorkspaceFiles(root, "starter");
      expect(secondResult).toEqual({ changed: false, reloadReasons: [] });
    });
  });

  test("uses shipped extension preview plugin", async () => {
    const pluginPath = onmyagentExtensionsPreviewPluginPath();
    const plugin = await readFile(pluginPath, "utf8");
    expect(pluginPath).toContain(
      join("opencode-plugins", "onmyagent-extensions-preview.ts"),
    );
    expect(plugin).toContain("onmyagent_extension_call");
  });

  test("does not create workspace extension preview plugin", async () => {
    await withWorkspace(async (root) => {
      await ensureWorkspaceFiles(root, "starter");
      await expect(
        stat(
          join(root, ".opencode", "plugins", "onmyagent-extensions-preview.ts"),
        ),
      ).rejects.toThrow();
    });
  });

  test("adds artifact guidance to existing OnMyAgent agents", async () => {
    await withWorkspace(async (root) => {
      await mkdir(join(root, ".opencode", "agents"), { recursive: true });
      await writeFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "---\ndescription: Old\n---\n\nOld instructions\n",
        "utf8",
      );
      const result = await ensureWorkspaceFiles(root, "starter");
      const agent = await readFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      expect(agent).toContain("Old instructions");
      expect(agent).toContain(`${APP_NAME} Artifacts`);
      expect(result.reloadReasons.sort()).toEqual(["agents", "commands", "config"]);
    });
  });

  test("injects language guidance into new and existing agents", async () => {
    await withWorkspace(async (root) => {
      // New workspace: agent file is written with the language block in place
      // and positioned before the first section heading (Memory).
      await ensureWorkspaceFiles(root, "starter");
      const fresh = await readFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      expect(fresh).toContain(`<!-- ${APP_NAME}_LANGUAGE_START -->`);
      expect(fresh).toContain("简体中文");
      expect(
        fresh.indexOf(`<!-- ${APP_NAME}_LANGUAGE_START -->`),
      ).toBeLessThan(fresh.indexOf(`<!-- ${APP_NAME}_ARTIFACTS_START -->`));
      expect(
        fresh.indexOf(`<!-- ${APP_NAME}_LANGUAGE_START -->`),
      ).toBeLessThan(fresh.indexOf("## Memory"));

      // Older agent files without the language markers get the block inserted
      // before the first known section heading, not blindly appended.
      await writeFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "---\n---\n\nYour job:\n- Custom instructions\n\n## Memory\n\nExisting notes.\n",
        "utf8",
      );
      await ensureWorkspaceFiles(root, "starter");
      const migrated = await readFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      expect(migrated).toContain("Custom instructions");
      expect(migrated).toContain("Existing notes");
      expect(migrated).toContain(`<!-- ${APP_NAME}_LANGUAGE_START -->`);
      expect(migrated).toContain("简体中文");
      expect(
        migrated.indexOf(`<!-- ${APP_NAME}_LANGUAGE_START -->`),
      ).toBeLessThan(migrated.indexOf("## Memory"));

      // Existing language blocks are refreshed in place when their content
      // drifts, so edits to ONMYAGENT_LANGUAGE_GUIDANCE propagate.
      const staleBlock = `<!-- ${APP_NAME}_LANGUAGE_START -->\n## Language\n\nOld wording.\n<!-- ${APP_NAME}_LANGUAGE_END -->`;
      const withStale = migrated.replace(
        /<!-- .*_LANGUAGE_START -->[\s\S]*?<!-- .*_LANGUAGE_END -->/,
        staleBlock,
      );
      await writeFile(join(root, ".opencode", "agents", "onmyagent.md"), withStale, "utf8");
      await ensureWorkspaceFiles(root, "starter");
      const refreshed = await readFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      expect(refreshed).not.toContain("Old wording");
      expect(refreshed).toContain("简体中文");
    });
  });

  test("injects browser automation guidance into new and existing agents", async () => {
    await withWorkspace(async (root) => {
      // New workspace: the in-app browser guidance is present and points at
      // the managed tool, never at localhost / chrome-devtools.
      await ensureWorkspaceFiles(root, "starter");
      const fresh = await readFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      expect(fresh).toContain(`<!-- ${APP_NAME}_BROWSER_AUTOMATION_START -->`);
      expect(fresh).toContain("onmyagent_browser_node_repl");
      expect(fresh).not.toContain("127.0.0.1");
      expect(fresh).not.toContain("browser_url");

      // Existing agent files without the marker get the block appended; user
      // content outside markers is preserved.
      await writeFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "---\n---\n\nYour job:\n- Custom instructions\n",
        "utf8",
      );
      await ensureWorkspaceFiles(root, "starter");
      const migrated = await readFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      expect(migrated).toContain("Custom instructions");
      expect(migrated).toContain(`<!-- ${APP_NAME}_BROWSER_AUTOMATION_START -->`);

      // A stale block is refreshed in place; the legacy retire pass must not
      // strip the automation marker (only *_BROWSER_START blocks).
      const stale = migrated.replace(
        /<!-- .*_BROWSER_AUTOMATION_START -->[\s\S]*?<!-- .*_BROWSER_AUTOMATION_END -->/,
        `<!-- ${APP_NAME}_BROWSER_AUTOMATION_START -->\n## Browser\n\nold wording\n<!-- ${APP_NAME}_BROWSER_AUTOMATION_END -->`,
      );
      await writeFile(join(root, ".opencode", "agents", "onmyagent.md"), stale, "utf8");
      await ensureWorkspaceFiles(root, "starter");
      const refreshed = await readFile(
        join(root, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      expect(refreshed).not.toContain("old wording");
      expect(refreshed).toContain("onmyagent_browser_node_repl");
    });
  });

  test("retires legacy browser prompts from every agent file regardless of brand", async () => {
    await withWorkspace(async (root) => {
      await mkdir(join(root, ".opencode", "agents"), { recursive: true });
      const legacyBlock = (brand: string) =>
        `<!-- ${brand}_BROWSER_START -->\n## Browser\n\n- \`browser_url\`: always use \`"http://127.0.0.1:9823"\`.\n<!-- ${brand}_BROWSER_END -->`;
      await writeFile(
        join(root, ".opencode", "agents", "teamwork.md"),
        `---\ndescription: TeamWork default agent\n---\n\nYour job:\n- Custom instructions\n\n${legacyBlock("TeamWork")}\n\n## Memory\n\nKeep this.\n`,
        "utf8",
      );
      await writeFile(
        join(root, ".opencode", "agents", "openwork.md"),
        `${legacyBlock("openwork")}\n`,
        "utf8",
      );

      const result = await ensureWorkspaceFiles(root, "starter");

      const teamwork = await readFile(
        join(root, ".opencode", "agents", "teamwork.md"),
        "utf8",
      );
      const openwork = await readFile(
        join(root, ".opencode", "agents", "openwork.md"),
        "utf8",
      );
      expect(teamwork).not.toContain("_BROWSER_START");
      expect(teamwork).not.toContain("9823");
      expect(teamwork).toContain("Custom instructions");
      expect(teamwork).toContain("Keep this.");
      expect(openwork).not.toContain("_BROWSER_START");
      expect(result.reloadReasons).toContain("agents");
    });
  });

  test("does not rewrite an existing valid opencode config", async () => {
    await withWorkspace(async (root) => {
      const configPath = join(root, "opencode.jsonc");
      const config = `{
  // User formatting should survive routine workspace resolution.
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "custom"
}
`;
      await writeFile(configPath, config, "utf8");

      const result = await ensureWorkspaceFiles(root, "starter");

      expect(await readFile(configPath, "utf8")).toBe(config);
      expect(result.reloadReasons).not.toContain("config");
    });
  });

  test("does not add a default agent to an existing valid opencode config", async () => {
    await withWorkspace(async (root) => {
      const configPath = join(root, "opencode.jsonc");
      const config = `{
  // Existing project configs must not trigger reload events on route reads.
  "$schema": "https://opencode.ai/config.json"
}
`;
      await writeFile(configPath, config, "utf8");

      const result = await ensureWorkspaceFiles(root, "starter");

      expect(await readFile(configPath, "utf8")).toBe(config);
      expect(result.reloadReasons).not.toContain("config");
    });
  });

  test("repairs desktop-created schema-only opencode config", async () => {
    await withWorkspace(async (root) => {
      await mkdir(join(root, ".opencode"), { recursive: true });
      await writeFile(join(root, ".opencode", "onmyagent.json"), "{}\n", "utf8");
      const configPath = join(root, "opencode.jsonc");
      await writeFile(
        configPath,
        `{
  "$schema": "https://opencode.ai/config.json"
}
`,
        "utf8",
      );

      const result = await ensureWorkspaceFiles(root, "starter");
      const config = await readFile(configPath, "utf8");

      expect(config).toContain('"default_agent": "onmyagent"');
      expect(result.reloadReasons).not.toContain("config");
    });
  });

  test("repairs default_agent that references a missing agent file", async () => {
    await withWorkspace(async (root) => {
      await mkdir(join(root, ".opencode"), { recursive: true });
      await writeFile(join(root, ".opencode", "onmyagent.json"), "{}\n", "utf8");
      const configPath = join(root, "opencode.jsonc");
      await writeFile(
        configPath,
        `{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "teamwork",
  "plugin": [
    "opencode-chrome-devtools"
  ]
}
`,
        "utf8",
      );

      const result = await ensureWorkspaceFiles(root, "starter");
      const config = await readFile(configPath, "utf8");

      expect(config).toContain('"default_agent": "onmyagent"');
      expect(config).not.toContain("opencode-chrome-devtools");
      expect(config).not.toContain('"plugin"');
      expect(result.reloadReasons).toContain("config");
    });
  });

  test("keeps default_agent when the referenced agent file exists", async () => {
    await withWorkspace(async (root) => {
      await mkdir(join(root, ".opencode", "agents"), { recursive: true });
      await writeFile(join(root, ".opencode", "onmyagent.json"), "{}\n", "utf8");
      await writeFile(
        join(root, ".opencode", "agents", "custom.md"),
        "---\ndescription: custom\n---\n",
        "utf8",
      );
      const configPath = join(root, "opencode.jsonc");
      await writeFile(
        configPath,
        `{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "custom"
}
`,
        "utf8",
      );

      await ensureWorkspaceFiles(root, "starter");
      const config = await readFile(configPath, "utf8");

      expect(config).toContain('"default_agent": "custom"');
    });
  });
});
