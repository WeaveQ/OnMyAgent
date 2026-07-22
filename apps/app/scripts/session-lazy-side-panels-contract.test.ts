import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("session right-rail lazy load (structural)", () => {
  test("assistant/expert pages use lazy side panel entry, not eager VoicePanel imports", () => {
    const assistant = read("src/react-app/domains/session/pages/assistant.tsx");
    const expert = read("src/react-app/domains/session/pages/expert.tsx");
    const lazy = read(
      "src/react-app/domains/session/pages/lazy-session-side-panels.tsx",
    );

    expect(lazy).toContain('lazy(() =>');
    expect(lazy).toContain("voice-panel");
    expect(lazy).toContain("code-workspace-side-panel");
    expect(lazy).toContain("infinite-canvas");

    for (const source of [assistant, expert]) {
      expect(source).toContain("LazyVoicePanel");
      expect(source).toContain("LazyCodeWorkspaceSidePanel");
      expect(source).toContain("LazyInfiniteCanvasPanel");
      expect(source).not.toMatch(
        /import\s*\{\s*VoicePanel\s*\}\s*from\s*["']\.\.\/voice\/voice-panel["']/,
      );
      expect(source).not.toMatch(
        /import\s*\{\s*CodeWorkspaceSidePanel\s*\}\s*from\s*["']\.\.\/surface\/code-workspace-side-panel["']/,
      );
    }
  });

  test("browser bounds rAF stops when inactive and restarts when active", () => {
    const browser = read(
      "src/react-app/domains/session/browser/browser-panel.tsx",
    );
    expect(browser).toContain("shouldRunBrowserBoundsRaf");
    expect(browser).toContain("shouldStartBrowserBoundsLoop");
    expect(browser).toContain("requestAnimationFrame(watchBounds)");
    // Effect must re-run on active transitions (false→true restarts loop).
    const watchIdx = browser.indexOf("const watchBounds = () =>");
    expect(watchIdx).toBeGreaterThan(-1);
    const tail = browser.slice(watchIdx, watchIdx + 1800);
    expect(tail).toMatch(/\},\s*\[active\]\s*\);/);
  });

  test("history panel does not use 8s refetchInterval", () => {
    const history = read(
      "src/react-app/domains/session/sidebar/conversation-history-panel.tsx",
    );
    expect(history).not.toMatch(/refetchInterval:\s*8_?000/);
    expect(history).toMatch(/staleTime:\s*30_?000/);
  });

  test("transcript still uses stabilizeMessageBlocks for structural sharing", () => {
    const list = read(
      "src/react-app/domains/session/surface/message-list.tsx",
    );
    expect(list).toContain("stabilizeMessageBlocks");
    expect(list).toContain("scrollToMessageByIdRef");
  });
});
