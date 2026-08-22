/**
 * Local OpenCode `tool` helper for generated knowledge plugins.
 * Keeping this helper beside the generated files avoids resolving a package
 * from the temporary sandbox config directory during OpenCode startup.
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
