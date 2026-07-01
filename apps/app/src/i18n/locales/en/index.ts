/**
 * English translations
 * Professional terms (Skills, Plugins, Commands, Sessions, OpenCode, OpenPackage, OnMyAgent) are NOT translated
 */
import app from "./app";
import action from "./action";
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
import welcome from "./welcome";
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
import status from "./status";
import system from "./system";
import time from "./time";
import workspace from "./workspace";
import workspaceList from "./workspace_list";
import panelTabs from "./panel_tabs";
import message from "./message";
import debug from "./debug";

export default {
  ...app,
  ...action,
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
  ...welcome,
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
  ...status,
  ...system,
  ...time,
  ...workspace,
  ...workspaceList,
  ...panelTabs,
  ...message,
  ...debug,
} as const;
