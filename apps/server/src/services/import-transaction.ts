import { createHash, timingSafeEqual } from "node:crypto";

export type ImportTransactionAction = "add" | "update";

export type ImportTransactionPlan<TSummary> = {
  adapter: string;
  sourceId: string;
  sourceFingerprint: string;
  targetFingerprint: string;
  action: ImportTransactionAction;
  destinations: string[];
  conflicts: string[];
  warnings: string[];
  summary: TSummary;
};

export type ImportTransactionPreview<TSummary> = ImportTransactionPlan<TSummary> & {
  committable: boolean;
  confirmationToken: string;
};

export class ImportTransactionError extends Error {
  readonly code: "import_conflict" | "import_confirmation_required" | "import_plan_stale";
  readonly details?: unknown;

  constructor(
    code: "import_conflict" | "import_confirmation_required" | "import_plan_stale",
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ImportTransactionError";
    this.code = code;
    this.details = details;
  }
}

export function createImportTransactionPreview<TSummary>(
  plan: ImportTransactionPlan<TSummary>,
): ImportTransactionPreview<TSummary> {
  const normalized = {
    adapter: plan.adapter,
    sourceId: plan.sourceId,
    sourceFingerprint: plan.sourceFingerprint,
    targetFingerprint: plan.targetFingerprint,
    action: plan.action,
    destinations: [...plan.destinations].sort(),
    conflicts: [...plan.conflicts].sort(),
  };
  const confirmationToken = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
  return {
    ...plan,
    destinations: normalized.destinations,
    conflicts: normalized.conflicts,
    committable: normalized.conflicts.length === 0,
    confirmationToken,
  };
}

export function assertImportTransactionCommit<TSummary>(input: {
  preview: ImportTransactionPreview<TSummary>;
  confirmationToken?: string;
}): void {
  if (input.preview.conflicts.length > 0) {
    throw new ImportTransactionError(
      "import_conflict",
      "Import would overwrite assets not owned by this importer",
      { conflicts: input.preview.conflicts },
    );
  }
  const received = input.confirmationToken?.trim() ?? "";
  if (!received) {
    throw new ImportTransactionError(
      "import_confirmation_required",
      "Import preview confirmation token is required",
    );
  }
  const expectedBuffer = Buffer.from(input.preview.confirmationToken, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new ImportTransactionError(
      "import_plan_stale",
      "Import preview is stale or does not match the current source and destinations",
      { expectedPreview: input.preview },
    );
  }
}

export async function executeImportTransaction<TSummary, TStaged, TResult>(input: {
  preview: ImportTransactionPreview<TSummary>;
  confirmationToken?: string;
  stage: () => Promise<TStaged>;
  verifyStaged: (staged: TStaged) => Promise<void>;
  commit: (staged: TStaged) => Promise<TResult>;
  verifyCommitted: (result: TResult) => Promise<void>;
  cleanup: (staged: TStaged) => Promise<void>;
}): Promise<TResult> {
  assertImportTransactionCommit(input);
  let staged: TStaged | null = null;
  try {
    staged = await input.stage();
    await input.verifyStaged(staged);
    const result = await input.commit(staged);
    await input.verifyCommitted(result);
    return result;
  } catch (error) {
    if (staged !== null) await input.cleanup(staged).catch(() => undefined);
    throw error;
  }
}
