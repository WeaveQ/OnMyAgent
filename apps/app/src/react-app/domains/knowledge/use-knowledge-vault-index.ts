import { useCallback, useState } from "react";

import { rebuildKnowledgeVaultIndex } from "../../../app/lib/desktop";
import { t } from "../../../i18n";

function indexFailureTitle(reason: string): string {
  return /not declared|not implemented/i.test(reason)
    ? t("knowledge.index_restart")
    : t("knowledge.index_error");
}

export type KnowledgeVaultIndexNotice = {
  tone: "success" | "error";
  title: string;
};

export function useKnowledgeVaultIndex(input: {
  workspaceId?: string;
  expertId?: string;
  refresh: () => Promise<unknown>;
}) {
  const [indexing, setIndexing] = useState(false);
  const [notice, setNotice] = useState<KnowledgeVaultIndexNotice | null>(null);

  const rebuildIndex = useCallback(async () => {
    setIndexing(true);
    setNotice(null);
    try {
      const result = await rebuildKnowledgeVaultIndex({
        scope: "all",
        workspaceId: input.workspaceId,
        expertId: input.expertId,
      });
      if (!result?.ok) {
        const title = indexFailureTitle(String(result?.reason ?? ""));
        setNotice({ tone: "error", title });
        return title;
      }
      await input.refresh();
      setNotice({
        tone: "success",
        title: t("knowledge.index_done", { count: result.count ?? 0 }),
      });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const title = indexFailureTitle(message);
      setNotice({ tone: "error", title });
      return title;
    } finally {
      setIndexing(false);
    }
  }, [input.expertId, input.refresh, input.workspaceId]);

  return { indexing, rebuildIndex, notice };
}
