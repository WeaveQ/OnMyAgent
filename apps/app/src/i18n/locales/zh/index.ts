/**
 * 中文（简体）翻译
 * 产品名称保留英文：OnMyAgent；勿对客暴露底层 OpenCode 引擎名
 * Skills：用户可见文案统一为“技能”，必要技术名保留英文。
 * MCP：协议名称保留英文，不翻译为"应用"
 * 翻译的术语：命令(Commands)、插件(Plugins)、会话(Sessions)、应用(Apps)
 */

import app from "./app";
import accountMenu from "./account_menu";
import blueprint from "./blueprint";
import common from "./common";
import composer from "./composer";
import config from "./config";
import contextPanel from "./context_panel";
import dashboard from "./dashboard";
import den from "./den";
import extensions from "./extensions";
import identities from "./identities";
import infiniteCanvas from "./infinite_canvas";
import mcp from "./mcp";
import modelBehavior from "./model_behavior";
import modelPicker from "./model_picker";
import onboarding from "./onboarding";
import plugins from "./plugins";
import providers from "./providers";
import providerAuth from "./provider_auth";
import questionModal from "./question_modal";
import session from "./session";
import settings from "./settings";
import share from "./share";
import shareSkillDestination from "./share_skill_destination";
import sidebar from "./sidebar";
import skills from "./skills";
import status from "./status";
import system from "./system";
import time from "./time";
import workspace from "./workspace";
import workspaceList from "./workspace_list";
import action from "./action";
import welcome from "./welcome";
import featurePreview from "./feature_preview";
import automation from "./automation";
import nav from "./nav";
import assistant from "./assistant";
import profile from "./profile";
import store from "./store";
import agents from "./agents";
import agentManager from "./agent_manager";
import localAgent from "./local_agent";
import sessionArchive from "./session_archive";
import messaging from "./messaging";
import files from "./files";
import panelTabs from "./panel_tabs";
import message from "./message";
import debug from "./debug";

export default {
  ...app,
  ...accountMenu,
  ...blueprint,
  ...common,
  ...composer,
  ...config,
  ...contextPanel,
  ...dashboard,
  ...den,
  ...extensions,
  ...identities,
  ...infiniteCanvas,
  ...mcp,
  ...modelBehavior,
  ...modelPicker,
  ...onboarding,
  ...plugins,
  ...providers,
  ...providerAuth,
  ...questionModal,
  ...session,
  ...settings,
  ...share,
  ...shareSkillDestination,
  ...sidebar,
  ...skills,
  ...status,
  ...system,
  ...time,
  ...workspace,
  ...workspaceList,
  ...action,
  ...welcome,
  ...featurePreview,
  ...automation,
  ...nav,
  ...assistant,
  ...profile,
  ...store,
  ...agents,
  ...agentManager,
  ...localAgent,
  ...sessionArchive,
  ...messaging,
  ...files,
  ...panelTabs,
  ...message,
  ...debug,
} as const;
