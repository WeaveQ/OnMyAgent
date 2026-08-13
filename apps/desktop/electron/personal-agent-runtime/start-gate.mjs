export function createPersonalAgentStartGate() {
  const blocks = new Map();
  function block(reason = "runtime_lifecycle") {
    const token = Symbol(String(reason));
    blocks.set(token, String(reason));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      blocks.delete(token);
    };
  }
  function assertAllowed() {
    if (blocks.size === 0) return;
    throw Object.assign(new Error("Local Agent starts are temporarily blocked by a runtime lifecycle operation"), {
      code: "LOCAL_AGENT_START_BLOCKED",
      reason: blocks.values().next().value ?? "runtime_lifecycle",
    });
  }
  return Object.freeze({ block, assertAllowed });
}
