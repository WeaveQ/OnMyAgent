/**
 * Open a workspace file in office overlay or OS default app (Electron).
 */
import {
  openDesktopPath,
  revealDesktopItemInDir,
} from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import {
  canEditArtifactTarget,
  openArtifactForEditing,
} from "../../capabilities/artifacts/open-artifact-for-editing";

/** Prefer in-app office bridge for office types; fall back to OS open / reveal. */
export async function openWorkspaceFileExternally(input: {
  absolutePath: string;
  fileName: string;
}): Promise<void> {
  const abs = input.absolutePath.trim();
  if (!abs || !isElectronRuntime()) return;
  try {
    if (canEditArtifactTarget({ preview: "", name: input.fileName })) {
      try {
        await openArtifactForEditing(abs);
        return;
      } catch {
        // Overlay unavailable — use OS default.
      }
    }
    await openDesktopPath(abs);
  } catch {
    try {
      await revealDesktopItemInDir(abs);
    } catch {
      // best-effort
    }
  }
}
