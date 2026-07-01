import { describe, expect, test } from "bun:test";

import {
  errorBannerClass,
  inputClass,
  modalBodyClass,
  pillPrimaryClass,
  surfaceCardClass,
  tagClass,
} from "../src/react-app/domains/shared/modal-styles";

describe("shared modal styles contract", () => {
  test("keeps modal body scrollable inside fixed-height dialogs", () => {
    expect(modalBodyClass.split(" ")).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto"]),
    );
  });

  test("keeps shared surfaces aligned to DLS tokens", () => {
    for (const className of [surfaceCardClass, inputClass, pillPrimaryClass, tagClass, errorBannerClass]) {
      expect(className).toContain("dls-");
      expect(className).not.toContain("shadow");
    }
  });
});
