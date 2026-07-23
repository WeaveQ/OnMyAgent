// graphify OpenCode plugin
// Injects a knowledge graph reminder before bash tool calls when the graph exists.
//
// NOTE: Do NOT add the bare npm package name "graphify" to opencode.json plugin[].
// That resolves to an unrelated jQuery RGG library (exports a constructor Object),
// which crashes OpenCode plugin load with:
//   TypeError: fn is not a function ... is an instance of Object
//   at src/plugin/index.ts
import { existsSync } from "fs";
import { join } from "path";

export const GraphifyPlugin = async ({ directory }) => {
  let reminded = false;

  return {
    "tool.execute.before": async (input, output) => {
      if (reminded) return;
      if (!existsSync(join(directory, "graphify-out", "graph.json"))) return;

      if (input.tool === "bash") {
        output.args.command =
          'echo "[graphify] knowledge graph at graphify-out/. For focused questions, run \`graphify query \"<question>\"\` (scoped subgraph, usually much smaller than GRAPH_REPORT.md) instead of grepping raw files. Read GRAPH_REPORT.md only for broad architecture context." && ' +
          output.args.command;
        reminded = true;
      }
    },
  };
};

// OpenCode plugin loader expects a default export that is a factory function.
export default GraphifyPlugin;
