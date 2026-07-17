export function createDomCuaRefStore() {
  const state = new Map();

  return {
    observe(tabId, nodes) {
      if (typeof tabId !== "string" || !tabId) throw new TypeError("DOM-CUA tabId is required");
      if (!Array.isArray(nodes)) throw new TypeError("DOM-CUA nodes must be an array");
      const generation = (state.get(tabId)?.generation ?? 0) + 1;
      const refs = new Map();
      const observed = nodes.map((node, index) => {
        const ref = `dom:${generation}:${index + 1}`;
        refs.set(ref, node);
        return { ...node, ref };
      });
      state.set(tabId, { generation, refs });
      return { generation, nodes: observed };
    },
    resolve(tabId, ref) {
      const node = state.get(tabId)?.refs.get(ref);
      if (!node) throw new Error(`DOM-CUA ref is stale: ${ref}`);
      return node;
    },
    invalidate(tabId) {
      const generation = (state.get(tabId)?.generation ?? 0) + 1;
      state.set(tabId, { generation, refs: new Map() });
    },
    clear() {
      state.clear();
    },
  };
}
