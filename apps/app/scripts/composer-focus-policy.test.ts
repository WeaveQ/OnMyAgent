import { describe, expect, test } from "bun:test";

import { shouldRestoreComposerFocus } from "../src/react-app/domains/session/surface/composer/composer-focus-policy";

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
