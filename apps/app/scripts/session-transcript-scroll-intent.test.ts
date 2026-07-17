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
    expect(controller).toContain("mutationObserver.observe(content");
    expect(controller).toContain("const stickToMutatedGrowth");
    const wheelHandler = controller.slice(
      controller.indexOf("const markWheelGesture"),
      controller.indexOf("const releaseProgrammaticScrollSoon"),
    );
    expect(wheelHandler.indexOf("if (!shouldPauseTranscriptFollowOnWheel(deltaY)) return;")).toBeLessThan(
      wheelHandler.indexOf("markScrollGesture(target);"),
    );
    expect(controller).toContain("mutationObserver.disconnect()");
    expect(controller).toContain("observer.disconnect()");
    expect(controller).toContain("countPrependedTranscriptMessages");
    expect(controller).toContain("anchoredTranscriptScrollTop");
  });

  test("matches the WorkBuddy scroll-to-bottom affordance", async () => {
    const [surface, controller, control, styles] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/session-surface.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/scroll-controller.ts",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/chrome/transcript-scroll-to-latest.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL("../src/app/index.css", import.meta.url)).text(),
    ]);

    expect(surface).not.toContain("session.jump_to_start");
    expect(surface).not.toContain("jumpToStartOfMessage");
    expect(controller).not.toContain("jumpToStartOfMessage");
    expect(surface).toContain("visible={!personalAssistantDraftHome && !sessionScroll.isAtBottom}");
    expect(surface).toContain('sessionScroll.jumpToLatest("auto")');
    expect(control).toContain("session-workbuddy-scroll-to-bottom");
    expect(styles).toContain(".session-workbuddy-scroll-to-bottom");
    expect(styles).toContain("width: 32px");
    expect(styles).toContain("height: 32px");
    expect(styles).toContain("border-radius: 999px");
    expect(styles).toContain("0 4px 12px rgb(0 0 0 / 4%)");
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
