import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildArtifactPluginGuidance } from "../src/services/artifact-plugin-guidance.js";
import {
  artifactPluginEnablementPath,
  updatePluginEnablement,
} from "../src/services/artifact-plugin-enablement.js";

let tempRoot = "";
let originalPluginsDir: string | undefined;

describe("artifact plugin session guidance", () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-artifact-guidance-"));
    originalPluginsDir = process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR;
    process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR = resolve(
      import.meta.dir,
      "../../desktop/resources/bundled-plugins",
    );
  });

  afterEach(async () => {
    if (originalPluginsDir === undefined) {
      delete process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR;
    } else {
      process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR = originalPluginsDir;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("routes natural language and attachments only to enabled local file skills", async () => {
    const configPath = join(tempRoot, "config", "server.json");
    const initial = await buildArtifactPluginGuidance(configPath);
    expect(initial).toContain("matching natural-language requests or attached files");
    expect(initial).toContain("`documents`");
    expect(initial).toContain("`.docx`");
    expect(initial).toContain("`spreadsheets`");
    expect(initial).toContain("`.xlsx`");
    expect(initial).toContain("`pdf`");
    expect(initial).toContain("`.pdf`");
    expect(initial).not.toContain("excel-live-control");

    await updatePluginEnablement(
      artifactPluginEnablementPath(configPath),
      "documents",
      false,
    );
    const afterDisable = await buildArtifactPluginGuidance(configPath);
    expect(afterDisable).not.toContain("`documents`");
    expect(afterDisable).not.toContain("`.docx`");
    expect(afterDisable).toContain("`spreadsheets`");
    expect(afterDisable).toContain("`pdf`");
  });
});
