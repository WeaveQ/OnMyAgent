import { describe, expect, test } from "bun:test";

import { classifyTranscriptScrollIntent } from "../src/react-app/domains/session/surface/transcript/scroll-intent";
import * as scrollIntent from "../src/react-app/domains/session/surface/transcript/scroll-intent";

describe("session transcript scroll intent", () => {
  test("interrupts an in-flight follow when the user browses", () => {
    expect(classifyTranscriptScrollIntent({
      programmatic: true,
      userGestured: true,
      scrolledUp: false,
      exactlyAtBottom: false,
    })).toBe("interrupt-follow");
    expect(classifyTranscriptScrollIntent({
      programmatic: true,
      userGestured: false,
      scrolledUp: true,
      exactlyAtBottom: false,
    })).toBe("interrupt-follow");
  });

  test("keeps following passive frames and restores follow at the bottom", () => {
    expect(classifyTranscriptScrollIntent({
      programmatic: true,
      userGestured: false,
      scrolledUp: false,
      exactlyAtBottom: true,
    })).toBe("follow-frame");
    expect(classifyTranscriptScrollIntent({
      programmatic: false,
      userGestured: true,
      scrolledUp: false,
      exactlyAtBottom: true,
    })).toBe("restore-follow");
  });

  test("distinguishes manual browsing from passive layout movement", () => {
    expect(classifyTranscriptScrollIntent({
      programmatic: false,
      userGestured: true,
      scrolledUp: false,
      exactlyAtBottom: false,
    })).toBe("manual-browse");
    expect(classifyTranscriptScrollIntent({
      programmatic: false,
      userGestured: false,
      scrolledUp: false,
      exactlyAtBottom: false,
    })).toBe("passive");
  });

  test("filters WorkBuddy trackpad rebound noise but accepts meaningful wheel gestures", () => {
    const shouldPause = Reflect.get(scrollIntent, "shouldPauseTranscriptFollowOnWheel");
    expect(typeof shouldPause).toBe("function");
    if (typeof shouldPause !== "function") return;

    expect(shouldPause(-4)).toBe(true);
    expect(shouldPause(-3)).toBe(false);
    expect(shouldPause(-1)).toBe(false);
    expect(shouldPause(12)).toBe(false);
  });

  test("sticks content growth only while the active transcript is following", () => {
    const shouldStick = Reflect.get(scrollIntent, "shouldAutoStickTranscriptGrowth");
    expect(typeof shouldStick).toBe("function");
    if (typeof shouldStick !== "function") return;

    expect(shouldStick({
      grew: true,
      stickyBottom: true,
      active: true,
      userInteracting: false,
      sessionChangeScroll: "bottom",
    })).toBe(true);
    expect(shouldStick({
      grew: true,
      stickyBottom: true,
      active: false,
      userInteracting: false,
      sessionChangeScroll: "bottom",
    })).toBe(false);
    expect(shouldStick({
      grew: true,
      stickyBottom: true,
      active: true,
      userInteracting: true,
      sessionChangeScroll: "bottom",
    })).toBe(false);
    expect(shouldStick({
      grew: true,
      stickyBottom: true,
      active: true,
      userInteracting: false,
      sessionChangeScroll: "top",
    })).toBe(false);
  });

  test("wires WorkBuddy touch, scrollbar drag, resize cleanup, and retry activity", async () => {
    const [surface, controller] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/session-surface.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/scroll-controller.ts",
        import.meta.url,
      )).text(),
    ]);

    expect(surface).toContain("onTouchStart={(event) =>");
    expect(surface).toContain("onTouchMove={(event) =>");
    expect(surface).toContain("onPointerDown={(event) =>");
    expect(surface).toContain("event.target !== event.currentTarget");
    expect(surface).toContain('liveStatus.type === "retry"');
    expect(controller).toContain("observer.observe(content)");
    expect(controller).toContain("return () => observer.disconnect()");
    expect(controller).toContain("countPrependedTranscriptMessages");
    expect(controller).toContain("anchoredTranscriptScrollTop");
  });

  test("keeps virtualization-library overscan semantics explicit", async () => {
    const source = await Bun.file(new URL(
      "../src/react-app/domains/session/surface/message-list.tsx",
      import.meta.url,
    )).text();

    expect(source).toContain("const VIRTUAL_OVERSCAN = 4");
    expect(source).toContain("overscan: VIRTUAL_OVERSCAN");
    expect(source).toContain("virtualizer.measureElement");
    expect(source).toContain("new ResizeObserver");
  });
});
