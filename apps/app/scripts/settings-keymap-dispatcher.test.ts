import { describe, expect, test } from "bun:test";
import {
  DEFAULT_KEYMAP_ACTIONS,
  detectKeymapPlatform,
  matchAccelerator,
  matchKeymapAction,
  parseBinding,
  resolveAccelerator,
  resolveDefaultAccelerator,
  type KeymapActionId,
} from "../src/react-app/kernel/keymap";

function fakeEvent(partial: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  code?: string;
}): KeyboardEvent {
  return {
    key: partial.key,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    code: partial.code ?? "",
  } as KeyboardEvent;
}

describe("keymap product set", () => {
  test("drops unimplemented task shortcuts", () => {
    const ids = DEFAULT_KEYMAP_ACTIONS.map((a) => a.id);
    expect(ids).not.toContain("toggleTaskMonitor" as KeymapActionId);
    expect(ids).not.toContain("quickSwitchTask" as KeymapActionId);
    expect(ids).not.toContain("searchAllTasks" as KeymapActionId);
    expect(ids).toEqual([
      "openSettings",
      "toggleSidebar",
      "newTask",
      "searchInCurrentTask",
      "sendMessage",
      "insertNewline",
      "appSnapshot",
    ]);
  });

  test("sidebar default is CommandOrControl+B", () => {
    expect(resolveDefaultAccelerator("toggleSidebar", "macos")).toBe(
      "CommandOrControl+B",
    );
  });

  test("app snapshot default is Electron accelerator (customizable)", () => {
    expect(resolveDefaultAccelerator("appSnapshot", "macos")).toBe(
      "CommandOrControl+Shift+A",
    );
    expect(resolveDefaultAccelerator("appSnapshot", "windows")).toBe(
      "CommandOrControl+Shift+A",
    );
  });

  test("insertNewline is Shift+Enter only (Windows-safe)", () => {
    expect(resolveDefaultAccelerator("insertNewline", "windows")).toBe(
      "Shift+Enter",
    );
  });
});

describe("keymap match (mac)", () => {
  test("matches Cmd+N as newTask", () => {
    const ev = fakeEvent({ key: "n", metaKey: true });
    expect(matchKeymapAction(ev, {}, "macos")).toBe("newTask");
  });

  test("matches Cmd+, as openSettings", () => {
    const ev = fakeEvent({ key: ",", metaKey: true });
    expect(matchKeymapAction(ev, {}, "macos")).toBe("openSettings");
  });

  test("matches plain Enter as sendMessage over Shift+Enter", () => {
    expect(matchKeymapAction(fakeEvent({ key: "Enter" }), {}, "macos")).toBe(
      "sendMessage",
    );
    expect(
      matchKeymapAction(
        fakeEvent({ key: "Enter", shiftKey: true }),
        {},
        "macos",
      ),
    ).toBe("insertNewline");
  });

  test("Cmd+Enter is sendMessage", () => {
    expect(
      matchKeymapAction(
        fakeEvent({ key: "Enter", metaKey: true }),
        {},
        "macos",
      ),
    ).toBe("sendMessage");
  });
});

describe("keymap match (windows)", () => {
  test("matches Ctrl+N as newTask", () => {
    const ev = fakeEvent({ key: "n", ctrlKey: true });
    expect(matchKeymapAction(ev, {}, "windows")).toBe("newTask");
  });

  test("matches Ctrl+B as toggleSidebar", () => {
    const ev = fakeEvent({ key: "b", ctrlKey: true });
    expect(matchKeymapAction(ev, {}, "windows")).toBe("toggleSidebar");
  });

  test("Ctrl+Enter is sendMessage; Shift+Enter is insertNewline", () => {
    expect(
      matchKeymapAction(
        fakeEvent({ key: "Enter", ctrlKey: true }),
        {},
        "windows",
      ),
    ).toBe("sendMessage");
    expect(
      matchKeymapAction(
        fakeEvent({ key: "Enter", shiftKey: true }),
        {},
        "windows",
      ),
    ).toBe("insertNewline");
  });

  test("overrides win", () => {
    const ev = fakeEvent({ key: "k", ctrlKey: true });
    expect(
      matchKeymapAction(ev, { newTask: "CommandOrControl+K" }, "windows"),
    ).toBe("newTask");
  });
});

describe("parseBinding CommandOrControl", () => {
  test("platform primary mod", () => {
    const chord = parseBinding("CommandOrControl+N", "windows");
    expect(chord?.requirePrimaryMod).toBe(true);
    expect(chord?.key).toBe("n");
  });
});

describe("resolveAccelerator clear", () => {
  test("explicit empty override unbinds", () => {
    expect(resolveAccelerator("newTask", { newTask: "" }, "macos")).toBe("");
  });
});
