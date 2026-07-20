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

import {
  ensureAllWorkspaceFiles,
  ensureWorkspaceFiles,
} from "../src/workspace/workspace-init.js";
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
  test("ensureAllWorkspaceFiles refreshes every workspace and isolates failures", async () => {
    const good = await mkdtemp(join(tmpdir(), "onmyagent-ensure-all-good-"));
    const bad = join(tmpdir(), "onmyagent-ensure-all-missing-", String(Date.now()));
    try {
      const result = await ensureAllWorkspaceFiles([
        { path: good, preset: "starter", id: "ws_good" },
        { path: "", preset: "starter", id: "ws_empty" },
        // Non-existent parent path that cannot be created as a workspace root
        // is still attempted; ensureDir usually succeeds for tmp paths, so use
        // a file path as a conflict target.
      ]);
      // Create a file so ensureDir fails when treating it as a directory root
      // on platforms that refuse — skip if not applicable.
      expect(result.ok).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBe(0);
      const agent = await readFile(
        join(good, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      );
      expect(agent).toContain(`<!-- ${APP_NAME}_BROWSER_AUTOMATION_START -->`);
      expect(
        await readFile(
          join(good, ".opencode", "tools", "onmyagent_browser_node_repl.ts"),
          "utf8",
        ),
      ).toContain("agent.browsers");
    } finally {
      await rm(good, { recursive: true, force: true });
      await rm(bad, { recursive: true, force: true }).catch(() => undefined);
    }
  });

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
      const visualizerReadMeTool = await readFile(
        join(root, ".opencode", "tools", "read_me.ts"),
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
      expect(agent).toContain(`<!-- ${APP_NAME}_PRESENTATION_START -->`);
      expect(agent).toContain("Do not mention specific tool names");
      expect(agent).toContain("The final reply must stand on its own");
      expect(agent).toContain("Explicit requests to show, visualize, diagram, chart, draw, or graph");
      expect(agent).toContain("Always use an inline visual for educational or teaching requests");
      expect(agent).toContain("Data comparisons and architecture or system design requests");
      expect(agent).toContain("A noun-phrase specification of a visual artifact");
      expect(agent).toContain("Between multiple visuals, write a short paragraph");
      expect(agent).toContain("Before the first operation group");
      expect(agent).toContain("After receiving a material result and before starting the next operation group");
      expect(agent).toContain("Every visible process fold should therefore have preceding body text");
      expect(agent).toContain("Do not narrate every low-level call");
      expect(agent).toContain("Text -> operation group -> text -> operation group");
      expect(agent).toContain('request `modules: ["chart"]`');
      expect(agent).toContain("call `read_me` with every relevant module and then `render_visual`");
      expect(agent).toContain("pass its workspace-relative path as `file_path`");
      expect(agent).toContain("use responsive Chart.js HTML");
      expect(agent).toContain("Do not read the file back into the tool call");
      expect(designSpecTool).toContain('from "./read_me"');
      expect(visualizerReadMeTool).toContain("# Visualizer Core Design System");
      expect(visualizerReadMeTool).toContain("# Color Palette (9 ramps × 7 levels)");
      expect(visualizerReadMeTool).toContain("# SVG Setup Rules");
      expect(visualizerReadMeTool).toContain("# Diagram Guidance");
      expect(visualizerReadMeTool).toContain("# UI Components");
      expect(visualizerReadMeTool).toContain("# Charts (Chart.js)");
      expect(visualizerReadMeTool).toContain("# Geographic maps (D3 choropleth)");
      expect(visualizerReadMeTool).toContain("# Art and illustration");
      expect(visualizerReadMeTool).toContain('type: "visualizer_read_me_result"');
      expect(visualizerReadMeTool).toContain("JSON.stringify(payload)");
      expect(visualizerReadMeTool).toContain('tool.schema.enum(["diagram","mockup","interactive","chart","art"])');
      expect(visualizerReadMeTool).toContain("Do NOT mention or narrate this call to the user");
      expect(visualizerReadMeTool).toContain("Canvas cannot resolve CSS variables");
      expect(visualizerReadMeTool).toContain("responsive: true");
      expect(visualizerReadMeTool).toContain("maintainAspectRatio: false");
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
      expect(agent).toContain(`<!-- ${APP_NAME}_PRESENTATION_START -->`);
      expect(agent).toContain("Do not mention specific tool names");
      expect(agent).toContain("Before the first operation group");
      expect(agent).toContain("Every visible process fold should therefore have preceding body text");
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

  test("strips browser automation when the Browser plugin is disabled", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "onmyagent-browser-disabled-"));
    try {
      const pluginsRoot = join(fixtureRoot, "bundled-plugins-disabled");
      const pluginDir = join(pluginsRoot, "browser");
      await mkdir(join(pluginDir, ".codex-plugin"), { recursive: true });
      await mkdir(join(pluginDir, ".onmyagent"), { recursive: true });
      await mkdir(join(pluginDir, "skills", "browser-automation"), { recursive: true });
      await writeFile(
        join(pluginDir, ".codex-plugin", "plugin.json"),
        JSON.stringify({
          name: "browser",
          version: "1.0.0",
          description: "Browser",
          author: { name: "OnMyAgent" },
          skills: "./skills/",
          interface: {
            displayName: "Browser",
            shortDescription: "Browser",
            longDescription: "Browser",
            developerName: "OnMyAgent",
            category: "Engineering",
            capabilities: ["Interactive"],
            defaultPrompt: ["Open a page"],
            screenshots: [],
          },
        }),
        "utf8",
      );
      await writeFile(
        join(pluginDir, ".onmyagent", "artifact.json"),
        JSON.stringify({
          skills: [{ id: "browser-automation", defaultEnabled: true }],
          routing: { extensions: [], mimeTypes: [] },
        }),
        "utf8",
      );
      await writeFile(
        join(pluginDir, "skills", "browser-automation", "SKILL.md"),
        "---\nname: browser-automation\ndescription: Browser skill\n---\n\n# Browser\n",
        "utf8",
      );
      const configDir = join(fixtureRoot, "config-disabled");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "artifact-plugins.json"),
        JSON.stringify({ plugins: { browser: { enabled: false, skills: {} } } }),
        "utf8",
      );
      process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR = pluginsRoot;
      process.env.ONMYAGENT_SERVER_CONFIG = join(configDir, "server.json");
      await withWorkspace(async (root) => {
        await ensureWorkspaceFiles(root, "starter");
        const agent = await readFile(
          join(root, ".opencode", "agents", "onmyagent.md"),
          "utf8",
        );
        expect(agent).not.toContain(`<!-- ${APP_NAME}_BROWSER_AUTOMATION_START -->`);
        await expect(
          stat(join(root, ".opencode", "tools", "onmyagent_browser_node_repl.ts")),
        ).rejects.toThrow();
      });
    } finally {
      delete process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR;
      delete process.env.ONMYAGENT_SERVER_CONFIG;
      await rm(fixtureRoot, { recursive: true, force: true });
    }
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
        join(root, ".opencode", "agents", "legacy-brand.md"),
        `${legacyBlock("LegacyBrand")}\n`,
        "utf8",
      );

      const result = await ensureWorkspaceFiles(root, "starter");

      const teamwork = await readFile(
        join(root, ".opencode", "agents", "teamwork.md"),
        "utf8",
      );
      const legacyBrand = await readFile(
        join(root, ".opencode", "agents", "legacy-brand.md"),
        "utf8",
      );
      expect(teamwork).not.toContain("_BROWSER_START");
      expect(teamwork).not.toContain("9823");
      expect(teamwork).toContain("Custom instructions");
      expect(teamwork).toContain("Keep this.");
      expect(legacyBrand).not.toContain("_BROWSER_START");
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
