import { defineConfig } from "vitepress";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(configDir, "../../dist/docs");

const sidebar = [
  {
    text: "入门",
    items: [
      { text: "简介", link: "/" },
      { text: "快速开始", link: "/quickstart" },
      { text: "第一个任务", link: "/first-task" },
      { text: "下载与安装", link: "/download" },
      { text: "更新日志", link: "/changelog" },
    ],
  },
  {
    text: "功能指南",
    items: [
      { text: "界面与工作区", link: "/guide/overview" },
      { text: "会话", link: "/guide/sessions" },
      { text: "文件与产物", link: "/guide/files" },
      { text: "技能", link: "/guide/skills" },
      { text: "专家", link: "/guide/experts" },
      { text: "MCP / 连接", link: "/guide/mcp" },
      { text: "自动化", link: "/guide/automation" },
      { text: "审批与权限", link: "/guide/approvals" },
      { text: "模型与 BYOK", link: "/guide/models" },
      { text: "记忆 / 个人", link: "/guide/memory" },
      { text: "设置", link: "/guide/settings" },
    ],
  },
  {
    text: "平台",
    items: [
      { text: "三分总览", link: "/platform/" },
      { text: "OnMyAgent", link: "/platform/onmyagent" },
      { text: "OnMyBuddy", link: "/platform/onmybuddy" },
      { text: "OnMyCompany", link: "/platform/onmycompany" },
      { text: "试点组合 A/B/C", link: "/platform/pilot-combos" },
    ],
  },
  {
    text: "场景",
    items: [
      { text: "报告与纪要", link: "/scenarios/office-docs" },
      { text: "定时汇总", link: "/scenarios/automation-digest" },
      { text: "团队试点", link: "/scenarios/team-pilot" },
    ],
  },
  {
    text: "安装",
    items: [
      { text: "macOS", link: "/install/macos" },
      { text: "Windows", link: "/install/windows" },
      { text: "排障", link: "/install/troubleshooting" },
    ],
  },
  {
    text: "安全与 FAQ",
    items: [
      { text: "安全与数据", link: "/security" },
      { text: "FAQ", link: "/faq" },
    ],
  },
];

export default defineConfig({
  base: "/docs/",
  title: "OnMyAgent Docs",
  description:
    "本地优先的办公 Agent 工作台：快速开始、功能指南、平台三分、下载与安全。",
  lang: "zh-CN",
  srcExclude: ["**/plan/**"],
  outDir,
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "简介", link: "/" },
      { text: "快速开始", link: "/quickstart" },
      { text: "平台", link: "/platform/" },
      { text: "下载", link: "/download" },
    ],
    sidebar,
    search: {
      provider: "local",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/WeaveQ/OnMyAgent" },
    ],
    outline: { level: [2, 3] },
    docFooter: { prev: "上一页", next: "下一页" },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "主题",
  },
});
