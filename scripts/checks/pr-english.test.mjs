import assert from "node:assert/strict";
import test from "node:test";

import {
  checkPrEnglish,
  findCjkMatches,
  stripCodeForEnglishGate,
} from "./pr-english.mjs";

test("strips fenced and inline code before scanning body", () => {
  const plain = stripCodeForEnglishGate(
    "See ```设置 → 自动化``` and `去设置` then allow.",
  );
  assert.equal(findCjkMatches(plain).length, 0);
});

test("accepts English title and body", () => {
  const result = checkPrEnglish({
    title: "fix(desktop): trigger Automation permission prompt",
    body: "Open System Settings after probing Calendar AE.",
  });
  assert.equal(result.ok, true);
});

test("rejects Chinese title", () => {
  const result = checkPrEnglish({
    title: "修复自动化权限",
    body: "English body",
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((f) => f.field === "title"), true);
});

test("rejects Chinese body outside code", () => {
  const result = checkPrEnglish({
    title: "fix: automation",
    body: "点「去设置」后列表为空",
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((f) => f.field === "body"), true);
});

test("allows Chinese only inside fenced code", () => {
  const result = checkPrEnglish({
    title: "fix: automation",
    body:
      "Repro:\n```\n设置 → 系统授权 → 自动化\n```\nThen allow the system dialog.",
  });
  assert.equal(result.ok, true);
});

test("rejects Chinese commit subjects", () => {
  const result = checkPrEnglish({
    title: "fix: x",
    body: "ok",
    commits: ["fix: 修复权限"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((f) => f.field === "commit"), true);
});
