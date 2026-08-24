import http from "node:http";

/**
 * Small in-process OnMyAgent HTTP surface for Local Agent route smokes.
 *
 * The renderer enters the desktop route before it reaches the Personal Local
 * Agent page. A desktop IPC mock alone is not enough: the route also resolves
 * the local OnMyAgent server and reads its workspace/session index. Keep this
 * fixture deliberately narrow and deterministic so the smoke still exercises
 * the real route and Local Agent composition without starting a production
 * server or engine.
 */
export async function startLocalAgentSmokeServer({
  workspaceId,
  workspaceRoot,
  workspaceName = "Local Agent Smoke Workspace",
  token = "local-agent-smoke-token",
  hostToken = "local-agent-smoke-host-token",
}) {
  const workspace = {
    id: workspaceId,
    name: workspaceName,
    displayName: workspaceName,
    path: workspaceRoot,
    preset: "starter",
    workspaceType: "local",
  };
  const json = (response, status, payload) => {
    response.writeHead(status, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-onmyagent-host-token, content-type",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
  };
  const server = http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, x-onmyagent-host-token, content-type",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      });
      response.end();
      return;
    }

    const url = new URL(request.url || "/", "http://127.0.0.1");
    const workspaceList = {
      items: [workspace],
      workspaces: [workspace],
      activeId: workspaceId,
    };
    const path = url.pathname;
    const workspacePath = `/workspace/${encodeURIComponent(workspaceId)}`;

    if (path === "/health") {
      json(response, 200, { ok: true, status: "ok" });
      return;
    }
    if (path === "/workspaces") {
      json(response, 200, workspaceList);
      return;
    }
    if (path === `${workspacePath}/activate`) {
      json(response, 200, { activeId: workspaceId, workspace });
      return;
    }
    if (path === `${workspacePath}/sessions`) {
      json(response, 200, { items: [], complete: true, failures: [] });
      return;
    }
    if (path === `${workspacePath}/events`) {
      json(response, 200, { items: [], cursor: 0 });
      return;
    }
    if (path === "/capabilities") {
      json(response, 200, { ok: true, capabilities: [] });
      return;
    }
    if (path === "/status") {
      json(response, 200, { ok: true, workspace });
      return;
    }
    if (path === "/runtime/versions") {
      json(response, 200, { ok: true, services: [] });
      return;
    }

    // Keep non-critical route probes deterministic. The Local Agent page uses
    // its desktop IPC bridge; an empty JSON response is enough for optional
    // server-side probes without masking route/bootstrap failures.
    json(response, 200, { ok: true, items: [], sessions: [], workspaces: [] });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Local Agent smoke server did not expose a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
    hostToken,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
