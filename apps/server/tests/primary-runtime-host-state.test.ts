import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquirePrimaryRuntimeRootOwnership,
  ensurePrimaryOpencodeHostIdentity,
  parsePrimaryOpencodeHostIdentity,
  readPrimaryOpencodeHostIdentity,
  resolvePrimaryRuntimeHostStatePath,
  resolvePrimaryRuntimeOwnerLockPath,
} from "../src/services/primary-runtime-host-state.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-host-state-"));
  roots.push(root);
  const dataRoot = join(root, "runtime-state-root");
  const workspace = join(root, "workspace");
  await Promise.all([mkdir(dataRoot), mkdir(workspace)]);
  return { root, dataRoot, workspace };
}

describe("primary runtime host state", () => {
  test("registers profiles, switches active profile, and preserves history", async () => {
    const target = await fixture();
    const firstHome = join(target.root, "home-a");
    const secondHome = join(target.root, "home-b");
    await Promise.all([mkdir(firstHome), mkdir(secondHome)]);
    await ensurePrimaryOpencodeHostIdentity({
      dataRoot: target.dataRoot,
      identity: { profileId: "profile-a", runtimeHome: `${firstHome}/` },
    });
    await ensurePrimaryOpencodeHostIdentity({
      dataRoot: target.dataRoot,
      identity: {
        profileId: "profile-b",
        runtimeHome: secondHome,
        sandboxProfile: "sandbox-b",
      },
    });
    expect(await readPrimaryOpencodeHostIdentity({ dataRoot: target.dataRoot }))
      .toEqual({
        profileId: "profile-b",
        runtimeHome: await realpath(secondHome),
        sandboxProfile: "sandbox-b",
      });
    const file = JSON.parse(await readFile(
      resolvePrimaryRuntimeHostStatePath(target.dataRoot),
      "utf8",
    ));
    expect(Object.keys(file.opencodeProfiles).sort()).toEqual(["profile-a", "profile-b"]);
  });

  test("rejects same-profile home conflicts and invalid policy keys", async () => {
    const target = await fixture();
    await ensurePrimaryOpencodeHostIdentity({
      dataRoot: target.dataRoot,
      identity: { profileId: "managed", runtimeHome: join(target.root, "home-a") },
    });
    await expect(ensurePrimaryOpencodeHostIdentity({
      dataRoot: target.dataRoot,
      identity: { profileId: "managed", runtimeHome: join(target.root, "home-b") },
    })).rejects.toMatchObject({ code: "primary_runtime_host_identity_conflict" });
    for (const identity of [
      { profileId: "managed", runtimeHome: "relative/home" },
      { profileId: "__proto__", runtimeHome: join(target.root, "home") },
      { profileId: "managed", runtimeHome: join(target.root, "home"), extra: true },
    ]) {
      await expect(parsePrimaryOpencodeHostIdentity(identity)).rejects.toMatchObject({
        code: "primary_runtime_host_policy_invalid",
      });
    }
  });

  test("canonicalizes a symlinked runtime home", async () => {
    const target = await fixture();
    const actual = join(target.root, "actual-home");
    const alias = join(target.root, "home-alias");
    await mkdir(actual);
    await symlink(actual, alias, "dir");
    expect(await parsePrimaryOpencodeHostIdentity({
      profileId: "managed",
      runtimeHome: alias,
    })).toEqual({ profileId: "managed", runtimeHome: await realpath(actual) });
  });

  test("fails closed for corrupt and unknown host state", async () => {
    const target = await fixture();
    const path = resolvePrimaryRuntimeHostStatePath(target.dataRoot);
    await mkdir(join(target.dataRoot, "runtime-state", "primary-runtime"), { recursive: true });
    for (const body of ["{", JSON.stringify({ version: 99 })]) {
      await writeFile(path, body, "utf8");
      await expect(readPrimaryOpencodeHostIdentity({ dataRoot: target.dataRoot }))
        .rejects.toMatchObject({ code: "primary_runtime_host_state_unavailable" });
    }
  });

  test("holds one SQLite writer owner until release and then reacquires", async () => {
    const target = await fixture();
    const first = await acquirePrimaryRuntimeRootOwnership({
      dataRoot: target.dataRoot,
      workspaces: [{ path: target.workspace }],
    });
    if (process.platform !== "win32") {
      expect((await stat(resolvePrimaryRuntimeOwnerLockPath(target.dataRoot))).mode & 0o777)
        .toBe(0o600);
    }
    await expect(acquirePrimaryRuntimeRootOwnership({
      dataRoot: target.dataRoot,
      workspaces: [{ path: target.workspace }],
    })).rejects.toMatchObject({ code: "primary_runtime_data_root_already_owned" });
    await first.release();
    const second = await acquirePrimaryRuntimeRootOwnership({
      dataRoot: target.dataRoot,
      workspaces: [{ path: target.workspace }],
    });
    await second.release();
  });

  test("rejects a primary runtime root inside any configured workspace", async () => {
    const target = await fixture();
    await expect(acquirePrimaryRuntimeRootOwnership({
      dataRoot: join(target.workspace, ".runtime"),
      workspaces: [{ path: target.workspace }],
    })).rejects.toMatchObject({ code: "primary_runtime_data_root_inside_workspace" });
  });

  test("rejects a symlinked data root that resolves inside a workspace before DB creation", async () => {
    if (process.platform === "win32") return;
    const target = await fixture();
    const inside = join(target.workspace, "runtime-state-target");
    const alias = join(target.root, "runtime-state-alias");
    await mkdir(inside);
    await symlink(inside, alias, "dir");
    await expect(acquirePrimaryRuntimeRootOwnership({
      dataRoot: alias,
      workspaces: [{ path: target.workspace }],
    })).rejects.toMatchObject({ code: "primary_runtime_data_root_inside_workspace" });
    await expect(readFile(join(
      inside,
      "runtime-state",
      "primary-runtime",
      "server-owner.sqlite",
    ))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
