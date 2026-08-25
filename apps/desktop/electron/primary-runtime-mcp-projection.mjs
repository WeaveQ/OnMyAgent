const CONNECTOR_IDS = [
  "tencent-docs",
  "baidu-drive",
  "kdocs",
  "dingtalk",
  "tencent-meeting",
];

export function createDesktopConnectorMcpProjection(managers) {
  return async () => {
    const snapshots = await Promise.all(
      CONNECTOR_IDS.map(async (connectorId) =>
        readConnectorSnapshot(connectorId, managers[connectorId])),
    );
    return {
      descriptors: snapshots.flatMap((snapshot) => snapshot.descriptors),
      accounts: snapshots.map((snapshot) => snapshot.account),
      complete: snapshots.every((snapshot) => snapshot.complete),
    };
  };
}

async function readConnectorSnapshot(connectorId, manager) {
  try {
    const status = await manager.getStatus();
    const account = {
      connectorId,
      accountConnected: status.authorized === true,
      opencodeAvailable: status.mcpConfigured === true,
    };
    try {
      return {
        descriptors: await manager.getRuntimeMcpDescriptors(),
        account,
        complete: true,
      };
    } catch {
      return { descriptors: [], account, complete: false };
    }
  } catch {
    return {
      descriptors: [],
      account: { connectorId, accountConnected: false, opencodeAvailable: false },
      complete: false,
    };
  }
}
