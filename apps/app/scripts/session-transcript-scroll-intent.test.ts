import { describe, expect, test } from "bun:test";

import { classifyTranscriptScrollIntent } from "../src/react-app/domains/session/surface/transcript/scroll-intent";

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
});
