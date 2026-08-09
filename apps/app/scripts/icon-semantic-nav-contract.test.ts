import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("semantic nav/menu/CTA icon contracts (live call sites)", () => {
  test("skills / connectors / channels / local-entry maps use label-matching Lucide", () => {
    const viewModel = read(
      "apps/app/src/react-app/domains/session/chat/session-page-sidebar-view-model.ts",
    );
    const sidePanel = read(
      "apps/app/src/react-app/domains/session/components/side-panel-pages.tsx",
    );
    const appSidebar = read(
      "apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx",
    );
    const pageRail = read(
      "apps/app/src/react-app/domains/session/chat/session-page-rail.tsx",
    );

    // Skills — not a document.
    expect(viewModel).toMatch(/skills:\s*Sparkles/);
    expect(viewModel).not.toMatch(/skills:\s*FileText/);
    expect(sidePanel).toMatch(/skills:\s*Sparkles/);
    expect(sidePanel).not.toMatch(/skills:\s*FileText/);
    expect(appSidebar).toMatch(/id: "skills"[\s\S]*?icon: Sparkles/);
    expect(appSidebar).not.toMatch(/id: "skills"[\s\S]*?icon: FileText/);

    // Connectors — plug family, not KeyRound/Zap as nav glyph.
    expect(viewModel).toMatch(/connectors:\s*Plug/);
    expect(viewModel).not.toMatch(/connectors:\s*Zap/);
    expect(sidePanel).toMatch(/connectors:\s*Plug/);
    expect(sidePanel).not.toMatch(/connectors:\s*Zap/);
    expect(appSidebar).toMatch(/id: "connectors"[\s\S]*?icon: Plug/);
    expect(appSidebar).not.toMatch(/id: "connectors"[\s\S]*?icon: KeyRound/);

    // Channels — messaging, not Network topology.
    expect(viewModel).toMatch(/channels:\s*MessagesSquare/);
    expect(viewModel).not.toMatch(/channels:\s*Network/);
    expect(sidePanel).toMatch(/channels:\s*MessagesSquare/);
    expect(sidePanel).not.toMatch(/channels:\s*Network/);
    expect(appSidebar).toMatch(/id: "channels"[\s\S]*?icon: MessagesSquare/);
    expect(pageRail).toMatch(/id: "channels"[\s\S]*?icon: MessagesSquare/);
    expect(pageRail).not.toMatch(/id: "channels"[\s\S]*?icon: Network/);

    // Local-entry menu (云手机分身) — not Expert person silhouette.
    expect(appSidebar).toMatch(
      /id: "personalAssistant"[\s\S]*?icon: Smartphone/,
    );
    expect(appSidebar).not.toMatch(
      /id: "personalAssistant"[\s\S]*?icon: UserRound/,
    );

    // Devices ≠ LocalAgent still holds.
    expect(viewModel).toMatch(/devices:\s*HardDrive/);
    expect(viewModel).toMatch(/localAgent:\s*MonitorSmartphone/);
  });

  test("create CTAs use semantic add glyphs (not bare Plus-only)", () => {
    const assistantPanel = read(
      "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel.tsx",
    );
    const automationNav = read(
      "apps/app/src/react-app/domains/messaging/automation-nav-sidebar.tsx",
    );
    const sidePanel = read(
      "apps/app/src/react-app/domains/session/components/side-panel-pages.tsx",
    );
    const appSidebar = read(
      "apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx",
    );

    // 新建任务 footer
    expect(assistantPanel).toMatch(
      /data-assistant-create="true"[\s\S]*?<MessageSquarePlus/,
    );
    expect(assistantPanel).not.toMatch(
      /data-assistant-create="true"[\s\S]*?<Plus className="size-4/,
    );

    // 创建专家 (market header)
    expect(sidePanel).toMatch(
      /session\.create_expert[\s\S]{0,80}|create_expert[\s\S]{0,200}/,
    );
    // Live button uses UserPlus immediately before create_expert label.
    expect(sidePanel).toMatch(
      /UserPlus data-icon="inline-start"[\s\S]{0,120}session\.create_expert/,
    );
    // 我的专家 is a collection view — Users, not UserPlus (create).
    expect(sidePanel).toMatch(
      /Users data-icon="inline-start"[\s\S]{0,120}session\.my_experts/,
    );

    // Expert self-create menu item already person-oriented.
    expect(assistantPanel).toContain("UserPlus");
    expect(assistantPanel).toContain("session.create_expert_yourself");

    // 自动化添加 footer
    expect(automationNav).toMatch(
      /data-automation-create="true"[\s\S]*?<ListPlus/,
    );
    expect(automationNav).not.toMatch(
      /data-automation-create="true"[\s\S]*?<Plus className="size-4/,
    );

    // Command-palette style new-task menu entry
    expect(appSidebar).toMatch(/id: "chat"[\s\S]*?icon: MessageSquarePlus/);
  });

  test("files source pills + store market tabs use label-matching Lucide", () => {
    const filesPage = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
    );
    const sidePanel = read(
      "apps/app/src/react-app/domains/session/components/side-panel-pages.tsx",
    );
    const storePage = read(
      "apps/app/src/react-app/domains/session/chat/session-page-store-page.tsx",
    );

    // Files source rail: Folder / MessageSquare / UserRound / Briefcase.
    expect(filesPage).toMatch(/case "uploads":[\s\S]*?return Folder/);
    expect(filesPage).toMatch(/case "task":[\s\S]*?return MessageSquare/);
    expect(filesPage).toMatch(/case "expert":[\s\S]*?return UserRound/);
    expect(filesPage).toMatch(/case "project":[\s\S]*?return Briefcase/);
    expect(filesPage).not.toMatch(/return FileUp/);
    expect(filesPage).not.toMatch(/return FileStack/);
    expect(filesPage).not.toMatch(/return FolderKanban/);
    // Expert tab is person silhouette, not robot (Bot reserved for agent maps).
    expect(filesPage).not.toMatch(/case "expert":[\s\S]*?return Bot/);

    // Store market primary tabs: experts person, skills Sparkles, plugins Package.
    expect(sidePanel).toMatch(
      /id: "experts"[\s\S]*?icon: UserRound/,
    );
    expect(sidePanel).toMatch(/id: "skills"[\s\S]*?icon: Sparkles/);
    expect(sidePanel).toMatch(/id: "plugins"[\s\S]*?icon: Package/);
    expect(sidePanel).not.toMatch(/id: "skills"[\s\S]*?icon: Puzzle/);
    expect(storePage).toMatch(/id: "skills"[\s\S]*?icon: Sparkles/);
    expect(storePage).not.toMatch(/icon: Puzzle/);
  });
});
