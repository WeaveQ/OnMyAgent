/**
 * Agent picker open state, list load, keyboard navigation, and outside-click close.
 * Mechanical extract from ReactSessionComposer — no behavior changes.
 */
import { useEffect, useRef, useState } from "react";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type UseComposerAgentMenuInput = {
  listAgents: () => Promise<Agent[]>;
  onSelectAgent: (agent: string | null) => void;
};

export function useComposerAgentMenu(input: UseComposerAgentMenuInput) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [agentMenuIndex, setAgentMenuIndex] = useState(0);
  const agentItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!agentMenuOpen) return;
    void input.listAgents().then(setAgents).catch(() => setAgents([]));
  }, [agentMenuOpen, input.listAgents]);

  useEffect(() => {
    setAgentMenuIndex(0);
  }, [agentMenuOpen]);

  useEffect(() => {
    const target = agentItemRefs.current[agentMenuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [agentMenuIndex, agentMenuOpen]);

  useEffect(() => {
    if (!agentMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (agentMenuRef.current?.contains(target)) return;
      setAgentMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [agentMenuOpen]);

  /** Returns true if the agent menu consumed the key event. */
  const handleAgentMenuKeyDown = (event: ReactKeyboardEvent): boolean => {
    if (!agentMenuOpen) return false;
    const total = agents.length + 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAgentMenuIndex((current) => (current + 1) % total);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setAgentMenuIndex((current) => (current - 1 + total) % total);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const selected = agentMenuIndex === 0 ? null : agents[agentMenuIndex - 1]?.name ?? null;
      input.onSelectAgent(selected);
      setAgentMenuOpen(false);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setAgentMenuOpen(false);
      return true;
    }
    return false;
  };

  return {
    agents,
    agentMenuOpen,
    setAgentMenuOpen,
    agentMenuIndex,
    setAgentMenuIndex,
    agentItemRefs,
    agentMenuRef,
    handleAgentMenuKeyDown,
  };
}
