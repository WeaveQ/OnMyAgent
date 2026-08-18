/**
 * Fail-closed raw-evidence predicates for Grok closeout smokes.
 * Shared by the locked verifier and in-repo tests. Summary booleans are not
 * enough: walk persisted attempt text, JSON sidecars, and delete click flags.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const RUNTIME_COMMAND_FAILED = /Runtime command failed/i;
const EMPTY_EXPERT = /暂无专家会话|暫無專家會話/;

export function collectStrings(value, into = []) {
  if (typeof value === "string") {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
  return into;
}

function resolveRepoPath(repoRoot, maybePath) {
  if (typeof maybePath !== "string" || !maybePath.trim()) return null;
  return isAbsolute(maybePath) ? maybePath : join(repoRoot, maybePath);
}

export function resolveExistingArtifact(repoRoot, artifactPath) {
  const resolved = resolveRepoPath(repoRoot, artifactPath);
  if (!resolved || !existsSync(resolved)) return null;
  return resolved;
}

function loadSidecarText(repoRoot, artifactPath, into) {
  const resolved = resolveExistingArtifact(repoRoot, artifactPath);
  if (!resolved) return false;
  if (resolved.endsWith(".json")) {
    try {
      collectStrings(JSON.parse(readFileSync(resolved, "utf8")), into);
    } catch {
      into.push(readFileSync(resolved, "utf8"));
    }
    return true;
  }
  if (resolved.endsWith(".log") || resolved.endsWith(".txt")) {
    into.push(readFileSync(resolved, "utf8"));
    return true;
  }
  const jsonSibling = resolved.replace(/\.png$/i, ".json");
  if (jsonSibling !== resolved && existsSync(jsonSibling)) {
    loadSidecarText(repoRoot, jsonSibling, into);
  }
  return true;
}

function readJsonArtifact(repoRoot, artifactPath) {
  const resolved = resolveExistingArtifact(repoRoot, artifactPath);
  if (!resolved || !resolved.endsWith(".json")) return null;
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    return null;
  }
}

export function collectSmokeCorpus(smoke, repoRoot) {
  const texts = collectStrings(smoke);
  const walkArtifacts = (value) => {
    if (typeof value === "string") {
      loadSidecarText(repoRoot, value, texts);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walkArtifacts(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (/screenshot|log|artifact|sidecar|dom|dump/i.test(key)) {
          walkArtifacts(item);
        } else {
          walkArtifacts(item);
        }
      }
    }
  };
  walkArtifacts(smoke);
  return texts;
}

export function findDeleteClicked(smoke) {
  const hits = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (Object.prototype.hasOwnProperty.call(value, "deleteClicked")) {
      hits.push(value.deleteClicked);
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const item of Object.values(value)) walk(item);
  };
  walk(smoke);
  return hits;
}

function requireArtifact(repoRoot, artifactPath, label, reasons) {
  if (!resolveExistingArtifact(repoRoot, artifactPath)) {
    reasons.push(`${label} is missing: ${artifactPath || "(empty)"}`);
    return false;
  }
  return true;
}

export function evaluateElectronRawEvidence(smoke, repoRoot) {
  const reasons = [];
  const texts = collectSmokeCorpus(smoke, repoRoot).join("\n");
  if (RUNTIME_COMMAND_FAILED.test(texts)) {
    reasons.push("raw evidence contains Runtime command failed");
  }
  for (const [index, attempt] of (smoke?.attempts ?? []).entries()) {
    if (attempt?.ok !== true) continue;
    requireArtifact(repoRoot, attempt.screenshot, `attempt ${index + 1} screenshot`, reasons);
    requireArtifact(repoRoot, attempt.log, `attempt ${index + 1} log`, reasons);
    const sidecar = attempt.sidecar || attempt.dom || (
      typeof attempt.screenshot === "string"
        ? attempt.screenshot.replace(/\.png$/i, ".json")
        : ""
    );
    if (!requireArtifact(repoRoot, sidecar, `attempt ${index + 1} DOM sidecar`, reasons)) continue;
    const claimed = typeof attempt.reply === "string" ? attempt.reply.trim() : "";
    const sidecarText = [];
    loadSidecarText(repoRoot, sidecar, sidecarText);
    if (claimed && !sidecarText.join("\n").includes(claimed)) {
      reasons.push(`attempt ${index + 1} reply is not present in independent sidecar`);
    }
  }
  const deleteSemantics = smoke?.assertions?.deleteSemantics === true;
  if (deleteSemantics) {
    const sidecarPath = smoke?.details?.deleteSidecar
      || smoke?.details?.delete?.sidecar
      || smoke?.deleteSidecar;
    if (!requireArtifact(repoRoot, sidecarPath, "independent delete sidecar", reasons)) {
      return { ok: false, reasons };
    }
    const sidecar = readJsonArtifact(repoRoot, sidecarPath) ?? {};
    const sidecarClicks = findDeleteClicked(sidecar);
    if (!sidecarClicks.includes(true)) {
      reasons.push("independent delete sidecar does not record deleteClicked:true");
    }
  }
  const deleteClicks = findDeleteClicked(smoke);
  if (deleteSemantics && deleteClicks.some((clicked) => clicked === false)) {
    reasons.push("deleteSemantics is true but deleteClicked is false");
  }
  return { ok: reasons.length === 0, reasons };
}

export function evaluateGrokLiveRawEvidence(smoke, repoRoot) {
  const reasons = [];
  const expert = smoke?.expert;
  if (expert?.ok === true) {
    requireArtifact(repoRoot, expert.screenshot, "expert screenshot", reasons);
    const sidecar = expert.sidecar || expert.dom || (
      typeof expert.screenshot === "string"
        ? expert.screenshot.replace(/\.png$/i, ".json")
        : ""
    );
    if (!requireArtifact(repoRoot, sidecar, "independent Expert DOM sidecar", reasons)) {
      return { ok: reasons.length === 0, reasons };
    }
    const sidecarText = [];
    loadSidecarText(repoRoot, sidecar, sidecarText);
    const independent = sidecarText.join("\n");
    const claimed = typeof expert.reply === "string" ? expert.reply.trim() : "";
    if (!claimed) {
      reasons.push("expert.ok is true but no Expert reply was recorded");
    } else if (!independent.includes(claimed)) {
      reasons.push("expert reply is not present in independent sidecar");
    }
    if (EMPTY_EXPERT.test(independent) && !independent.includes(claimed)) {
      reasons.push("expert.ok is true but raw DOM is empty Expert state with no reply");
    }
  }
  const assistant = smoke?.assistant;
  if (assistant?.ok === true) {
    requireArtifact(repoRoot, assistant.screenshot, "assistant screenshot", reasons);
    const sidecar = assistant.sidecar || assistant.dom || (
      typeof assistant.screenshot === "string"
        ? assistant.screenshot.replace(/\.png$/i, ".json")
        : ""
    );
    if (sidecar) {
      requireArtifact(repoRoot, sidecar, "independent assistant DOM sidecar", reasons);
      const claimed = typeof assistant.reply === "string" ? assistant.reply.trim() : "";
      const sidecarText = [];
      loadSidecarText(repoRoot, sidecar, sidecarText);
      if (claimed && !sidecarText.join("\n").includes(claimed)) {
        reasons.push("assistant reply is not present in independent sidecar");
      }
    }
  }
  const assistantTexts = collectSmokeCorpus(smoke?.assistant ?? {}, repoRoot).join("\n");
  if (RUNTIME_COMMAND_FAILED.test(assistantTexts)) {
    reasons.push("assistant raw evidence contains Runtime command failed");
  }
  return { ok: reasons.length === 0, reasons };
}

export function evaluateCloseoutRawEvidence(input) {
  const electron = evaluateElectronRawEvidence(input.electron, input.repoRoot);
  const grok = evaluateGrokLiveRawEvidence(input.grok, input.repoRoot);
  return {
    ok: electron.ok && grok.ok,
    reasons: [...electron.reasons, ...grok.reasons],
    electron,
    grok,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--electron") out.electron = argv[index + 1];
    if (token === "--grok") out.grok = argv[index + 1];
    if (token === "--repo") out.repo = argv[index + 1];
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repoRoot = args.repo || process.cwd();
  if (!args.electron || !args.grok) {
    process.stderr.write("usage: grok-closeout-raw-evidence.mjs --electron <json> --grok <json>\n");
    process.exit(2);
  }
  const electron = JSON.parse(readFileSync(
    resolveRepoPath(repoRoot, args.electron),
    "utf8",
  ));
  const grok = JSON.parse(readFileSync(resolveRepoPath(repoRoot, args.grok), "utf8"));
  const result = evaluateCloseoutRawEvidence({ electron, grok, repoRoot });
  if (!result.ok) {
    process.stderr.write(`RAW_EVIDENCE_FAIL: ${result.reasons.join("; ")}\n`);
    process.exit(1);
  }
  process.stdout.write("RAW_EVIDENCE_PASS\n");
}

const invoked = process.argv[1] && process.argv[1].endsWith("grok-closeout-raw-evidence.mjs");
if (invoked) main();
