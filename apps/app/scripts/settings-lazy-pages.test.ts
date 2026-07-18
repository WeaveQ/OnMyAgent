import { describe, expect, test } from "bun:test";

import {
  loadGeneralSettingsView,
  loadPreferencesView,
  loadAiSettingsView,
  loadUpdatesView,
  loadMemoryView,
} from "../src/react-app/domains/settings/lazy-pages";

/**
 * Drives the real settings page loaders used by the shell host.
 * Each factory must resolve the shipped view export (not a test stub).
 */
describe("settings lazy page loaders (shipped entry)", () => {
  test("loadGeneralSettingsView resolves GeneralSettingsView", async () => {
    const module = await loadGeneralSettingsView();
    expect(typeof module.GeneralSettingsView).toBe("function");
  });

  test("loadPreferencesView resolves PreferencesView", async () => {
    const module = await loadPreferencesView();
    expect(typeof module.PreferencesView).toBe("function");
  });

  test("loadAiSettingsView resolves AiSettingsView", async () => {
    const module = await loadAiSettingsView();
    expect(typeof module.AiSettingsView).toBe("function");
  });

  test("loadUpdatesView resolves UpdatesView", async () => {
    const module = await loadUpdatesView();
    expect(typeof module.UpdatesView).toBe("function");
  });

  test("loadMemoryView resolves MemoryView", async () => {
    const module = await loadMemoryView();
    expect(typeof module.MemoryView).toBe("function");
  });
});
