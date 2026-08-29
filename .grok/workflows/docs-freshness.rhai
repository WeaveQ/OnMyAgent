let meta = #{
    name: "docs-freshness",
    description: "Scan docs for stale commands, broken paths/references, and old branding/version drift against the actual repo. Read-only; produces a prioritized markdown report.",
    when_to_use: "User asks whether docs are up to date, to audit README/AGENTS/BUILD/Architecture, or to find stale commands and broken links.",
    phases: [
        #{ title: "Scan", detail: "commands, paths, branding/version in parallel" },
        #{ title: "Synthesize", detail: "dedupe and prioritize" },
    ],
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["doc", "issue", "severity"],
                "properties": #{
                    "doc": #{ "type": "string" },
                    "line": #{ "type": "integer" },
                    "issue": #{ "type": "string" },
                    "severity": #{ "type": "string", "enum": ["high", "medium", "low"] },
                    "fix": #{ "type": "string" },
                },
            },
        },
    },
};

let scope = if args == () { "" } else { args.scope };
let scope_clause = if scope == "" {
    "docs/, README.md, AGENTS.md, BUILD.md, DESIGN.md, SECURITY.md and package-level AGENTS.md"
} else {
    scope
};

phase("Scan");
let jobs = [
    #{
        prompt: "Audit documentation commands and config flags under " + scope_clause + ". For every shell command, script name, pnpm task, env var, and CLI flag mentioned, verify it exists in package.json, scripts/cli/, or the actual binary. Use grep/read_file to check. Report each stale or wrong command with doc, line, what the doc claims, and what actually exists. An empty list is valid only after actually cross-checking.",
        label: "scan:commands",
        capability_mode: "read-only",
        output_schema: findings_schema,
    },
    #{
        prompt: "Audit documentation references under " + scope_clause + ": file paths, package names, directory trees, section anchors, and cross-doc links. Verify each referenced path exists on disk and each section anchor target exists. Skip external http(s) links. Report doc, line, the broken reference, and the closest existing path/anchor. An empty list is valid only after actually checking.",
        label: "scan:paths-links",
        capability_mode: "read-only",
        output_schema: findings_schema,
    },
    #{
        prompt: "Audit documentation under " + scope_clause + " for stale product names, old version numbers, superseded roadmap claims, and references to branches/files that no longer match git. Compare version/branch claims against package.json and git branch -a. Report doc, line, the stale claim, and the current truth. Be conservative: only flag things you can confirm are wrong by reading the source. An empty list is valid only after actually checking.",
        label: "scan:branding-version",
        capability_mode: "read-only",
        output_schema: findings_schema,
    },
];
let results = parallel(jobs);

let all = [];
for r in results {
    if r != () && r.success && r.output.findings != () {
        for f in r.output.findings { all.push(f); }
    }
}
if all.len() == 0 {
    complete(#{ summary: "Docs look fresh.", report: "# Docs freshness\n\nNo stale references found." });
}

phase("Synthesize");
let synth = agent(
    "You are summarizing a docs-freshness audit. Raw findings as JSON:\n\n"
        + json_encode(all)
        + "\n\nWrite a markdown report: ## Must fix now (commands/paths that are wrong and will mislead), ## Should fix soon, ## Polish. "
        + "Merge duplicate findings about the same doc/section into one bullet. "
        + "For each item give the doc:line, what's wrong, and the concrete fix. "
        + "End with a one-paragraph summary. Output only markdown.",
    #{ label: "synthesize:report", capability_mode: "read-only" }
);

let report = if synth != () && synth.success { synth.output } else { "Synthesis failed; raw: " + json_encode(all) };
let p = write_scratch_file("report.md", report);
log(all.len().to_string() + " raw findings synthesized");
complete(#{ summary: all.len().to_string() + " doc issues, report written", path: p, report: report, raw_count: all.len() });
