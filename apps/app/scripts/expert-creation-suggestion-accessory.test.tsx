import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  ExpertCreationSuggestionAccessory,
  confirmExpertCreationSuggestion,
} from "../src/react-app/domains/session/pages/expert-creation-suggestion-accessory";

describe("expert creation suggestion accessory", () => {
  test("renders dismiss and confirm actions above the composer", () => {
    const html = renderToString(createElement(ExpertCreationSuggestionAccessory, {
      title: "Coach drafted expert fields",
      detail: "Ready to sync: Name",
      dismissLabel: "Dismiss",
      confirmLabel: "Apply to form",
      onDismiss: () => undefined,
      onConfirm: () => undefined,
    }));

    expect(html).toContain('data-slot="expert-creation-suggestion-accessory"');
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html.indexOf("Dismiss")).toBeLessThan(html.indexOf("Apply to form"));
  });

  test("confirm applies the pending suggestion and clears confirmation state", () => {
    const events: string[] = [];
    const suggestion = { name: "Travel planner" };

    const confirmed = confirmExpertCreationSuggestion({
      pendingSuggestion: suggestion,
      onApplyDraftSuggestion: (value, options) => {
        events.push(`${value.name}:${options.mode}`);
      },
      onConfirmed: () => events.push("cleared"),
    });

    expect(confirmed).toBe(true);
    expect(events).toEqual(["Travel planner:force", "cleared"]);
  });
});
