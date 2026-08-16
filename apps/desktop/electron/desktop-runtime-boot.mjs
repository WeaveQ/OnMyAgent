import { assertOnMyAgentServerReady } from "./runtime-engine-state.mjs";

export { assertOnMyAgentServerReady };

/**
 * Composition-root helpers for first packaged runtime bootstrap.
 * engineStart stays on the direct desktop runtime — never onmyagent-orchestrator.
 *
 * @param {{
 *   readWorkspaceState: () => Promise<{
 *     selectedId?: string,
 *     activeId?: string,
 *     workspaces: Array<{ id?: string, path?: string, workspaceType?: string, name?: string, displayName?: string }>,
 *   }>,
 *   writeWorkspaceState: (next: object) => Promise<unknown>,
 *   runtimeManager: {
 *     engineStart: (workspaceRoot: string, options: { runtime: string, workspacePaths: string[] }) => Promise<unknown>,
 *     orchestratorWorkspaceActivate: (input: { workspacePath: string, name?: string | null }) => Promise<unknown>,
 *     onmyagentServerInfo: () => Promise<any>,
 *   },
 * }} deps
 */
export function createDesktopRuntimeBoot({
  readWorkspaceState,
  writeWorkspaceState,
  runtimeManager,
}) {
  let runtimeBootstrapPromise = null;

  async function bootRuntimeForSelectedWorkspace() {
    const list = await readWorkspaceState();
    const selectedId =
      list.selectedId || list.activeId || list.workspaces[0]?.id || "";
    const workspace = selectedId
      ? list.workspaces.find((entry) => entry?.id === selectedId)
      : list.workspaces[0];
    const workspaceRoot = String(workspace?.path ?? "").trim();
    if (!workspaceRoot || workspace?.workspaceType === "remote") {
      return { ok: true, skipped: true, reason: "no-local-workspace" };
    }

    const workspacePaths = [];
    for (const entry of list.workspaces) {
      if (entry?.workspaceType === "remote") continue;
      const workspacePath = String(entry?.path ?? "").trim();
      if (workspacePath && !workspacePaths.includes(workspacePath))
        workspacePaths.push(workspacePath);
    }
    if (!workspacePaths.includes(workspaceRoot))
      workspacePaths.unshift(workspaceRoot);

    let bootWorkspace = workspace;
    let bootWorkspaceRoot = workspaceRoot;
    let engine;
    try {
      engine = await runtimeManager.engineStart(workspaceRoot, {
        runtime: "direct",
        workspacePaths,
      });
    } catch (error) {
      const fallback = list.workspaces.find((entry) => {
        const candidatePath = String(entry?.path ?? "").trim();
        return (
          entry?.workspaceType !== "remote" &&
          candidatePath &&
          candidatePath !== workspaceRoot
        );
      });
      const fallbackRoot = String(fallback?.path ?? "").trim();
      if (!fallback || !fallbackRoot) throw error;
      console.warn(
        "[runtime] selected workspace failed during boot; trying fallback workspace",
        {
          selectedWorkspaceId: workspace?.id ?? null,
          fallbackWorkspaceId: fallback.id ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      const fallbackWorkspacePaths = [
        fallbackRoot,
        ...workspacePaths.filter(
          (entry) => entry !== fallbackRoot && entry !== workspaceRoot,
        ),
      ];
      engine = await runtimeManager.engineStart(fallbackRoot, {
        runtime: "direct",
        workspacePaths: fallbackWorkspacePaths,
      });
      bootWorkspace = fallback;
      bootWorkspaceRoot = fallbackRoot;
      await writeWorkspaceState({
        ...list,
        selectedId: String(fallback.id ?? ""),
        watchedId: String(fallback.id ?? ""),
      }).catch(() => undefined);
    }
    await runtimeManager
      .orchestratorWorkspaceActivate({
        workspacePath: bootWorkspaceRoot,
        name: bootWorkspace.name ?? bootWorkspace.displayName ?? null,
      })
      .catch(() => undefined);
    const onmyagentServer = assertOnMyAgentServerReady(
      await runtimeManager.onmyagentServerInfo(),
    );
    return {
      ok: true,
      skipped: false,
      engine,
      onmyagentServer,
      workspaceId: bootWorkspace.id ?? null,
    };
  }

  function ensureRuntimeBootstrap() {
    if (!runtimeBootstrapPromise) {
      runtimeBootstrapPromise = bootRuntimeForSelectedWorkspace().catch(
        (error) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return runtimeBootstrapPromise;
  }

  return {
    assertOnMyAgentServerReady,
    bootRuntimeForSelectedWorkspace,
    ensureRuntimeBootstrap,
    getRuntimeBootstrapPromise: () => runtimeBootstrapPromise,
    setRuntimeBootstrap: (task) => {
      runtimeBootstrapPromise = task;
    },
    hasRuntimeBootstrap: () => Boolean(runtimeBootstrapPromise),
  };
}
