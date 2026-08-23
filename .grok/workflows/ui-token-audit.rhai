let meta = #{
    name: "ui-token-audit",
    description: "Scan UI code for design-token drift: hardcoded values, token mismatches, spacing/sizing inconsistencies. Read-only; produces a prioritized markdown report.",
    when_to_use: "User asks to audit UI, check design tokens, scan for hardcoded colors/spacing, or review Tailwind class consistency.",
    phases: [
        #{ title: "Scan", detail: "three read-only reviewers in parallel" },
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
                "required": ["file", "issue", "severity"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "line": #{ "type": "integer" },
                    "issue": #{ "type": "string" },
                    "severity": #{ "type": "string", "enum": ["high", "medium", "low"] },
                    "suggestion": #{ "type": "string" },
                },
            },
        },
    },
};

let scope = if args == () { "" } else { args.scope };
let scope_clause = if scope == "" {
    "the whole repo"
} else {
    scope
};

phase("Scan");
let jobs = [
    #{
        prompt: "Audit hardcoded colors in UI source under " + scope_clause + ". Use grep to find literal hex (#xxx, #xxxxxx), rgb()/rgba()/hsl(), and Tailwind color classes that bypass the project token system. Only report real source files (skip node_modules, dist, graphify-out, bundled marketplaces). For each finding give file, line, the literal value, and which token should replace it. Read DESIGN.md or the token definition first if one exists. An empty list is valid only after actually grepping.",
        label: "scan:hardcoded-colors",
        capability_mode: "read-only",
        output_schema: findings_schema,
    },
    #{
        prompt: "Audit spacing and sizing consistency in UI components under " + scope_clause + ". Use grep to find arbitrary pixel values (p-[Npx], m-[Npx], w-[Npx], h-[Npx], gap-[Npx]) and magic numbers that should use design tokens/spacing scale. Skip build output and deps. Report file, line, value, and the nearest token/scale step. Read DESIGN.md token table first. An empty list is valid only after actually grepping.",
        label: "scan:spacing-sizing",
        capability_mode: "read-only",
        output_schema: findings_schema,
    },
    #{
        prompt: "Audit component primitives for duplicated or inconsistent patterns under " + scope_clause + ": repeated button/badge/input/card class strings that should use a shared primitive, mixed size conventions within the same component family, and imports bypassing the packages/ui barrel. Read the component directories and packages/ui before answering. Report file, the pattern, and which primitive/token to consolidate on. An empty list is valid only after actually reading the code.",
        label: "scan:primitive-drift",
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
    complete(#{ summary: "No token drift found.", report: "# UI token audit\n\nNo findings." });
}

phase("Synthesize");
let synth = agent(
    "You are summarizing a UI design-token audit. Here are raw findings as JSON:\n\n"
        + json_encode(all)
        + "\n\nWrite a markdown report with these sections: ## High priority, ## Medium priority, ## Low priority. "
        + "Group repeated patterns (e.g. the same hardcoded color across 10 files) into one bullet that lists the files instead of 10 near-identical bullets. "
        + "Drop findings that look intentional (e.g. a value in a token definition file itself). "
        + "End with a one-paragraph recommended order of attack. Output only the markdown report.",
    #{ label: "synthesize:report", capability_mode: "read-only" }
);

let report = if synth != () && synth.success { synth.output } else { "Synthesis failed; raw findings: " + json_encode(all) };
let p = write_scratch_file("report.md", report);
log(all.len().to_string() + " raw findings synthesized");
complete(#{ summary: all.len().to_string() + " findings, report written", path: p, report: report, raw_count: all.len() });
