import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { syncSessionArchive } from "../src/services/session-archive-sync.js";
import { openSessionArchiveStore } from "../src/services/session-archive.js";

const tmp = await mkdtemp(join(tmpdir(), "opencode-live-smoke-"));
try {
  const workspace = { id: "smoke", name: "smoke", path: tmp, kind: "local" } as any;
  const paths = { root: tmp, dbPath: join(tmp, "archive.sqlite") };
  const stats = await syncSessionArchive({
    workspace,
    paths,
    sourceRoots: [{ agent: "opencode", root: join(homedir(), ".local/share/opencode") }],
    mode: "resync",
  });
  console.log("SYNC_STATS", JSON.stringify(stats));
  const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
  const page = store.listSessions({ agent: "opencode", limit: 5 });
  store.close();
  console.log("OPENCODE_TOTAL", page.total);
  console.log("SAMPLE", JSON.stringify(page.sessions.slice(0, 3).map((s: any) => ({ id: s.id, display_name: s.display_name, message_count: s.message_count, cwd: s.cwd })), null, 2));
} finally {
  await rm(tmp, { recursive: true, force: true });
}
