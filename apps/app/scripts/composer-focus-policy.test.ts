import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  composerShowsStopButton,
  shouldRestoreComposerFocus,
} from "../src/react-app/domains/session/surface/composer/composer-focus-policy";

describe("composer focus policy", () => {
  test("restores focus when an assistant turn finishes", () => {
    expect(shouldRestoreComposerFocus({
      wasBusy: true,
      busy: false,
      externalEditorActive: false,
    })).toBe(true);
  });

  test("does not steal focus from a form field outside the composer", () => {
    expect(shouldRestoreComposerFocus({
      wasBusy: true,
      busy: false,
      externalEditorActive: true,
    })).toBe(false);
  });

  test("does not focus on ordinary busy state updates", () => {
    expect(shouldRestoreComposerFocus({
      wasBusy: false,
      busy: false,
      externalEditorActive: false,
    })).toBe(false);
    expect(shouldRestoreComposerFocus({
      wasBusy: true,
      busy: true,
      externalEditorActive: false,
    })).toBe(false);
  });
});

describe("composer stop vs send while busy", () => {
  test("shows stop only when busy and the draft is empty", () => {
    expect(composerShowsStopButton({ busy: true, canSend: false })).toBe(true);
    expect(composerShowsStopButton({ busy: true, canSend: true })).toBe(false);
    expect(composerShowsStopButton({ busy: false, canSend: true })).toBe(false);
  });

  test("session composer uses the stop-vs-send helper", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/react-app/domains/session/surface/composer/composer.tsx"),
      "utf8",
    );
    expect(source).toContain("composerShowsStopButton({ busy: props.busy, canSend })");
  });
});
