import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("automation typography contract", () => {
  test("keeps automation headings and task rows compact", () => {
    const source = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/messaging/automation-page.tsx"),
      "utf8",
    );

    expect(source).toContain('<h1 className="text-lg font-semibold">');
    expect(source).toContain('<p className="mt-2 text-xs text-dls-secondary">');
    expect(source).toContain('className="truncate text-sm font-medium"');
    expect(source).toContain(
      'className="block truncate text-sm font-medium text-dls-text"',
    );
    expect(source).toContain(
      'className="mt-0.5 block truncate text-xs text-dls-secondary"',
    );
    expect(source).not.toContain(
      'className="block truncate text-base font-semibold text-dls-text"',
    );
    expect(source).not.toContain('className="truncate text-base font-semibold">{props.item.title}');
    expect(source).not.toContain('className="truncate text-base font-semibold">{task.title}');
  });
});
