import { describe, expect, test } from "bun:test";

import { ShareWorkspaceModal } from "../src/react-app/domains/workspace/share-workspace-modal";
import { ShareWorkspaceAccessPanel } from "../src/react-app/domains/workspace/share-workspace-access-panel";
import type { ShareWorkspaceModalProps } from "../src/react-app/domains/workspace/workspace-modal-types";

const props = {
  open: true,
  onClose: () => undefined,
  workspaceName: "Demo",
  fields: [{ label: "URL", value: "http://127.0.0.1:4111" }],
} satisfies ShareWorkspaceModalProps;

describe("shared share workspace modal contract", () => {
  test("exports reusable modal pieces for session and workspace domains", () => {
    expect(typeof ShareWorkspaceModal).toBe("function");
    expect(typeof ShareWorkspaceAccessPanel).toBe("function");
  });

  test("keeps share modal props serializable across domain boundaries", () => {
    expect(props.fields).toEqual([{ label: "URL", value: "http://127.0.0.1:4111" }]);
    expect(props.workspaceName).toBe("Demo");
  });
});
