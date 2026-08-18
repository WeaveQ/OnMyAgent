import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeGrokPromptInputFromDraft } from "../../app/src/react-app/shell/session-route/composer.ts";
import { buildGrokPromptFromRuntimeParts } from "../../server/src/services/grok-attachment-staging.ts";

const input = JSON.parse(process.argv[2] ?? "{}");
const name = String(input.name ?? "notes.md");
const mime = String(input.mime ?? "text/markdown");
const text = String(input.text ?? "");
const root = await mkdtemp(join(tmpdir(), "grok-attach-window-"));
const workspace = join(root, "workspace");
const dataRoot = join(root, "user-data");
await mkdir(workspace, { recursive: true });
await writeFile(join(workspace, "keep.txt"), "keep", "utf8");

const prompt = await composeGrokPromptInputFromDraft({
  mode: "prompt",
  parts: [],
  attachments: [{
    id: name,
    name,
    mimeType: mime,
    size: text.length,
    kind: mime.startsWith("image/") ? "image" : "file",
    file: new File([text], name, { type: mime }),
  }],
  text: "Summarize the attachment",
}, workspace, { messageId: "window-smoke" });

const blocks = await buildGrokPromptFromRuntimeParts({
  text: prompt.text,
  parts: prompt.parts,
  workspaceRoot: workspace,
  sessionId: "window-smoke",
  dataRoot,
});

const body = blocks[0]?.text ?? "";
const ok = Boolean(
  prompt.parts?.some((part) => part.type === "file")
  && body.includes(text)
  && !body.includes("The user uploaded the following files")
  && !body.includes(".onmyagent-runtime/grok-staging"),
);
process.stdout.write(`${JSON.stringify({
  ok,
  parts: prompt.parts?.map((part) => ({ type: part.type, filename: part.filename, mime: part.mime })),
  promptIncludesFileContent: body.includes(text),
})}\n`);
