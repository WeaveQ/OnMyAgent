import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Checkbox } from "../src/components/ui/checkbox";

test("Checkbox renders a minus glyph for an indeterminate selection", () => {
  const html = renderToStaticMarkup(
    createElement(Checkbox, {
      checked: false,
      indeterminate: true,
      "aria-label": "Select section",
    }),
  );

  expect(html).toContain("data-indeterminate");
  expect(html).toContain("M5 12h14");
  expect(html).not.toContain("m9 11 3 3L22 4");
});
