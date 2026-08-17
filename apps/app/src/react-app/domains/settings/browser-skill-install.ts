export const BROWSER_SKILL_INSTALL_UNIX =
  "curl -fsSL https://raw.githubusercontent.com/Tencent/BrowserSkill/main/install.sh | sh && bsk doctor";

export const BROWSER_SKILL_INSTALL_WINDOWS =
  "Install bsk.exe from https://github.com/Tencent/BrowserSkill/releases (see the Windows section at https://github.com/Tencent/BrowserSkill#quick-start), add it to PATH, then run: bsk doctor";

export function browserSkillFallbackInstallCommand(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
) {
  return /windows/i.test(String(userAgent ?? ""))
    ? BROWSER_SKILL_INSTALL_WINDOWS
    : BROWSER_SKILL_INSTALL_UNIX;
}
