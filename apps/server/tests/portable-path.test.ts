import { describe, expect, test } from "bun:test";

import {
  portableRelativeSegments,
  toPortableRelativePath,
} from "../src/workspace/portable-path.js";

describe("toPortableRelativePath", () => {
  test("normalizes backslashes and ./ prefixes", () => {
    expect(toPortableRelativePath("a\\b\\c")).toBe("a/b/c");
    expect(toPortableRelativePath("./docs/readme.md")).toBe("docs/readme.md");
    expect(toPortableRelativePath("foo//bar")).toBe("foo/bar");
  });

  test("rejects absolute and traversal paths", () => {
    expect(toPortableRelativePath("/etc/passwd")).toBeNull();
    expect(toPortableRelativePath("C:\\Users\\x\\file")).toBeNull();
    expect(toPortableRelativePath("C:/Users/x/file")).toBeNull();
    expect(toPortableRelativePath("../secret")).toBeNull();
    expect(toPortableRelativePath("a/../b")).toBeNull();
    expect(toPortableRelativePath("a/./b")).toBeNull();
    expect(toPortableRelativePath("")).toBeNull();
    expect(toPortableRelativePath("   ")).toBeNull();
  });

  test("keeps safe relative segments", () => {
    expect(toPortableRelativePath(".opencode/agents/foo.md")).toBe(
      ".opencode/agents/foo.md",
    );
    expect(toPortableRelativePath("skills/my-skill/SKILL.md")).toBe(
      "skills/my-skill/SKILL.md",
    );
  });
});

describe("portableRelativeSegments", () => {
  test("splits portable paths", () => {
    expect(portableRelativeSegments("a\\b\\c")).toEqual(["a", "b", "c"]);
    expect(portableRelativeSegments("../x")).toBeNull();
  });
});
