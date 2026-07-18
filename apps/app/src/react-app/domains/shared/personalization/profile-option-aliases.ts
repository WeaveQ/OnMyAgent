/**
 * Canonical profile option ids after taxonomy collapse.
 * Old fine-grained option ids map here so persisted profiles + scoring stay consistent.
 * CJK historical labels live in settings/legacy-profile-options (i18n allowlist).
 */

/** Role: fine-grained → canonical dropdown value. */
export const PROFILE_ROLE_ALIASES: Record<string, string> = {
  data: "technology",
  design: "product",
  content: "operations",
  marketing: "operations",
  "customer-success": "sales",
  "logistics-ops": "supply-chain",
  warehouse: "supply-chain",
  procurement: "supply-chain",
  legal: "finance",
  admin: "hr",
  quality: "manufacturing-eng",
  research: "teacher",
};

/** Industry: fine-grained → canonical dropdown value. */
export const PROFILE_INDUSTRY_ALIASES: Record<string, string> = {
  software: "internet",
  ai: "internet",
  cloud: "internet",
  cybersecurity: "internet",
  telecom: "internet",
  semiconductors: "hardware",
  "digital-entertainment": "gaming",
  retail: "ecommerce",
  "cross-border": "ecommerce",
  livestream: "ecommerce",
  fmcg: "ecommerce",
  fashion: "ecommerce",
  beauty: "ecommerce",
  warehousing: "logistics",
  express: "logistics",
  freight: "logistics",
  "cold-chain": "logistics",
  "customs-trade": "logistics",
  procurement: "logistics",
  automotive: "manufacturing",
  "electronics-mfg": "manufacturing",
  machinery: "manufacturing",
  chemicals: "manufacturing",
  materials: "manufacturing",
  "content-creation": "media",
  advertising: "media",
  "short-video": "media",
  "livestream-media": "media",
  publishing: "media",
  "film-tv": "media",
  banking: "finance",
  securities: "finance",
  insurance: "finance",
  "asset-management": "finance",
  fintech: "finance",
  accounting: "consulting",
  "legal-services": "consulting",
  "hr-services": "consulting",
  k12: "education",
  "higher-ed": "education",
  vocational: "education",
  edtech: "education",
  training: "education",
  "public-service": "government",
  nonprofit: "government",
  hospitality: "travel",
  "local-life": "travel",
  "transport-passenger": "travel",
  aviation: "travel",
  sports: "travel",
};

const ID_ALIASES: Record<string, string> = {
  ...PROFILE_ROLE_ALIASES,
  ...PROFILE_INDUSTRY_ALIASES,
};

/**
 * Canonicalize a stored profile option id (or already-canonical value).
 * CJK label normalization is applied in settings/legacy-profile-options.
 */
export function canonicalizeProfileOptionValue(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return trimmed;
  return ID_ALIASES[trimmed] ?? trimmed;
}

export function canonicalizeProfileOptionValues(values: string[]): string[] {
  return Array.from(
    new Set(values.map(canonicalizeProfileOptionValue).filter(Boolean)),
  );
}
