/**
 * Local OpenCode `tool` helper for generated knowledge plugins.
 * Resolving `@opencode-ai/plugin` from a temp sandbox config dir hangs
 * project boot (bun/npm fetch). Keep this file next to the generated plugins.
 */

function schemaNode(spec) {
  return {
    ...spec,
    optional() {
      return schemaNode({ ...spec, optional: true });
    },
    describe(text) {
      return schemaNode({ ...spec, description: String(text ?? "") });
    },
  };
}

export function tool(definition) {
  return definition;
}

tool.schema = {
  string() {
    return schemaNode({ type: "string" });
  },
  boolean() {
    return schemaNode({ type: "boolean" });
  },
  enum(values) {
    return schemaNode({ type: "string", enum: values });
  },
};
