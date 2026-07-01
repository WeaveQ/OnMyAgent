export type SessionArchiveSecretMatch = {
  rule: string;
  confidence: "definite" | "candidate";
  start: number;
  end: number;
  index: number;
  redacted: string;
};

export const SESSION_ARCHIVE_SECRETS_RULES_VERSION = "studio-secret-rules-v1";
export const SESSION_ARCHIVE_ACTIVE_SECRETS_RULES_VERSIONS = [SESSION_ARCHIVE_SECRETS_RULES_VERSION];

type SecretRule = {
  name: string;
  confidence: "definite" | "candidate";
  prefilters: string[];
  regex: RegExp;
  group?: number;
  validate?: (value: string) => boolean;
  mask: (value: string) => string;
};

const secretRules: SecretRule[] = [
  { name: "aws-access-key", confidence: "definite", prefilters: ["AKIA", "ASIA"], regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, mask: (value) => maskKeepEnds(value, 4, 4) },
  { name: "anthropic-key", confidence: "definite", prefilters: ["sk-ant-"], regex: /\bsk-ant-[0-9A-Za-z][0-9A-Za-z_-]{18,}/g, mask: (value) => maskKeepEnds(value, 7, 4) },
  { name: "openai-key", confidence: "definite", prefilters: ["sk-proj-", "sk-svcacct-", "sk-admin-"], regex: /\b(sk-(?:proj|svcacct|admin)-[0-9A-Za-z_-]{20,})(?:[^0-9A-Za-z_-]|$)/g, group: 1, mask: (value) => maskKeepEnds(value, value.startsWith("sk-proj-") ? 8 : 11, 4) },
  { name: "github-pat", confidence: "definite", prefilters: ["ghp_", "github_pat_"], regex: /\b(?:ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{40,})\b/g, mask: (value) => maskKeepEnds(value, 4, 4) },
  { name: "gitlab-pat", confidence: "definite", prefilters: ["glpat-"], regex: /\b(glpat-[0-9A-Za-z_-]{20,})(?:[^0-9A-Za-z_-]|$)/g, group: 1, mask: (value) => maskKeepEnds(value, 6, 4) },
  { name: "npm-token", confidence: "definite", prefilters: ["npm_"], regex: /\bnpm_[0-9A-Za-z]{36}\b/g, mask: (value) => maskKeepEnds(value, 4, 4) },
  { name: "pypi-token", confidence: "definite", prefilters: ["pypi-"], regex: /\b(pypi-AgEIcHlwaS5vcmcC[0-9A-Za-z_-]{69,})(?:[^0-9A-Za-z_-]|$)/g, group: 1, mask: (value) => maskKeepEnds(value, 21, 4) },
  { name: "huggingface-token", confidence: "definite", prefilters: ["hf_"], regex: /\bhf_[0-9A-Za-z]{30,}\b/g, mask: (value) => maskKeepEnds(value, 3, 4) },
  { name: "sendgrid-key", confidence: "definite", prefilters: ["SG."], regex: /\b(SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43})(?:[^0-9A-Za-z_-]|$)/g, group: 1, mask: (value) => maskKeepEnds(value, 3, 4) },
  { name: "slack-token", confidence: "definite", prefilters: ["xoxb-", "xoxa-", "xoxp-", "xoxr-", "xoxs-"], regex: /\bxox[baprs]-[0-9A-Za-z]{10,}(?:-[0-9A-Za-z]+)*/g, mask: (value) => maskKeepEnds(value, 5, 4) },
  { name: "stripe-secret", confidence: "definite", prefilters: ["sk_live_", "rk_live_"], regex: /\b[sr]k_live_[0-9A-Za-z]{16,}\b/g, mask: (value) => maskKeepEnds(value, 8, 4) },
  { name: "google-api-key", confidence: "definite", prefilters: ["AIza"], regex: /\b(AIza[0-9A-Za-z_-]{35})(?:[^0-9A-Za-z_-]|$)/g, group: 1, mask: (value) => maskKeepEnds(value, 4, 4) },
  { name: "private-key-block", confidence: "definite", prefilters: ["-----BEGIN"], regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, mask: () => "[redacted private key block]" },
  { name: "basic-auth-url", confidence: "candidate", prefilters: ["://"], regex: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/@]+:([^\s:/@]+)@[^\s/]+/g, group: 1, mask: (value) => maskKeepEnds(value, 0, 0) },
  { name: "jwt", confidence: "candidate", prefilters: ["eyJ"], regex: /\beyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+/g, mask: (value) => maskKeepEnds(value, 3, 0) },
  { name: "high-entropy-assignment", confidence: "candidate", prefilters: ["=", ":"], regex: /\b[a-z][a-z0-9_]{2,}\s*[=:]\s*['"]?([A-Za-z0-9+/_-]{20,}={0,2})['"]?/gi, group: 1, validate: highEntropyValue, mask: (value) => maskKeepEnds(value, 0, 4) },
];

export function scanSessionArchiveSecrets(text: string): SessionArchiveSecretMatch[] {
  const raw = scanRaw(text);
  const definite = raw.filter((match) => match.confidence === "definite");
  return raw.filter((match) => {
    if (match.confidence === "definite") return true;
    return !definite.some((candidate) => overlaps(match, candidate)) && !raw.some((candidate) => candidate.confidence === "candidate" && containsLonger(candidate, match));
  }).map((match, index) => ({ ...match, redacted: match.redacted || maskKeepEnds(text.slice(match.start, match.end), 0, 4), index }));
}

export function redactSessionArchiveSecrets(text: string): string {
  const raw = scanRaw(text);
  if (raw.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const span of mergeSpans(raw)) {
    result += text.slice(cursor, span.start);
    result += span.redacted;
    cursor = span.end;
  }
  result += text.slice(cursor);
  return result;
}

function scanRaw(text: string): SessionArchiveSecretMatch[] {
  const matches: SessionArchiveSecretMatch[] = [];
  for (const rule of secretRules) {
    if (rule.prefilters.length > 0 && !rule.prefilters.some((prefilter) => text.includes(prefilter))) continue;
    rule.regex.lastIndex = 0;
    for (const match of text.matchAll(rule.regex)) {
      const full = match[0];
      const group = rule.group ? match[rule.group] : full;
      if (!group) continue;
      const groupOffset = rule.group ? full.indexOf(group) : 0;
      const start = (match.index ?? 0) + groupOffset;
      const end = start + group.length;
      if (rule.validate && !rule.validate(group)) continue;
      matches.push({ rule: rule.name, confidence: rule.confidence, start, end, index: 0, redacted: rule.mask(group) });
    }
  }
  return matches.sort((left, right) => left.start === right.start ? right.end - left.end : left.start - right.start);
}

function mergeSpans(matches: SessionArchiveSecretMatch[]): SessionArchiveSecretMatch[] {
  const spans: SessionArchiveSecretMatch[] = [];
  for (const match of matches) {
    const last = spans.at(-1);
    if (last && match.start < last.end) {
      if (match.end > last.end) {
        last.end = match.end;
        last.redacted = "[redacted secret]";
      }
    } else {
      spans.push({ ...match });
    }
  }
  return spans;
}

function overlaps(left: SessionArchiveSecretMatch, right: SessionArchiveSecretMatch): boolean {
  return left.start < right.end && right.start < left.end;
}

function containsLonger(candidate: SessionArchiveSecretMatch, match: SessionArchiveSecretMatch): boolean {
  return candidate !== match && candidate.start <= match.start && candidate.end >= match.end && (candidate.start < match.start || candidate.end > match.end);
}

function maskKeepEnds(value: string, prefix: number, suffix: number): string {
  if (value.length <= prefix + suffix) return "[redacted]";
  return `${value.slice(0, prefix)}…${suffix > 0 ? value.slice(-suffix) : ""}`;
}

function highEntropyValue(value: string): boolean {
  const trimmed = value.replace(/=+$/, "");
  return trimmed.length >= 20 && shannonEntropy(trimmed) >= 3.5 && /[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed) && /[0-9]/.test(trimmed);
}

function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
