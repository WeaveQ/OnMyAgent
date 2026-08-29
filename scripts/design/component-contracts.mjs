/**
 * Walk DESIGN.md `components.contracts` YAML against shipped default classes
 * of signature primitives, and flag global type sizes outside the even
 * YAML scale that are not listed in `typography.extra-named`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDesignYaml, resolveYamlRef } from "./design-yaml.mjs";

const defaultRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const SIGNATURES = {
  input: {
    file: "apps/app/src/components/ui/input.tsx",
    extract: extractFirstCnString,
  },
  "select-menu": {
    file: "apps/app/src/react-app/design-system/select-menu.tsx",
    extract: extractSelectMenuDefault,
  },
  tooltip: {
    file: "apps/app/src/components/ui/tooltip.tsx",
    extract: extractFirstCnString,
    forbidShadow: true,
  },
  "status-badge": {
    file: "apps/app/src/components/ui/status-badge.tsx",
    extract: extractStatusBadgeDefault,
  },
  "session-card": {
    file: "apps/app/src/components/ui/action-row.tsx",
    extract: extractSessionRowConversation,
  },
};

const HEIGHT_CLASS = {
  24: "h-6",
  28: "h-7",
  32: "h-8",
  36: "h-9",
  40: "h-10",
  44: "h-11",
  48: "h-12",
  56: "h-14",
  64: "h-16",
};

const RADIUS_CLASS = {
  3: "rounded-xs",
  6: "rounded-sm",
  8: "rounded-md",
  10: "rounded-lg",
  14: "rounded-xl",
  999: "rounded-full",
};

function extractFirstCnString(src) {
  const match = src.match(/className=\{cn\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/);
  return match ? match[1] : "";
}

function extractSelectMenuDefault(src) {
  const match = src.match(/const triggerClasses\s*=\s*\{[\s\S]*?default:\s*\n?\s*"([^"]+)"/);
  return match ? match[1] : "";
}

function extractStatusBadgeDefault(src) {
  const defaultsBlock = src.match(/statusBadgeVariants[\s\S]*?defaultVariants:\s*\{([^}]+)\}/);
  const block = defaultsBlock ? defaultsBlock[1] : "";
  const shapeKey = (block.match(/shape:\s*"([^"]+)"/) || [])[1] || "pill";
  const sizeKey = (block.match(/size:\s*"([^"]+)"/) || [])[1] || "sm";
  const shapeClass = classForCvaKey(src, "shape", shapeKey);
  const sizeClass = classForCvaKey(src, "size", sizeKey);
  const base = src.match(/statusBadgeVariants\s*=\s*cva\(\s*"([^"]+)"/);
  return [base?.[1], shapeClass, sizeClass].filter(Boolean).join(" ");
}

function classForCvaKey(src, group, key) {
  const cvaSrc = src.includes("statusBadgeVariants")
    ? (src.match(/statusBadgeVariants\s*=\s*cva\([\s\S]*?\n\)/) || [src])[0]
    : src;
  const groupBlock = cvaSrc.match(new RegExp(`${group}:\\s*\\{([^}]*)\\}`));
  if (!groupBlock) return "";
  const row = groupBlock[1].match(new RegExp(`${key}:\\s*"([^"]+)"`));
  return row ? row[1] : "";
}

function extractSessionRowConversation(src) {
  const match = src.match(/conversation:\s*"([^"]+)"/);
  return match ? match[1] : "";
}

function heightClass(px) {
  return HEIGHT_CLASS[px] || `h-[${px}px]`;
}

function radiusClass(px) {
  return RADIUS_CLASS[px] || null;
}

function surfaceClassFromRaw(raw) {
  if (typeof raw !== "string") return null;
  const match = raw.match(/^\{colors\.([A-Za-z0-9-]+)\}$/);
  return match ? `bg-dls-${match[1]}` : null;
}

function paddingTokens(raw, yaml) {
  const resolved = resolveYamlRef(yaml, raw);
  const str = typeof resolved === "string" ? resolved : typeof raw === "string" ? raw : "";
  return str.split(/\s+/).filter(Boolean);
}

export function evaluatePrimitiveDefault(id, className, yaml) {
  if (!yaml) {
    throw new Error("evaluatePrimitiveDefault requires parsed DESIGN YAML");
  }
  const contract = yaml.components?.contracts?.[id];
  if (!contract) {
    return [{ id, field: "unknown", detail: `no components.contracts.${id} in DESIGN.md` }];
  }
  const hits = [];
  const cls = className || "";
  const spec = SIGNATURES[id];

  if (contract.height != null) {
    const px = resolveYamlRef(yaml, contract.height);
    if (typeof px === "number") {
      const expected = heightClass(px);
      if (!cls.includes(expected)) {
        hits.push({
          id,
          field: "height",
          detail: `missing ${expected} from YAML height ${JSON.stringify(contract.height)} (${px}px)`,
        });
      }
    }
  }
  if (contract.radius != null) {
    const px = resolveYamlRef(yaml, contract.radius);
    if (typeof px === "number") {
      const expected = radiusClass(px);
      if (expected && !cls.includes(expected)) {
        hits.push({
          id,
          field: "radius",
          detail: `missing ${expected} from YAML radius ${JSON.stringify(contract.radius)} (${px}px)`,
        });
      }
    }
  }
  if (contract.surface != null) {
    const expected = surfaceClassFromRaw(contract.surface);
    if (expected && !cls.includes(expected)) {
      hits.push({
        id,
        field: "surface",
        detail: `missing ${expected} from YAML surface ${JSON.stringify(contract.surface)}`,
      });
    }
  }
  if (contract.padding != null) {
    for (const token of paddingTokens(contract.padding, yaml)) {
      if (!cls.includes(token)) {
        hits.push({
          id,
          field: "padding",
          detail: `missing ${token} from YAML padding ${JSON.stringify(contract.padding)}`,
        });
      }
    }
  }
  if (spec?.forbidShadow && /shadow-\[/.test(cls)) {
    hits.push({ id, field: "shadow", detail: "decorative shadow on Tooltip default" });
  }
  return hits;
}

function loadYaml(repoRoot) {
  return loadDesignYaml(join(repoRoot, "DESIGN.md"));
}

export function walkComponentContracts(repoRoot = defaultRoot, yaml = loadYaml(repoRoot)) {
  const mismatches = [];
  for (const [id, spec] of Object.entries(SIGNATURES)) {
    const src = readFileSync(join(repoRoot, spec.file), "utf8");
    const className = spec.extract(src);
    mismatches.push(...evaluatePrimitiveDefault(id, className, yaml));
  }
  return { mismatches };
}

function remToPx(rem) {
  return Math.round(Number(rem) * 16);
}

export function extraGlobalTypeSizes(repoRoot = defaultRoot, yaml = loadYaml(repoRoot)) {
  const css = readFileSync(join(repoRoot, "apps/app/src/app/index.css"), "utf8");
  const scale = new Set();
  const scaleMap = yaml.typography?.scale || {};
  for (const value of Object.values(scaleMap)) {
    if (typeof value === "number") scale.add(value);
  }
  const extraMap = yaml.typography?.["extra-named"] || yaml.typography?.extraNamed || {};
  for (const value of Object.values(extraMap)) {
    if (typeof value === "number") scale.add(value);
  }
  const extras = [];
  const varRe = /--dls-text-([\w-]+):\s*([\d.]+)rem/g;
  let match;
  while ((match = varRe.exec(css)) !== null) {
    const name = match[1];
    if (name === "primary" || name === "secondary" || name === "tertiary") continue;
    const px = remToPx(match[2]);
    if (!scale.has(px)) {
      extras.push({
        cssName: `--dls-text-${name}`,
        px,
        detail: `${px}px is outside typography.scale and typography.extra-named`,
      });
    }
  }
  return extras;
}

export function diffComponentContracts(repoRoot = defaultRoot) {
  const yaml = loadYaml(repoRoot);
  return {
    mismatches: walkComponentContracts(repoRoot, yaml).mismatches,
    extraTypeSizes: extraGlobalTypeSizes(repoRoot, yaml),
  };
}

export { SIGNATURES, loadYaml as loadDesignContractsYaml };
