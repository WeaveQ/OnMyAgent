import { createBrowserHost } from "./browser-host.mjs";
import { createBrowserSafetyPolicy } from "./browser-safety-policy.mjs";
import { createNodeKernelManager } from "./node-kernel-manager.mjs";

export function createBrowserRuntime(options = {}) {
  const safety = createBrowserSafetyPolicy({
    requestApproval: options.requestApproval ?? (async () => false),
  });
  const host = options.host ?? createBrowserHost({
    createView: options.createView,
    authorize: (action) => safety.authorize(action),
    isViewVisible: options.isViewVisible,
    onTabCreated: options.onTabCreated,
    onTabDestroyed: options.onTabDestroyed,
    clipboard: options.clipboard,
    getSelectedTabId: options.getSelectedTabId,
    history: options.history,
    nameSession: options.nameSession,
    consoleLogs: options.consoleLogs,
  });
  const kernels = createNodeKernelManager({
    nodePath: options.nodePath,
    cwd: options.cwd,
    timeoutMs: options.kernelTimeoutMs,
    allowedModules: options.allowedModules,
    browserRequest: (method, params, context) => host.dispatch(method, params, context),
  });

  return {
    async dispatch(method, params, context) {
      if (method === "nodeReplWrite") {
        await kernels.configureBrowserSession(context.sessionId, context);
        return { value: await kernels.evaluate(context.sessionId, params?.code) };
      }
      if (method === "nodeReplReset") {
        await kernels.reset(context.sessionId);
        return { ok: true };
      }
      if (method === "sessionDeleted") {
        await kernels.reset(context.sessionId);
        const result = await host.dispatch("sessionDeleted", params ?? {}, context);
        return { ok: true, ...result };
      }
      return host.dispatch(method, params ?? {}, context);
    },
    async close() {
      await kernels.dispose();
      host.destroy();
    },
    host,
  };
}
