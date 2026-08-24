import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canSubmitLocalAgentComposer,
  resolveLocalAgentComposerTextPresentation,
  shouldCommitLocalAgentAttachment,
} from "../src/react-app/domains/local-agents/local-agent-draft-composer";

const composerSource = readFileSync(
  join(import.meta.dir, "../src/react-app/domains/local-agents/local-agent-draft-composer.tsx"),
  "utf8",
);

describe("local agent draft composer reliability", () => {
  test("keeps ordinary text visible around resolved mentions", () => {
    expect(resolveLocalAgentComposerTextPresentation(false)).toEqual({
      mirrorColor: "transparent",
    });
    expect(resolveLocalAgentComposerTextPresentation(true)).toEqual({
      mirrorColor: "var(--dls-text, currentColor)",
      textareaColor: "transparent",
      textareaTextFillColor: "transparent",
    });
  });

  test("blocks send while an attachment is still uploading", () => {
    const base = {
      text: "send this",
      attachmentCount: 0,
      quoteCount: 0,
      disabled: false,
      submitting: false,
    };

    expect(canSubmitLocalAgentComposer({ ...base, uploading: 1 })).toBe(false);
    expect(canSubmitLocalAgentComposer({ ...base, uploading: 0 })).toBe(true);
  });

  test("does not commit a late upload into a new draft", () => {
    expect(shouldCommitLocalAgentAttachment("conversation-b", "conversation-a")).toBe(false);
    expect(shouldCommitLocalAgentAttachment("conversation-a", "conversation-a")).toBe(true);
    expect(composerSource).toContain("uploadCountsByDraftRef");
    expect(composerSource).toContain("draftKeyRef.current === uploadDraftKey");
  });

  test("keeps retryable upload failures visible without making an empty draft sendable", () => {
    expect(composerSource).toContain('role="alert"');
    expect(composerSource).toContain('data-testid="local-agent-upload-error"');
    expect(composerSource).toContain('<NoticeBox\n                tone="error"');
    expect(composerSource).toContain('size="xs"');
    expect(composerSource).not.toContain('size="sm"\n                  className="ml-auto h-6');
    expect(composerSource).toContain('t("system.error_action_retry")');
    expect(
      canSubmitLocalAgentComposer({
        text: "",
        attachmentCount: 0,
        quoteCount: 0,
        uploading: 0,
        disabled: false,
        submitting: false,
      }),
    ).toBe(false);
  });

  test("uses shared icon sizing and respects reduced motion", () => {
    expect(composerSource).not.toContain("size-5 shrink-0 rounded-md");
    expect(composerSource).toContain("motion-reduce:transition-none");
  });
});
