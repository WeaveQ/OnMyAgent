import { describe, expect, test } from "bun:test";
import { formatAppMilestoneLabel, formatAppVersionLabel } from "./app-version";

describe("app version labels", () => {
  test("prefixes a v when missing", () => {
    expect(formatAppVersionLabel("0.7.0")).toBe("v0.7.0");
    expect(formatAppVersionLabel("v0.7.0")).toBe("v0.7.0");
    expect(formatAppVersionLabel("")).toBe("");
  });

  test("milestone is major.minor", () => {
    expect(formatAppMilestoneLabel("0.7.0")).toBe("0.7");
    expect(formatAppMilestoneLabel("v0.6.2")).toBe("0.6");
    expect(formatAppMilestoneLabel("1.0.0-rc.1")).toBe("1.0");
  });
});
