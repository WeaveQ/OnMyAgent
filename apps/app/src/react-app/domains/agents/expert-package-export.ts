import {
  exportExpertPackage,
  saveFile,
} from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import { t } from "../../../i18n";

export function expertPackageExportFileName(
  displayName: string,
  packageName: string,
): string {
  const raw =
    (displayName.trim() || packageName.trim() || "expert")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 80) || "expert";
  return raw.toLowerCase().endsWith(".zip") ? raw : `${raw}.zip`;
}

export type PickAndExportMineExpertResult =
  | { ok: true; destPath: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; message: string };

export async function pickAndExportMineExpertPackage(input: {
  packageName: string;
  displayName?: string;
}): Promise<PickAndExportMineExpertResult> {
  const packageName = input.packageName.trim();
  if (!packageName) {
    return { ok: false, message: t("store.export_expert_invalid") };
  }
  if (!isElectronRuntime()) {
    return { ok: false, message: t("store.export_expert_desktop_only") };
  }
  const destPath = await saveFile({
    title: t("store.export_expert"),
    defaultPath: expertPackageExportFileName(input.displayName ?? "", packageName),
    filters: [{ name: t("store.export_expert_filter"), extensions: ["zip"] }],
  });
  if (typeof destPath !== "string" || !destPath) return { ok: false, cancelled: true };
  const result = await exportExpertPackage({ packageName, destPath });
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, destPath: result.destPath };
}
