import assert from "node:assert/strict";
import test from "node:test";

import { showDesktopNotification } from "./desktop-notification.mjs";

function fakeNotification(mode) {
  function NotificationImpl() {
    /** @type {Record<string, Function>} */
    this.handlers = {};
  }
  NotificationImpl.isSupported = () => true;
  NotificationImpl.prototype.on = function on(event, handler) {
    this.handlers[event] = handler;
  };
  NotificationImpl.prototype.show = function show() {
    if (mode === "failed") {
      this.handlers.failed?.(null, "unsigned");
      return;
    }
    if (mode === "throw") {
      throw new Error("show-threw");
    }
  };
  return NotificationImpl;
}

test("showDesktopNotification reports a failed OS show without throwing", () => {
  const result = showDesktopNotification(
    { title: "Update ready", body: "Restart", force: true },
    { Notification: fakeNotification("failed") },
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error), /unsigned/);
});

test("showDesktopNotification does not throw when show() throws", () => {
  const result = showDesktopNotification(
    { title: "Task", force: true },
    { Notification: fakeNotification("throw") },
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error), /show-threw/);
});
