import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const docs = join(dirname(fileURLToPath(import.meta.url)), "../docs");

function readDoc(relative) {
  return readFileSync(join(docs, relative), "utf8");
}

function listMarkdownDocs(dir = docs, prefix = "") {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownDocs(abs, rel));
    } else if (entry.name.endsWith(".md")) {
      files.push(rel);
    }
  }
  return files;
}

test("changelog ships 0.5.9 before the old 0.5.4 heading", () => {
  const text = readDoc("changelog/0.5.md");
  const nine = text.indexOf("## 0.5.9");
  const four = text.indexOf("## 0.5.4");
  assert.ok(nine >= 0, "changelog/0.5 must have ## 0.5.9");
  assert.ok(four > nine, "0.5.9 must appear before 0.5.4");
  assert.match(text, /知识库/);
  assert.match(text, /skill-creator/);
  assert.match(text, /去对话/);
});

test("changelog lists 0.5.25 user-visible notes before 0.5.15", () => {
  const text = readDoc("changelog/0.5.md");
  const latest = text.indexOf("## 0.5.25");
  const older = text.indexOf("## 0.5.15");
  assert.ok(latest >= 0, "changelog/0.5 must have ## 0.5.25");
  assert.ok(older > latest, "0.5.25 must appear before 0.5.15");
  assert.match(text, /模型列表/);
  assert.match(text, /货架快照/);
});

test("zh and en changelogs ship 0.5.26 before 0.5.25", () => {
  for (const rel of ["changelog/0.5.md", "en/changelog/0.5.md"]) {
    const text = readDoc(rel);
    const latest = text.indexOf("## 0.5.26");
    const older = text.indexOf("## 0.5.25");
    assert.ok(latest >= 0, `${rel} must have ## 0.5.26`);
    assert.ok(older >= 0, `${rel} must have ## 0.5.25`);
    assert.ok(older > latest, `${rel}: 0.5.26 must appear before 0.5.25`);
  }
});

test("Task Center copy does not claim local/dev still shows the rail", () => {
  const stale = [
    "本地开发仍可见",
    "still visible in local dev",
    "local/dev still shows the rail",
  ];
  const hits = [];
  for (const rel of listMarkdownDocs()) {
    const text = readDoc(rel);
    for (const needle of stale) {
      if (text.includes(needle)) hits.push(`${rel}: ${needle}`);
    }
  }
  assert.equal(hits.length, 0, `stale Task Center rail copy:\n${hits.join("\n")}`);
});

test("intro main-rail table includes 知识库", () => {
  const text = readDoc("index.md");
  const rail = text.slice(text.indexOf("## 3. 界面怎么走"));
  assert.match(rail, /^\| \*\*知识库\*\* \|/m);
  assert.match(rail, /多库、块编辑、会话存入/);
});

test("changelog 0.7 ships knowledge highlights and lists 0.7.x first in the sidebar", () => {
  const zh = readDoc("changelog/0.7.md");
  const en = readDoc("en/changelog/0.7.md");
  assert.match(zh, /## 0.7.0/);
  assert.match(zh, /知识库/);
  assert.match(zh, /存入知识库/);
  assert.match(zh, /最近访问/);
  assert.match(zh, /完全访问/);
  assert.match(en, /## 0.7.0/);
  assert.match(en, /Save to knowledge/);
  assert.match(en, /Allow full access/);
  const config = readFileSync(join(docs, ".vitepress/config.mjs"), "utf8");
  const zhChangelog = config.slice(config.indexOf('text: "更新日志"'));
  const zhSeven = zhChangelog.indexOf("/changelog/0.7");
  const zhSix = zhChangelog.indexOf("/changelog/0.6");
  assert.ok(zhSeven >= 0, "sidebarZh must link /changelog/0.7");
  assert.ok(zhSix > zhSeven, "0.7.x must appear before 0.6.x in sidebarZh");
  const enChangelog = config.slice(config.indexOf('text: "Changelog"'));
  const enSeven = enChangelog.indexOf("/en/changelog/0.7");
  const enSix = enChangelog.indexOf("/en/changelog/0.6");
  assert.ok(enSeven >= 0, "sidebarEn must link /en/changelog/0.7");
  assert.ok(enSix > enSeven, "0.7.x must appear before 0.6.x in sidebarEn");
});

test("knowledge guide no longer claims source-split as the default editor", () => {
  const zh = readDoc("guide/knowledge.md");
  assert.doesNotMatch(zh, /不是所见即所得/);
  assert.match(zh, /我的资料/);
  assert.match(zh, /最近访问/);
  assert.match(zh, /存入知识库/);
  assert.match(zh, /暂不可用/);
  const en = readDoc("en/guide/knowledge.md");
  assert.doesNotMatch(en, /This is not a WYSIWYG canvas/);
  assert.doesNotMatch(en, /Editing defaults to \*\*source \| preview\*\*/);
  assert.match(en, /Save to knowledge/);
  assert.match(en, /Not available yet/);
});

test("capability-status marks 知识库 正式可用 and hides 任务中心", () => {
  const text = readDoc("guide/capability-status.md");
  assert.match(text, /^\| 知识库 \| 正式可用 \|/m);
  assert.match(text, /^\| 任务中心 \| 隐藏 \/ 开发者 \|/m);
  assert.match(text, /账号菜单.*Agent 任务/);
  assert.doesNotMatch(text, /本地开发仍可见/);
});

test("skills guide documents builtin lock, inject, and 去对话", () => {
  const text = readDoc("guide/skills.md");
  assert.match(text, /不能卸载|不可卸载/);
  assert.match(text, /中文/);
  assert.match(text, /SKILL\.md/);
  assert.match(text, /去对话/);
  assert.match(text, /首页主轨/);
});
