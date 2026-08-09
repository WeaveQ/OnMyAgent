/**
 * Recommended (desktop-managed) connectors: Feishu, OfficeCLI, DingTalk, etc.
 *
 * Market cards already show connect status. Composer "Connectors" previously
 * only listed built-in extensions + raw MCP config — so installed recommended
 * connectors never appeared there. This module probes desktop status and
 * returns the connected set for the composer panel.
 */
import {
  getBaiduDriveStatus,
  getDingtalkStatus,
  getKdocsStatus,
  getLarkCliConnectionStatus,
  getOfficeCliStatus,
  getTencentDocsStatus,
  getTencentMeetingStatus,
  getWecomStatus,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";

export type ManagedDesktopConnectorId =
  | "officecli"
  | "lark-cli"
  | "tencent-docs"
  | "baidu-drive"
  | "kdocs"
  | "dingtalk"
  | "wecom"
  | "tencent-meeting";

export type ManagedDesktopConnectorItem = {
  id: ManagedDesktopConnectorId;
  name: string;
  description: string;
  iconSrc: string;
  tryPrompts: string[];
  /** MCP server names this product may write — exclude from "Configured MCP". */
  mcpServerNames: string[];
};

type CatalogEntry = {
  id: ManagedDesktopConnectorId;
  iconSrc: string;
  /** Fallback MCP names when status.serverNames is empty. */
  defaultMcpServerNames: string[];
  name: () => string;
  description: () => string;
  tryPrompts: () => string[];
  isConnected: () => Promise<{
    connected: boolean;
    mcpServerNames?: string[];
  }>;
};

function isOfficeLikeInstalled(status: {
  installedVersion?: string | null;
  state?: string;
  usable?: boolean;
}): boolean {
  return (
    Boolean(status.installedVersion) &&
    (status.state === "installed" ||
      status.state === "update_available" ||
      status.usable === true)
  );
}

function isAuthConnected(status: {
  phase?: string;
  authorized?: boolean;
  serverNames?: string[];
}): { connected: boolean; mcpServerNames?: string[] } {
  const connected =
    status.phase === "connected" && status.authorized === true;
  return {
    connected,
    mcpServerNames: Array.isArray(status.serverNames)
      ? status.serverNames.filter(
          (name): name is string => typeof name === "string" && name.length > 0,
        )
      : undefined,
  };
}

const MANAGED_DESKTOP_CONNECTOR_CATALOG: readonly CatalogEntry[] = [
  {
    id: "officecli",
    iconSrc: "/connector-icons/officecli.png",
    defaultMcpServerNames: [],
    name: () => t("plugins.officecli_title"),
    description: () => t("plugins.officecli_description"),
    tryPrompts: () => [
      t("plugins.officecli_prompt_1"),
      t("plugins.officecli_prompt_2"),
      t("plugins.officecli_prompt_3"),
    ],
    isConnected: async () => {
      const status = await getOfficeCliStatus();
      return { connected: isOfficeLikeInstalled(status) };
    },
  },
  {
    id: "lark-cli",
    iconSrc: "/connector-icons/feishu.png",
    defaultMcpServerNames: ["lark-cli", "lark", "feishu"],
    name: () => t("plugins.larkcli_title"),
    description: () => t("plugins.larkcli_description"),
    tryPrompts: () => [
      t("plugins.larkcli_prompt_1"),
      t("plugins.larkcli_prompt_2"),
      t("plugins.larkcli_prompt_3"),
    ],
    isConnected: async () => {
      const connection = await getLarkCliConnectionStatus();
      return { connected: connection.phase === "connected_logged_in" };
    },
  },
  {
    id: "tencent-docs",
    iconSrc: "/connector-icons/tencent-docs.png",
    defaultMcpServerNames: ["tencent-docs"],
    name: () => t("plugins.tencent_docs_title"),
    description: () => t("plugins.tencent_docs_description"),
    tryPrompts: () => [
      t("plugins.tencent_docs_prompt_1"),
      t("plugins.tencent_docs_prompt_2"),
      t("plugins.tencent_docs_prompt_3"),
      t("plugins.tencent_docs_prompt_4"),
    ],
    isConnected: async () => isAuthConnected(await getTencentDocsStatus()),
  },
  {
    id: "baidu-drive",
    iconSrc: "/connector-icons/baidu-drive.png",
    defaultMcpServerNames: ["baidu-netdisk", "baidu-drive"],
    name: () => t("plugins.baidu_drive_title"),
    description: () => t("plugins.baidu_drive_description"),
    tryPrompts: () => [
      t("plugins.baidu_drive_prompt_1"),
      t("plugins.baidu_drive_prompt_2"),
      t("plugins.baidu_drive_prompt_3"),
      t("plugins.baidu_drive_prompt_4"),
    ],
    isConnected: async () => isAuthConnected(await getBaiduDriveStatus()),
  },
  {
    id: "kdocs",
    iconSrc: "/connector-icons/wps.png",
    defaultMcpServerNames: ["kdocs", "wps"],
    name: () => t("plugins.kdocs_title"),
    description: () => t("plugins.kdocs_description"),
    tryPrompts: () => [
      t("plugins.kdocs_prompt_1"),
      t("plugins.kdocs_prompt_2"),
      t("plugins.kdocs_prompt_3"),
      t("plugins.kdocs_prompt_4"),
    ],
    isConnected: async () => isAuthConnected(await getKdocsStatus()),
  },
  {
    id: "dingtalk",
    iconSrc: "/connector-icons/dingtalk.png",
    defaultMcpServerNames: ["dingtalk"],
    name: () => t("plugins.dingtalk_title"),
    description: () => t("plugins.dingtalk_description"),
    tryPrompts: () => [
      t("plugins.dingtalk_prompt_1"),
      t("plugins.dingtalk_prompt_2"),
      t("plugins.dingtalk_prompt_3"),
      t("plugins.dingtalk_prompt_4"),
    ],
    isConnected: async () => isAuthConnected(await getDingtalkStatus()),
  },
  {
    id: "wecom",
    iconSrc: "/connector-icons/wecom.png",
    defaultMcpServerNames: ["wecom"],
    name: () => t("plugins.wecom_title"),
    description: () => t("plugins.wecom_description"),
    tryPrompts: () => [
      t("plugins.wecom_prompt_1"),
      t("plugins.wecom_prompt_2"),
      t("plugins.wecom_prompt_3"),
      t("plugins.wecom_prompt_4"),
    ],
    isConnected: async () => isAuthConnected(await getWecomStatus()),
  },
  {
    id: "tencent-meeting",
    iconSrc: "/connector-icons/tencent-meeting.png",
    defaultMcpServerNames: ["tencent-meeting"],
    name: () => t("plugins.tencent_meeting_title"),
    description: () => t("plugins.tencent_meeting_description"),
    tryPrompts: () => [
      t("plugins.tencent_meeting_prompt_1"),
      t("plugins.tencent_meeting_prompt_2"),
      t("plugins.tencent_meeting_prompt_3"),
      t("plugins.tencent_meeting_prompt_4"),
    ],
    isConnected: async () => isAuthConnected(await getTencentMeetingStatus()),
  },
];

function toItem(
  entry: CatalogEntry,
  mcpServerNames: string[],
): ManagedDesktopConnectorItem {
  return {
    id: entry.id,
    name: entry.name(),
    description: entry.description(),
    iconSrc: entry.iconSrc,
    tryPrompts: entry.tryPrompts().filter(Boolean),
    mcpServerNames:
      mcpServerNames.length > 0 ? mcpServerNames : [...entry.defaultMcpServerNames],
  };
}

/**
 * Probe desktop-managed recommended connectors and return only connected ones.
 * No-op (empty) outside Electron — market cards already gate on desktop.
 */
export async function listConnectedManagedDesktopConnectors(): Promise<
  ManagedDesktopConnectorItem[]
> {
  if (!isDesktopRuntime()) return [];

  const results = await Promise.all(
    MANAGED_DESKTOP_CONNECTOR_CATALOG.map(async (entry) => {
      try {
        const result = await entry.isConnected();
        if (!result.connected) return null;
        return toItem(entry, result.mcpServerNames ?? []);
      } catch {
        // Missing IPC / unsupported platform — treat as not connected.
        return null;
      }
    }),
  );

  return results.filter((item): item is ManagedDesktopConnectorItem => item != null);
}

/** MCP names owned by a managed product row (dedupe vs Configured MCP list). */
export function managedDesktopConnectorMcpServerNames(
  items: Iterable<Pick<ManagedDesktopConnectorItem, "id" | "mcpServerNames">>,
): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    names.add(item.id);
    for (const server of item.mcpServerNames) {
      if (server) names.add(server);
    }
  }
  return names;
}

export function filterManagedDesktopConnectors(
  items: ManagedDesktopConnectorItem[],
  searchQuery: string,
): ManagedDesktopConnectorItem[] {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const haystack = `${item.name} ${item.description} ${item.id}`.toLowerCase();
    return haystack.includes(q);
  });
}
