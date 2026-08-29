/** @jsxImportSource react */
import { useState } from "react";
import { createRoot } from "react-dom/client";

import "../src/app/index.css";
import { setLocale } from "../src/i18n";
import type { PersonalLocalAgentApprovalMode } from "../src/app/lib/desktop";
import { LocalAgentComposerApprovalSelect } from "../src/react-app/domains/local-agents/local-agent-composer-approval-select-view";

setLocale("en");

function ApprovalFixture() {
  const [value, setValue] = useState<PersonalLocalAgentApprovalMode>("ask");
  return (
    <div
      className="flex min-h-screen items-end justify-center bg-dls-surface p-20"
      data-testid="local-agent-approval-interactive-fixture"
      data-approval-value={value}
    >
      <LocalAgentComposerApprovalSelect value={value} onChange={setValue} />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing Local Agent approval fixture root");
createRoot(root).render(<ApprovalFixture />);
