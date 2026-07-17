import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToString } from "react-dom/server";

import {
  ArtifactPluginDetail,
  ArtifactStarterPrompts,
} from "./artifact-plugin-detail";
import type { ArtifactPluginDetail as ArtifactPluginDetailModel } from "./artifact-plugin-client";

const spreadsheets = {
  id: "spreadsheets",
  manifest: {
    name: "spreadsheets",
    version: "1.0.0",
    description: "Spreadsheet workflows",
    author: { name: "OnMyAgent" },
    keywords: [],
    interface: {
      displayName: "Spreadsheets",
      shortDescription: "Create and edit workbooks",
      longDescription: "Create, edit, and analyze spreadsheet workbooks.",
      developerName: "OnMyAgent",
      category: "Productivity",
      capabilities: ["workbooks", "analysis"],
      defaultPrompt: ["Build a budget", "Analyze this workbook", "Create a chart"],
      screenshots: [],
    },
  },
  runtime: {
    skills: [
      { id: "spreadsheets", defaultEnabled: true },
      { id: "excel-live-control", defaultEnabled: false },
    ],
    routing: {
      extensions: [".xlsx"],
      mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    },
  },
  enabled: true,
  skills: [
    { id: "spreadsheets", enabled: true, defaultEnabled: true },
    { id: "excel-live-control", enabled: false, defaultEnabled: false },
  ],
  connection: {
    status: "unavailable",
    reason: "No live provider is registered",
  },
} satisfies ArtifactPluginDetailModel;

describe("ArtifactPluginDetail", () => {
  test("renders three prompts, plugin and skill switches, disabled affordances, and localized unavailable state", () => {
    const html = renderToString(
      <ArtifactPluginDetail
        plugin={spreadsheets}
        labels={{
          pluginEnabled: "Plugin enabled",
          skillEnabled: (name) => `${name} enabled`,
          starterPrompts: "Starter prompts",
          skills: "Skills",
          unavailable: "Excel Live is unavailable until a live provider is registered.",
          enabled: "Enabled",
          disabled: "Disabled",
        }}
        onSelectPrompt={() => undefined}
        onPluginEnabledChange={async () => undefined}
        onSkillEnabledChange={async () => undefined}
      />,
    );

    for (const prompt of spreadsheets.manifest.interface.defaultPrompt) {
      assert.ok(html.includes(prompt));
    }
    assert.equal(html.match(/data-artifact-prompt=/g)?.length, 3);
    assert.ok(html.includes('aria-label="Plugin enabled"'));
    assert.ok(html.includes('aria-label="spreadsheets enabled"'));
    assert.ok(html.includes('aria-label="excel-live-control enabled"'));
    assert.ok(html.includes("Excel Live is unavailable until a live provider is registered."));
    assert.ok(html.includes("disabled"));
  });

  test("starter prompt interaction emits plugin, primary skill, and prompt", () => {
    const selections: Array<{ pluginId: string; skillId: string; prompt: string }> = [];
    const promptView = ArtifactStarterPrompts({
      pluginId: spreadsheets.id,
      skillId: "spreadsheets",
      prompts: spreadsheets.manifest.interface.defaultPrompt,
      onSelectPrompt: (pluginId, skillId, prompt) => {
        selections.push({ pluginId, skillId, prompt });
      },
    });
    const promptButtons = promptView.props.children;

    promptButtons[1].props.onClick();

    assert.deepEqual(selections, [
      {
        pluginId: "spreadsheets",
        skillId: "spreadsheets",
        prompt: "Analyze this workbook",
      },
    ]);
  });
});
