#!/usr/bin/env node
import {
  parseArgs,
  readBool,
} from "./cli-args.js";
import { printHelp } from "./cli-help.js";
import { resolveCliVersion } from "./cli-shared.js";
import { runApprovals } from "./cli-commands/approvals.js";
import { runDaemonCommand, runInstanceCommand, runWorkspaceCommand } from "./cli-commands/daemon.js";
import { runFiles } from "./cli-commands/files.js";
import { runStart } from "./cli-commands/start.js";
import { runStatus } from "./cli-commands/status.js";

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (readBool(args.flags, "help", false) || args.flags.get("help") === true) {
    printHelp();
    return;
  }
  if (
    readBool(args.flags, "version", false) ||
    args.flags.get("version") === true
  ) {
    console.log(await resolveCliVersion());
    return;
  }

  const command = args.positionals[0] ?? "start";
  if (command === "start") {
    await runStart(args);
    return;
  }
  if (command === "serve") {
    args.flags.set("tui", false);
    await runStart(args);
    return;
  }
  if (command === "daemon") {
    await runDaemonCommand(args);
    return;
  }
  if (command === "workspace" || command === "workspaces") {
    await runWorkspaceCommand(args);
    return;
  }
  if (command === "instance") {
    await runInstanceCommand(args);
    return;
  }
  if (command === "approvals") {
    await runApprovals(args);
    return;
  }
  if (command === "files") {
    await runFiles(args);
    return;
  }
  if (command === "status") {
    await runStatus(args);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
