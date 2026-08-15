import { defineConfig } from "vitepress";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(configDir, "../../dist/docs");
// Local default /docs/; GitHub project Pages sets DOCS_BASE=/OnMyAgent/docs/
function normalizeBase(raw) {
  const s = (raw || "/docs/").trim() || "/docs/";
  return s.endsWith("/") ? s : `${s}/`;
}
const base = normalizeBase(process.env.DOCS_BASE);

/** Chinese (default / root) — full handbook */
const sidebarZh = [
  {
    text: "入门指南",
    items: [
      { text: "简介", link: "/" },
      { text: "快速开始", link: "/quickstart" },
      { text: "第一个任务", link: "/first-task" },
      { text: "高效使用技巧", link: "/guide/efficient-tips" },
      { text: "下载与安装", link: "/download" },
      { text: "更新日志", link: "/changelog" },
    ],
  },
  {
    text: "安装",
    collapsed: true,
    items: [
      { text: "macOS", link: "/install/macos" },
      { text: "Windows", link: "/install/windows" },
      { text: "排障", link: "/install/troubleshooting" },
    ],
  },
  {
    text: "功能指南",
    collapsed: false,
    // Order mirrors product UI: main rail → channels → account menu → settings.
    // Rail: 首页 · 专家 · 自动 · 文件 · 市场 · Company（连接后）；项目入口已隐藏。bottom: 消息渠道。
    items: [
      { text: "界面与工作区", link: "/guide/overview" },
      { text: "工作区", link: "/guide/workspaces" },
      { text: "会话", link: "/guide/sessions" },
      { text: "专家", link: "/guide/experts" },
      { text: "自动化", link: "/guide/automation" },
      { text: "文件与产物", link: "/guide/files" },
      { text: "技能", link: "/guide/skills" },
      { text: "MCP / 连接", link: "/guide/mcp" },
      { text: "连接器与托管工具", link: "/guide/connectors" },
      { text: "企业连接", link: "/guide/company" },
      { text: "项目（即将推出）", link: "/guide/projects" },
      {
        text: "消息渠道",
        collapsed: true,
        items: [
          { text: "渠道总览", link: "/guide/channels" },
          { text: "微信", link: "/guide/channels-weixin" },
          { text: "飞书", link: "/guide/channels-feishu" },
          { text: "Telegram", link: "/guide/channels-telegram" },
          { text: "Discord", link: "/guide/channels-discord" },
        ],
      },
      { text: "Agent 管理", link: "/guide/agent-management" },
      { text: "Agent 对话", link: "/guide/agent-chat" },
      { text: "归档、搜索与导入", link: "/guide/archive" },
      { text: "浏览器与 Computer Use", link: "/guide/browser-computer-use" },
      { text: "审批与权限", link: "/guide/approvals" },
      { text: "模型与 BYOK", link: "/guide/models" },
      { text: "记忆 / 个人", link: "/guide/memory" },
      { text: "远程运行与沙箱", link: "/guide/remote-runtime" },
      { text: "设置", link: "/guide/settings" },
      { text: "功能与平台状态", link: "/guide/capability-status" },
    ],
  },
  {
    text: "场景与实践",
    collapsed: false,
    items: [
      { text: "场景使用说明", link: "/scenarios/usage-guide" },
      { text: "实践总览", link: "/scenarios/practice/" },
      { text: "1. 文件识别与整理", link: "/scenarios/practice/files" },
      { text: "2. 文档生成与编辑", link: "/scenarios/practice/docs" },
      { text: "3. 表格分析与汇总", link: "/scenarios/practice/data" },
      { text: "4. 内容选题与分发", link: "/scenarios/practice/content" },
      { text: "5. 每日/每周自动简报", link: "/scenarios/practice/daily-brief" },
      { text: "6. 创建与进化技能", link: "/scenarios/practice/skills-evolve" },
      { text: "7. 自动化持续推进", link: "/scenarios/practice/self-drive" },
      { text: "8. 会议纪要与行动项", link: "/scenarios/practice/meetings" },
      { text: "9. 云文档协作（可选）", link: "/scenarios/practice/tencent-docs" },
      { text: "报告与纪要", link: "/scenarios/office-docs" },
      { text: "定时汇总", link: "/scenarios/automation-digest" },
      { text: "团队试点", link: "/scenarios/team-pilot" },
    ],
  },
  {
    text: "安全与 FAQ",
    collapsed: true,
    items: [
      { text: "安全与数据", link: "/security" },
      { text: "FAQ", link: "/faq" },
    ],
  },
  {
    text: "产品套件",
    collapsed: true,
    items: [
      { text: "产品套件总览", link: "/platform/" },
      { text: "OnMyAgent", link: "/platform/onmyagent" },
      { text: "OnMyBuddy", link: "/platform/onmybuddy" },
      { text: "OnMyCompany", link: "/platform/onmycompany" },
      { text: "试点组合 A / B / C", link: "/platform/pilot-combos" },
    ],
  },
];

/** English — full route parity with the Chinese handbook */
const sidebarEn = [
  {
    text: "Get started",
    items: [
      { text: "Introduction", link: "/en/" },
      { text: "Quick start", link: "/en/quickstart" },
      { text: "Your first task", link: "/en/first-task" },
      { text: "Tips for working efficiently", link: "/en/guide/efficient-tips" },
      { text: "Download and installation", link: "/en/download" },
      { text: "Changelog", link: "/en/changelog" },
    ],
  },
  {
    text: "Installation",
    collapsed: true,
    items: [
      { text: "macOS", link: "/en/install/macos" },
      { text: "Windows", link: "/en/install/windows" },
      { text: "Troubleshooting", link: "/en/install/troubleshooting" },
    ],
  },
  {
    text: "Feature guides",
    collapsed: false,
    items: [
      { text: "Interface and workspaces", link: "/en/guide/overview" },
      { text: "Workspaces", link: "/en/guide/workspaces" },
      { text: "Sessions", link: "/en/guide/sessions" },
      { text: "Experts", link: "/en/guide/experts" },
      { text: "Automation", link: "/en/guide/automation" },
      { text: "Files and deliverables", link: "/en/guide/files" },
      { text: "Skills", link: "/en/guide/skills" },
      { text: "MCP and connections", link: "/en/guide/mcp" },
      { text: "Connectors and managed tools", link: "/en/guide/connectors" },
      { text: "Company connection", link: "/en/guide/company" },
      { text: "Projects (coming soon)", link: "/en/guide/projects" },
      {
        text: "Messaging channels",
        collapsed: true,
        items: [
          { text: "Channel overview", link: "/en/guide/channels" },
          { text: "WeChat", link: "/en/guide/channels-weixin" },
          { text: "Feishu", link: "/en/guide/channels-feishu" },
          { text: "Telegram", link: "/en/guide/channels-telegram" },
          { text: "Discord", link: "/en/guide/channels-discord" },
        ],
      },
      { text: "Agent management", link: "/en/guide/agent-management" },
      { text: "Agent chat", link: "/en/guide/agent-chat" },
      { text: "Archive, search, and import", link: "/en/guide/archive" },
      { text: "Browser and Computer Use", link: "/en/guide/browser-computer-use" },
      { text: "Approvals and permissions", link: "/en/guide/approvals" },
      { text: "Models and BYOK", link: "/en/guide/models" },
      { text: "Personal and memory", link: "/en/guide/memory" },
      { text: "Remote runtimes and sandboxing", link: "/en/guide/remote-runtime" },
      { text: "Settings", link: "/en/guide/settings" },
      { text: "Feature and platform status", link: "/en/guide/capability-status" },
    ],
  },
  {
    text: "Scenarios and practices",
    collapsed: false,
    items: [
      { text: "How to use scenarios", link: "/en/scenarios/usage-guide" },
      { text: "Practice overview", link: "/en/scenarios/practice/" },
      { text: "1. Identify and organize files", link: "/en/scenarios/practice/files" },
      { text: "2. Create and edit documents", link: "/en/scenarios/practice/docs" },
      { text: "3. Analyze and summarize spreadsheets", link: "/en/scenarios/practice/data" },
      { text: "4. Plan and distribute content", link: "/en/scenarios/practice/content" },
      { text: "5. Automate daily and weekly briefings", link: "/en/scenarios/practice/daily-brief" },
      { text: "6. Create and evolve skills", link: "/en/scenarios/practice/skills-evolve" },
      { text: "7. Keep work moving with automation", link: "/en/scenarios/practice/self-drive" },
      { text: "8. Meeting notes and action items", link: "/en/scenarios/practice/meetings" },
      { text: "9. Cloud document collaboration", link: "/en/scenarios/practice/tencent-docs" },
      { text: "Reports and meeting notes", link: "/en/scenarios/office-docs" },
      { text: "Scheduled digests", link: "/en/scenarios/automation-digest" },
      { text: "Team pilot", link: "/en/scenarios/team-pilot" },
    ],
  },
  {
    text: "Security and FAQ",
    collapsed: true,
    items: [
      { text: "Security and data", link: "/en/security" },
      { text: "FAQ", link: "/en/faq" },
    ],
  },
  {
    text: "Product suite",
    collapsed: true,
    items: [
      { text: "Product suite overview", link: "/en/platform/" },
      { text: "OnMyAgent", link: "/en/platform/onmyagent" },
      { text: "OnMyBuddy", link: "/en/platform/onmybuddy" },
      { text: "OnMyCompany", link: "/en/platform/onmycompany" },
      { text: "Pilot configurations A / B / C", link: "/en/platform/pilot-combos" },
    ],
  },
];

export default defineConfig({
  base,
  srcExclude: ["**/plan/**"],
  outDir,
  cleanUrls: true,
  // Prefer light handbook look; user can still toggle dark in theme switch.
  appearance: true,
  head: [
    // OMA product icons (same set as apps/app / desktop)
    // head hrefs are absolute site paths — include base (VitePress does not rewrite these)
    ["link", { rel: "icon", href: `${base}favicon.ico`, sizes: "any" }],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: `${base}favicon-32x32.png`,
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: `${base}favicon-16x16.png`,
      },
    ],
    [
      "link",
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: `${base}apple-touch-icon.png`,
      },
    ],
  ],
  // Shared chrome
  themeConfig: {
    // Crisp product mark (not the 32px favicon — that clips badly in the title bar)
    logo: "/logo.png",
    // No social icons in top bar (cleaner handbook chrome).
    socialLinks: [],
    search: {
      provider: "local",
    },
  },
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      title: "OnMyAgent",
      description:
        "本地优先的办公 Agent 工作台：快速开始、功能指南、平台三分、下载与安全。",
      themeConfig: {
        siteTitle: "OnMyAgent",
        nav: [
          { text: "简介", link: "/" },
          { text: "快速开始", link: "/quickstart" },
          { text: "下载", link: "/download" },
        ],
        sidebar: sidebarZh,
        outline: {
          level: [2, 3],
          label: "快速导航",
        },
        docFooter: { prev: "上一页", next: "下一页" },
        returnToTopLabel: "回到顶部",
        sidebarMenuLabel: "菜单",
        darkModeSwitchLabel: "主题",
        lightModeSwitchTitle: "切换到浅色",
        darkModeSwitchTitle: "切换到深色",
        langMenuLabel: "切换语言",
        search: {
          provider: "local",
          options: {
            translations: {
              button: {
                buttonText: "搜索",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                noResultsText: "没有结果",
                resetButtonTitle: "清除",
                footer: {
                  selectText: "选择",
                  navigateText: "切换",
                  closeText: "关闭",
                },
              },
            },
          },
        },
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      title: "OnMyAgent",
      description:
        "Local-first office Agent workbench: setup, feature guides, scenarios, security, and product status.",
      themeConfig: {
        siteTitle: "OnMyAgent",
        nav: [
          { text: "Introduction", link: "/en/" },
          { text: "Quick start", link: "/en/quickstart" },
          { text: "Download", link: "/en/download" },
        ],
        sidebar: sidebarEn,
        outline: {
          level: [2, 3],
          label: "On this page",
        },
        docFooter: { prev: "Previous", next: "Next" },
        returnToTopLabel: "Back to top",
        sidebarMenuLabel: "Menu",
        darkModeSwitchLabel: "Theme",
        lightModeSwitchTitle: "Switch to light",
        darkModeSwitchTitle: "Switch to dark",
        langMenuLabel: "Change language",
        search: {
          provider: "local",
          options: {
            translations: {
              button: {
                buttonText: "Search",
                buttonAriaLabel: "Search docs",
              },
              modal: {
                noResultsText: "No results",
                resetButtonTitle: "Clear",
                footer: {
                  selectText: "to select",
                  navigateText: "to navigate",
                  closeText: "to close",
                },
              },
            },
          },
        },
      },
    },
  },
});
