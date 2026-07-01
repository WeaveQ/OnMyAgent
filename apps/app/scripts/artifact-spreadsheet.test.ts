import { describe, expect, it } from "bun:test";

import {
  parseSpreadsheet,
  serializeSpreadsheet,
} from "../src/react-app/domains/session/artifacts/artifact-spreadsheet-model";

describe("artifact spreadsheet model", () => {
  it("round-trips CSV edits", async () => {
    const rows = await parseSpreadsheet({ name: "artifact-eval.csv", content: { kind: "text", data: "name,revenue\nAda,10\n" } });
    rows[1]![1] = "11";
    const output = await serializeSpreadsheet("artifact-eval.csv", rows);
    expect(output).toEqual({ kind: "text", data: "name,revenue\nAda,11\n" });
  });

  it("parses quoted CSV cells and serializes escaped CSV cells", async () => {
    const rows = await parseSpreadsheet({
      name: "artifact-eval.csv?download=1",
      content: { kind: "text", data: 'name,note\nAda,"hello, world"\nGrace,"said ""hi"""\n' },
    });

    expect(rows).toEqual([
      ["name", "note"],
      ["Ada", "hello, world"],
      ["Grace", 'said "hi"'],
    ]);
    await expect(serializeSpreadsheet("artifact-eval.csv", [
      ["name", "note"],
      ["Ada", "hello, world"],
      ["Grace", 'said "hi"'],
      ["Linus", "multi\nline"],
    ])).resolves.toEqual({
      kind: "text",
      data: 'name,note\nAda,"hello, world"\nGrace,"said ""hi"""\nLinus,"multi\nline"\n',
    });
  });

  it("uses tab delimiters for TSV files", async () => {
    const rows = await parseSpreadsheet({
      name: "artifact-eval.tsv#preview",
      content: { kind: "text", data: "name\tscore\nAda\t10\n" },
    });

    expect(rows).toEqual([
      ["name", "score"],
      ["Ada", "10"],
    ]);
    await expect(serializeSpreadsheet("artifact-eval.tsv", [["name", "score"], ["Ada", "10"]]))
      .resolves.toEqual({ kind: "text", data: "name\tscore\nAda\t10\n" });
  });

  it("returns a single empty cell for empty text artifacts", async () => {
    await expect(parseSpreadsheet({ name: "empty.csv", content: { kind: "text", data: "" } }))
      .resolves.toEqual([[""]]);
    await expect(parseSpreadsheet({ name: "empty.csv", content: { kind: "binary", data: new ArrayBuffer(0) } }))
      .resolves.toEqual([[""]]);
  });

  it("does not parse binary spreadsheets in the built-in editor", async () => {
    await expect(parseSpreadsheet({ name: "artifact-eval.xlsx", content: { kind: "binary", data: new ArrayBuffer(0) } })).rejects.toThrow(
      "Binary spreadsheet editing is disabled",
    );
    await expect(serializeSpreadsheet("artifact-eval.xlsx", [["name", "revenue"]])).rejects.toThrow(
      "Binary spreadsheet editing is disabled",
    );
  });
});
