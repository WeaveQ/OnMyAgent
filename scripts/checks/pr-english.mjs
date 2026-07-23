#!/usr/bin/env node
/**
 * Gate: PR title, body (outside code fences), and commit subjects must not
 * contain CJK ideographs / kana. User-facing product copy still goes through
 * i18n locales — this only enforces English collaboration metadata on GitHub.
 *
 * Usage:
 *   node scripts/checks/pr-english.mjs --title "..." --body "..."
 *   PR_TITLE=... PR_BODY=... node scripts/checks/pr-english.mjs
 *   node scripts/checks/pr-english.mjs --commits "fix: a\nfeat: b"
 *   node scripts/checks/pr-english.mjs --self-test
 *
 * Exit 0 = pass, 1 = fail.
 */

const CJK_RE =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]/u;

/**
 * Strip fenced code blocks and inline code so pasted Chinese UI strings in
 * ``` screenshots / i18n keys do not trip the gate.
 */
export function stripCodeForEnglishGate(text) {
  const raw = typeof text === "string" ? text : "";
  return raw
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/\[[^\]]*\]\([^)]+\)/g, " ") // markdown links keep label only stripped of URL
    .replace(/https?:\/\/\S+/g, " ");
}

export function findCjkMatches(text, { max = 5 } = {}) {
  const source = typeof text === "string" ? text : "";
  if (!source) return [];
  const hits = [];
  for (const match of source.matchAll(
    new RegExp(CJK_RE.source, `${CJK_RE.flags}g`),
  )) {
    const index = match.index ?? 0;
    const start = Math.max(0, index - 12);
    const end = Math.min(source.length, index + match[0].length + 12);
    const snippet = source.slice(start, end).replace(/\s+/g, " ").trim();
    hits.push({ index, char: match[0], snippet });
    if (hits.length >= max) break;
  }
  return hits;
}

export function checkPrEnglish(input) {
  const title = (input.title ?? "").trim();
  const body = input.body ?? "";
  const commits = Array.isArray(input.commits)
    ? input.commits
    : typeof input.commits === "string"
      ? input.commits.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];

  const failures = [];

  if (!title) {
    failures.push({ field: "title", message: "PR title is required." });
  } else {
    const titleHits = findCjkMatches(title);
    if (titleHits.length > 0) {
      failures.push({
        field: "title",
        message: `PR title must be English (no CJK). Near: "${titleHits[0].snippet}"`,
      });
    }
  }

  const bodyPlain = stripCodeForEnglishGate(body);
  const bodyHits = findCjkMatches(bodyPlain);
  if (bodyHits.length > 0) {
    failures.push({
      field: "body",
      message: `PR description must be English outside code fences (no CJK). Near: "${bodyHits[0].snippet}"`,
    });
  }

  for (const subject of commits) {
    const hits = findCjkMatches(subject);
    if (hits.length > 0) {
      failures.push({
        field: "commit",
        message: `Commit subject must be English (no CJK): "${subject}"`,
      });
    }
  }

  return { ok: failures.length === 0, failures };
}

function parseArgs(argv) {
  const out = { title: process.env.PR_TITLE, body: process.env.PR_BODY, commits: process.env.PR_COMMITS, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--title") out.title = argv[++i] ?? "";
    else if (arg === "--body") out.body = argv[++i] ?? "";
    else if (arg === "--commits") out.commits = argv[++i] ?? "";
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function runSelfTest() {
  const cases = [
    {
      name: "english ok",
      input: { title: "fix(desktop): open automation settings", body: "Trigger AE before opening System Settings." },
      ok: true,
    },
    {
      name: "chinese title fails",
      input: { title: "修复自动化权限", body: "Hello" },
      ok: false,
    },
    {
      name: "chinese body fails",
      input: { title: "fix: automation", body: "点「去设置」后列表为空" },
      ok: false,
    },
    {
      name: "chinese only in code fence ok",
      input: {
        title: "fix: automation",
        body: "Reproduce:\n```\n设置 → 自动化 → 去设置\n```\nThen allow the prompt.",
      },
      ok: true,
    },
    {
      name: "chinese commit fails",
      input: { title: "fix: x", body: "ok", commits: ["fix: 修复权限"] },
      ok: false,
    },
  ];

  let failed = 0;
  for (const test of cases) {
    const result = checkPrEnglish(test.input);
    const pass = result.ok === test.ok;
    if (!pass) {
      failed += 1;
      console.error(`FAIL ${test.name}: expected ok=${test.ok}, got ok=${result.ok}`, result.failures);
    } else {
      console.log(`ok   ${test.name}`);
    }
  }
  if (failed > 0) {
    console.error(`self-test: ${failed} failed`);
    process.exit(1);
  }
  console.log("self-test: all passed");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/checks/pr-english.mjs [--title T] [--body B] [--commits "s1\\ns2"]
Env: PR_TITLE, PR_BODY, PR_COMMITS
`);
    process.exit(0);
  }
  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const result = checkPrEnglish({
    title: args.title,
    body: args.body,
    commits: args.commits,
  });

  if (result.ok) {
    console.log("pr-english: pass");
    process.exit(0);
  }

  console.error("pr-english: FAIL — collaboration metadata must be English (no Chinese/CJK in title, description, or commit subjects).");
  console.error("Product UI copy still uses i18n locales; this gate only applies to GitHub PR/commit text.");
  for (const failure of result.failures) {
    console.error(`  - [${failure.field}] ${failure.message}`);
  }
  console.error("Rewrite the PR title/body (and any non-English commit subjects) in English, then push.");
  process.exit(1);
}

const isMain =
  process.argv[1] &&
  (import.meta.url === new URL(process.argv[1], "file:").href ||
    process.argv[1].endsWith("pr-english.mjs"));
if (isMain) {
  main();
}
