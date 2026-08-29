import { t } from "@/i18n";

/** Strip Electron's `Error invoking remote method '…': Error: ` wrapper. */
export function unwrapDesktopIpcError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  const match = text.match(
    /Error invoking remote method '[^']+': (?:Error:\s*)?([\s\S]+)$/i,
  );
  return (match?.[1] ?? text).trim();
}

export function formatAgentManagementDesktopError(raw: unknown): string {
  const inner = unwrapDesktopIpcError(raw);
  if (/Unsupported skill agent/i.test(inner)) {
    return t("skills.error_unsupported_agent");
  }
  if (/Skill source is missing SKILL\.md/i.test(inner)) {
    return t("skills.error_missing_skill_md");
  }
  if (/Skill directory not found/i.test(inner)) {
    return t("skills.error_directory_not_found");
  }
  if (/Unsupported skill action/i.test(inner)) {
    return t("skills.error_unsupported_action");
  }
  if (/Invalid skill directory/i.test(inner)) {
    return t("skills.error_invalid_directory");
  }
  if (/Unmanaged skill is in the app directory/i.test(inner)) {
    return t("skills.error_unmanaged_in_app_dir");
  }
  if (
    /not implemented yet|No handler registered|desktop helper is unavailable/i.test(
      inner,
    )
  ) {
    return t("plugins.connector_ipc_restart_hint");
  }
  return inner || t("skills.error_generic");
}
