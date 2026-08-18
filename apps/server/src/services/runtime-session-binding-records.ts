import {
  runtimeSessionBindingSchema,
  type RuntimeSessionBinding,
} from "@onmyagent/types/agent-runtime";

export type VerifiedOpenCodeSessionInventoryItem = {
  productSessionId: string;
  runtimeSessionId: string;
  cwd: string;
  profileId: string;
  runtimeHome: string;
  modelRef?: RuntimeSessionBinding["modelRef"];
  sandboxProfile?: RuntimeSessionBinding["sandboxProfile"];
  createdAt: number;
};

export type RuntimeSessionBindingBackfillFailure = {
  index: number;
  code:
    | "invalid_inventory_item"
    | "duplicate_product_session_id"
    | "duplicate_runtime_session_id"
    | "conflicting_existing_binding";
};

export type RuntimeSessionBindingBackfillResult = {
  bindings: RuntimeSessionBinding[];
  added: number;
  complete: boolean;
  failures: RuntimeSessionBindingBackfillFailure[];
};

type ParsedBackfillCandidate = {
  index: number;
  binding?: RuntimeSessionBinding;
};

export function planVerifiedOpenCodeInventoryBackfill(input: {
  existing: readonly RuntimeSessionBinding[];
  inventory: readonly VerifiedOpenCodeSessionInventoryItem[];
  workspaceId: string;
}): RuntimeSessionBindingBackfillResult {
  const candidates = input.inventory.map((item, index) =>
    parseBackfillCandidate({ item, index, workspaceId: input.workspaceId })
  );
  const failures = collectBackfillFailures(input.existing, candidates);
  const blockedIndexes = new Set(failures.map((failure) => failure.index));
  const bindings = candidates.flatMap((candidate) =>
    candidate.binding && !blockedIndexes.has(candidate.index)
      ? [candidate.binding]
      : []
  ).filter((binding) => !input.existing.some(
    (existing) => existing.productSessionId === binding.productSessionId,
  ));
  return {
    bindings,
    added: bindings.length,
    complete: failures.length === 0,
    failures,
  };
}

export function hasDuplicateRuntimeSessionIdentity(
  bindings: readonly RuntimeSessionBinding[],
): boolean {
  const products = new Set<string>();
  const runtimes = new Set<string>();
  for (const binding of bindings) {
    const runtime = runtimeSessionNativeIdentity(binding);
    if (products.has(binding.productSessionId) || runtimes.has(runtime)) return true;
    products.add(binding.productSessionId);
    runtimes.add(runtime);
  }
  return false;
}

export function runtimeSessionNativeIdentity(binding: RuntimeSessionBinding): string {
  return [
    binding.runtimeKind,
    binding.profileId,
    binding.runtimeHome,
    binding.runtimeSessionId,
  ].join("\0");
}

export function sameRuntimeSessionBinding(
  left: RuntimeSessionBinding,
  right: RuntimeSessionBinding,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseBackfillCandidate(input: {
  item: VerifiedOpenCodeSessionInventoryItem;
  index: number;
  workspaceId: string;
}): ParsedBackfillCandidate {
  const parsed = runtimeSessionBindingSchema.safeParse({
    productSessionId: input.item.productSessionId,
    runtimeKind: "opencode",
    runtimeSessionId: input.item.runtimeSessionId,
    workspaceId: input.workspaceId,
    cwd: input.item.cwd,
    profileId: input.item.profileId,
    runtimeHome: input.item.runtimeHome,
    ...(input.item.modelRef !== undefined ? { modelRef: input.item.modelRef } : {}),
    ...(input.item.sandboxProfile !== undefined
      ? { sandboxProfile: input.item.sandboxProfile }
      : {}),
    createdAt: input.item.createdAt,
    source: "legacy-opencode-backfill",
  });
  return parsed.success
    ? { index: input.index, binding: parsed.data }
    : { index: input.index };
}

function collectBackfillFailures(
  existing: readonly RuntimeSessionBinding[],
  candidates: readonly ParsedBackfillCandidate[],
): RuntimeSessionBindingBackfillFailure[] {
  const failures: RuntimeSessionBindingBackfillFailure[] = [];
  const productOwners = new Map<string, number[]>();
  const runtimeOwners = new Map<string, number[]>();
  for (const candidate of candidates) {
    if (!candidate.binding) {
      failures.push({ index: candidate.index, code: "invalid_inventory_item" });
      continue;
    }
    addOwner(productOwners, candidate.binding.productSessionId, candidate.index);
    addOwner(runtimeOwners, runtimeSessionNativeIdentity(candidate.binding), candidate.index);
    const sameProduct = existing.find(
      (binding) => binding.productSessionId === candidate.binding?.productSessionId,
    );
    if (sameProduct && !sameBindingIdentity(sameProduct, candidate.binding)) {
      failures.push({ index: candidate.index, code: "conflicting_existing_binding" });
    }
    const sameNative = existing.find(
      (binding) => runtimeSessionNativeIdentity(binding)
        === runtimeSessionNativeIdentity(candidate.binding!),
    );
    if (sameNative && sameNative.productSessionId !== candidate.binding.productSessionId) {
      failures.push({ index: candidate.index, code: "conflicting_existing_binding" });
    }
  }
  addDuplicateFailures(failures, productOwners, "duplicate_product_session_id");
  addDuplicateFailures(failures, runtimeOwners, "duplicate_runtime_session_id");
  return dedupeFailures(failures);
}

function addOwner(owners: Map<string, number[]>, key: string, index: number): void {
  const indices = owners.get(key);
  if (indices) indices.push(index);
  else owners.set(key, [index]);
}

function addDuplicateFailures(
  failures: RuntimeSessionBindingBackfillFailure[],
  owners: ReadonlyMap<string, number[]>,
  code: "duplicate_product_session_id" | "duplicate_runtime_session_id",
): void {
  for (const indexes of owners.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) failures.push({ index, code });
  }
}

function dedupeFailures(
  failures: RuntimeSessionBindingBackfillFailure[],
): RuntimeSessionBindingBackfillFailure[] {
  const keys = new Set<string>();
  return failures.filter((failure) => {
    const key = `${failure.index}\0${failure.code}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  }).sort((left, right) => left.index - right.index || left.code.localeCompare(right.code));
}

function sameBindingIdentity(
  left: RuntimeSessionBinding,
  right: RuntimeSessionBinding,
): boolean {
  return runtimeSessionNativeIdentity(left) === runtimeSessionNativeIdentity(right);
}
