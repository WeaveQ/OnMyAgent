import { describe, expect, test } from "bun:test";

import { ConnectorsPage, SkillsPage } from "../src/react-app/domains/shared/plugins-page";

describe("shared plugins page contract", () => {
  test("exports reusable skills and connectors pages for session side panels", () => {
    expect(typeof SkillsPage).toBe("function");
    expect(typeof ConnectorsPage).toBe("function");
  });
});
