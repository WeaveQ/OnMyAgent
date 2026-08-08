/**
 * WeCom (企业微信) connector — official wecom-cli + skill.
 */

export const PLUGIN_ID = "wecom";
export const OWNER = "onmyagent";
export const CLI_PACKAGE = "@wecom/cli";
export const CLI_BIN = "wecom-cli";
export const SKILL_ID = "wecom";

export const STATE_FILE = "state.json";
export const CREDENTIALS_FILE = "credentials.json";
/** wecom-cli writes encrypted bot credentials here (under config dir). */
export const BOT_ENC_FILE = "bot.enc";

export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
