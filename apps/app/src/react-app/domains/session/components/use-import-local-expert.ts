import { useCallback, useRef, useState } from "react";

import {
  importExpertPackage,
  pickDirectory,
  pickFile,
} from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import {
  persistImportedMineExpert,
  pickAndExportMineExpertPackage,
  refreshExpertPackageQuery,
} from "../../agents";
import { useStatusToasts } from "../../shell-feedback";
import type { ExpertPackageImportFailureCode } from "@onmyagent/types/desktop-ipc";
import type { ExpertMarketplaceEntry } from "../../plugins";

function failureCopy(code: ExpertPackageImportFailureCode): string {
  if (code === "already_exists") return t("store.import_expert_exists");
  if (code === "path_escape") return t("store.import_expert_path_escape");
  if (code === "not_found") return t("store.import_expert_not_found");
  return t("store.import_expert_invalid");
}

export function useImportLocalExpert() {
  const { showToast } = useStatusToasts();
  const pendingPath = useRef<string | null>(null);
  const [overwriteName, setOverwriteName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runImport = useCallback(
    async (sourcePath: string, options: { overwrite?: boolean; asCopy?: boolean } = {}) => {
      if (!isElectronRuntime()) {
        showToast({ title: t("store.import_expert_desktop_only"), tone: "info" });
        return;
      }
      setBusy(true);
      try {
        const result = await importExpertPackage({
          sourcePath,
          overwrite: options.overwrite === true,
          asCopy: options.asCopy === true,
        });
        if (!result.ok) {
          if (result.code === "already_exists") {
            pendingPath.current = sourcePath;
            setOverwriteName(result.packageName ?? pathBasename(sourcePath));
            return;
          }
          showToast({
            title: t("store.import_expert_failed"),
            description: failureCopy(result.code),
            tone: "error",
          });
          return;
        }
        let registered = true;
        try {
          await persistImportedMineExpert({
            packageName: result.packageName,
            packagePath: result.path,
            displayName: result.displayName || result.packageName,
            description: result.description || "",
            skillIds: result.declaredSkills,
            userNote: result.rolePrompt,
            agentMemory: result.memory,
          });
        } catch (error) {
          registered = false;
          console.warn("[expert-import] failed to register mine expert", error);
        }
        await refreshExpertPackageQuery();
        const missing = result.missingSkills.filter(Boolean);
        showToast({
          title: t("store.import_expert_success", {
            name: result.displayName || result.packageName,
          }),
          description: !registered
            ? t("store.import_expert_registry_failed")
            : missing.length > 0
              ? t("store.import_expert_missing_skills", { skills: missing.join(", ") })
              : undefined,
          tone: !registered || missing.length > 0 ? "warning" : "success",
        });
      } catch (error) {
        showToast({
          title: t("store.import_expert_failed"),
          description: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  const pickAndImport = useCallback(
    async (kind: "zip" | "folder") => {
      if (!isElectronRuntime()) {
        showToast({ title: t("store.import_expert_desktop_only"), tone: "info" });
        return;
      }
      const picked =
        kind === "folder"
          ? await pickDirectory({ title: t("store.import_expert_folder") })
          : await pickFile({
              title: t("store.import_expert_zip"),
              filters: [{ name: t("store.import_expert_zip_filter"), extensions: ["zip"] }],
            });
      const sourcePath = Array.isArray(picked) ? picked[0] : picked;
      if (!sourcePath?.trim()) return;
      await runImport(sourcePath.trim());
    },
    [runImport, showToast],
  );

  const confirmOverwrite = useCallback(async () => {
    const sourcePath = pendingPath.current;
    setOverwriteName(null);
    pendingPath.current = null;
    if (!sourcePath) return;
    await runImport(sourcePath, { overwrite: true });
  }, [runImport]);

  const confirmCopy = useCallback(async () => {
    const sourcePath = pendingPath.current;
    setOverwriteName(null);
    pendingPath.current = null;
    if (!sourcePath) return;
    await runImport(sourcePath, { asCopy: true });
  }, [runImport]);

  const cancelOverwrite = useCallback(() => {
    pendingPath.current = null;
    setOverwriteName(null);
  }, []);

  const exportPackage = useCallback(
    async (expert: Pick<ExpertMarketplaceEntry, "packageName" | "displayName" | "source">) => {
      if (expert.source !== "mine") return;
      const outcome = await pickAndExportMineExpertPackage({
        packageName: expert.packageName,
        displayName: expert.displayName,
      });
      if (outcome.ok) {
        showToast({
          title: t("store.export_expert_success", { name: expert.displayName || expert.packageName }),
          tone: "success",
        });
        return;
      }
      if ("cancelled" in outcome && outcome.cancelled) return;
      showToast({
        title: t("store.export_expert_failed"),
        description: outcome.message,
        tone: "error",
      });
    },
    [showToast],
  );

  return {
    pickAndImport,
    exportPackage,
    overwriteName,
    confirmOverwrite,
    confirmCopy,
    cancelOverwrite,
    busy,
  };
}

function pathBasename(sourcePath: string): string {
  const parts = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? sourcePath;
}
