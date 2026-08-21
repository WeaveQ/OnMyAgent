import assert from "node:assert/strict";
import test from "node:test";
import {
  contentHash,
  validateContractSnapshot,
} from "./check-computer-use-contract.mjs";

const corePath = "native/HandsFree/Sources/ComputerUse/Core.swift";
const inputPath = "native/HandsFree/Sources/ComputerUse/InputService.swift";
const safeCore = "let strictMode = true\n";

function fixture() {
  return {
    contract: {
      schemaVersion: 1,
      sourceRoot: "native/HandsFree/Sources/ComputerUse",
      protectedFiles: {
        [corePath]: contentHash(safeCore),
      },
      dangerousApiRules: [
        {
          id: "hardware-cursor-warp",
          pattern: "\\bCGWarpMouseCursorPosition\\b",
          allowedFiles: [],
        },
        {
          id: "global-event-posting",
          pattern: "\\.post\\(tap:\\s*\\.cghidEventTap\\)",
          allowedFiles: [inputPath],
        },
      ],
    },
    files: new Map([
      [corePath, safeCore],
      [inputPath, "event.post(tap: .cghidEventTap)\n"],
    ]),
  };
}

test("accepts the locked core and explicit compatibility exception", () => {
  const { contract, files } = fixture();
  assert.deepEqual(validateContractSnapshot(contract, files), []);
});

test("rejects an unreviewed change to a protected file", () => {
  const { contract, files } = fixture();
  files.set(corePath, `${safeCore}let fallback = true\n`);
  assert.match(
    validateContractSnapshot(contract, files).join("\n"),
    /Protected Computer Use file changed/,
  );
});

test("rejects a dangerous API introduced outside its compatibility exception", () => {
  const { contract, files } = fixture();
  files.set(
    "native/HandsFree/Sources/ComputerUse/NewFeature.swift",
    "event.post(tap: .cghidEventTap)\n",
  );
  assert.match(
    validateContractSnapshot(contract, files).join("\n"),
    /API boundary violation \(global-event-posting\)/,
  );
});

test("rejects hardware cursor movement without exceptions", () => {
  const { contract, files } = fixture();
  files.set(
    "native/HandsFree/Sources/ComputerUse/CursorFallback.swift",
    "CGWarpMouseCursorPosition(.zero)\n",
  );
  assert.match(
    validateContractSnapshot(contract, files).join("\n"),
    /API boundary violation \(hardware-cursor-warp\)/,
  );
});

test("rejects a missing protected file", () => {
  const { contract, files } = fixture();
  files.delete(corePath);
  assert.match(
    validateContractSnapshot(contract, files).join("\n"),
    /Protected Computer Use file is missing/,
  );
});
