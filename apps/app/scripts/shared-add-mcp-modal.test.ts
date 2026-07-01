import { describe, expect, test } from "bun:test";

import {
  AddMcpModal,
  type AddMcpModalProps,
} from "../src/react-app/domains/shared/add-mcp-modal";

const props = {
  open: true,
  onClose: () => undefined,
  onAdd: () => undefined,
  busy: false,
  isRemoteWorkspace: false,
} satisfies AddMcpModalProps;

describe("shared add mcp modal contract", () => {
  test("exports a reusable modal component for settings and session domains", () => {
    expect(typeof AddMcpModal).toBe("function");
  });

  test("keeps the cross-domain props boundary small", () => {
    expect(Object.keys(props).sort()).toEqual([
      "busy",
      "isRemoteWorkspace",
      "onAdd",
      "onClose",
      "open",
    ]);
  });
});
