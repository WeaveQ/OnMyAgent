import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "node:test";

import {
  BUNDLED_SKILL_PACKAGE_NAMES,
  CORE_PREINSTALL_SKILLS,
} from "./builtin-skills-policy.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(
  here,
  "../resources/bundled-skills/getworkbuddy/scripts/getworkbuddy.mjs",
);

describe("getworkbuddy bundled skill", () => {
  it("ships as a core preinstall package", () => {
    assert.ok(BUNDLED_SKILL_PACKAGE_NAMES.includes("getworkbuddy"));
    assert.ok(
      CORE_PREINSTALL_SKILLS.some(
        (entry) => entry.packageName === "getworkbuddy" && entry.skillName === "getworkbuddy",
      ),
    );
  });

  it("maps the Chinese team command to a no-write preview", async () => {
    let captured = null;
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      captured = {
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null,
      };
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        action: "would-add",
        committable: true,
        confirmationToken: "preview-token",
        package: {
          packageName: "ai-content-creator-team",
          displayName: "内容创作专家团",
          profession: "内容创作专家团",
          expertType: "team",
          leadAgentName: "ai-content-creator-team-lead",
          members: 7,
          skills: ["ai-content-production"],
        },
        destination: "/profile/experts/ai-content-creator-team",
        installedSkills: ["ai-content-production"],
        warnings: [],
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const result = await execFileAsync(
        process.execPath,
        [script, "导入专家团", "内容创作专家团", "--json"],
        {
          env: {
            ...process.env,
            ONMYAGENT_SERVER_URL: `http://127.0.0.1:${address.port}`,
            ONMYAGENT_SERVER_TOKEN: "test-token",
          },
        },
      );
      assert.equal(JSON.parse(result.stdout).action, "would-add");
      assert.deepEqual(captured, {
        method: "POST",
        url: "/third-party/workbuddy/import",
        authorization: "Bearer test-token",
        body: { query: "内容创作专家团", kind: "team", mode: "preview" },
      });
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
    }
  });

  it("commits only with the preview confirmation token", async () => {
    let captured = null;
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      captured = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        action: "added",
        package: {
          packageName: "senior-developer",
          displayName: "高级开发工程师",
          profession: "高级开发工程师",
          expertType: "agent",
          leadAgentName: "senior-developer",
          members: 1,
          skills: [],
        },
        destination: "/profile/experts/senior-developer",
        installedSkills: [],
        warnings: [],
        refresh: { skillLinksRefreshed: true, reloadEvents: 1 },
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      await execFileAsync(
        process.execPath,
        [script, "confirm", "senior-developer", "--token", "preview-token", "--type", "agent", "--json"],
        {
          env: {
            ...process.env,
            ONMYAGENT_SERVER_URL: `http://127.0.0.1:${address.port}`,
            ONMYAGENT_SERVER_TOKEN: "test-token",
          },
        },
      );
      assert.deepEqual(captured, {
        query: "senior-developer",
        kind: "agent",
        mode: "commit",
        confirmationToken: "preview-token",
      });
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
    }
  });

  it("refuses unauthenticated direct filesystem fallback", async () => {
    await assert.rejects(
      execFileAsync(process.execPath, [script, "list"], {
        env: { ...process.env, ONMYAGENT_SERVER_URL: "", ONMYAGENT_SERVER_TOKEN: "" },
      }),
      /must run inside an active OnMyAgent assistant or expert session/,
    );
  });
});
