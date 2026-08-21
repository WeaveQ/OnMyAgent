import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const docs = join(dirname(fileURLToPath(import.meta.url)), "../docs");

function readDoc(relative) {
  return readFileSync(join(docs, relative), "utf8");
}

test("changelog ships 0.5.9 before the old 0.5.4 heading", () => {
  const text = readDoc("changelog.md");
  const nine = text.indexOf("## 0.5.9");
  const four = text.indexOf("## 0.5.4");
  assert.ok(nine >= 0, "changelog must have ## 0.5.9");
  assert.ok(four > nine, "0.5.9 must appear before 0.5.4");
  assert.match(text, /知识库/);
  assert.match(text, /skill-creator/);
  assert.match(text, /去对话/);
});

test("changelog lists 0.5.25 user-visible notes before 0.5.15", () => {
  const text = readDoc("changelog.md");
  const latest = text.indexOf("## 0.5.25");
  const older = text.indexOf("## 0.5.15");
  assert.ok(latest >= 0, "changelog must have ## 0.5.25");
  assert.ok(older > latest, "0.5.25 must appear before 0.5.15");
  assert.match(text, /模型列表/);
  assert.match(text, /货架快照/);
});

test("intro main-rail table includes 知识库", () => {
  const text = readDoc("index.md");
  const rail = text.slice(text.indexOf("## 3. 界面怎么走"));
  assert.match(rail, /^\| \*\*知识库\*\* \|/m);
});

test("capability-status marks 知识库 正式可用 and hides 任务中心", () => {
  const text = readDoc("guide/capability-status.md");
  assert.match(text, /^\| 知识库 \| 正式可用 \|/m);
  assert.match(text, /^\| 任务中心 \| 隐藏 \/ 开发者 \|/m);
});

test("skills guide documents builtin lock, inject, and 去对话", () => {
  const text = readDoc("guide/skills.md");
  assert.match(text, /不能卸载|不可卸载/);
  assert.match(text, /中文/);
  assert.match(text, /SKILL\.md/);
  assert.match(text, /去对话/);
  assert.match(text, /首页主轨/);
});
