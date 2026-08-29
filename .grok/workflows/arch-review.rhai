let meta = #{
    name: "arch-review",
    description: "Review architecture health: package boundary violations, layering/coupling drift, and risk in recent changes. Read-only; findings are adversarially verified before reporting.",
    when_to_use: "User asks for an architecture review, to scan for boundary/layering drift, or to assess risk in recent changes.",
    phases: [
        #{ title: "Review", detail: "boundary, coupling, recent-change risk in parallel" },
        #{ title: "Verify", detail: "adversarial check of top findings" },
        #{ title: "Synthesize", detail: "prioritized report" },
    ],
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["location", "issue", "severity"],
                "properties": #{
                    "location": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "severity": #{ "type": "string", "enum": ["high", "medium", "low"] },
                    "evidence": #{ "type": "string" },
                    "recommendation": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let scope = if args == () { "" } else { args.scope };
let target_clause = if scope == () || scope == "" {
    "the current repo (read docs/Architecture.md for the intended package boundaries first)"
} else {
    scope
};

phase("Review");
let jobs = [
    #{
        prompt: "Review package boundaries and layering in " + target_clause + ". Use grep/read_file to check actual imports against the declared boundaries in docs/Architecture.md and package AGENTS.md. Look for: cross-domain direct store imports, shell importing beyond domains/<domain>/ barrel, packages/ui importing app state, packages/types importing runtime code, apps/orchestrator importing apps/server source. Report location (file:line), the violating import, and which boundary it crosses. An empty list is valid only after reading the boundary doc and grepping imports.",
        label: "review:boundaries",
        capability_mode: "read-only",
        output_schema: findings_schema,
    },
    #{
        prompt: "Review coupling and structural health in " + target_clause + ". Look for: circular dependencies, modules that import from many unrelated domains, oversized files (flag files over ~800 lines as low severity unless they're clearly cohesive), duplicated logic that should be shared, and dead/orphaned modules. Use grep and list_dir. Report location, the coupling problem, and evidence (import counts, file size). An empty list is valid only after actually scanning.",
        label: "review:coupling",
        capability_mode: "read-only",
        output_schema: findings_schema,
    },
    #{
        prompt: "Review recent changes for architecture risk in " + target_clause + ". Run `git log --oneline -20` and `git diff` against the merge base of the current branch (or HEAD~20 if unclear), and inspect changes that touch package boundaries, shared contracts (packages/types), server routes, desktop IPC, or config/profile paths. Report location, the risk introduced, and why it matters architecturally. An empty list is valid only after actually inspecting the diff.",
        label: "review:recent-changes",
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
    complete(#{ summary: "No architecture findings.", report: "# Architecture review\n\nNo findings." });
}

// Verify top findings (cap to keep the panel small).
phase("Verify");
let cap = if all.len() > 5 { 5 } else { all.len() };
let vjobs = [];
let idx = 0;
while idx < cap {
    let f = all[idx];
    vjobs.push(#{
        prompt: "Adversarially verify this architecture finding by reading the actual code/boundary doc: "
            + json_encode(f)
            + ". Default real=false. Set real=true only if you can independently confirm the violation with a concrete import path or file evidence. If the finding is intentional, documented, or a false positive, say so in reason.",
        label: "verify:" + idx.to_string(),
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
    idx += 1;
}
let verdicts = parallel(vjobs);

let confirmed = [];
let i = 0;
while i < verdicts.len() {
    let v = verdicts[i];
    if v != () && v.success && v.output.real == true {
        confirmed.push(all[i]);
    }
    i += 1;
}
// Findings beyond the verified cap stay reported but marked unverified.
let unverified = [];
let j = cap;
while j < all.len() {
    unverified.push(all[j]);
    j += 1;
}
if confirmed.len() == 0 && unverified.len() == 0 {
    complete(#{ summary: "Findings did not survive verification.", report: "# Architecture review\n\nNo confirmed findings." });
}

phase("Synthesize");
let synth_prompt = "Write an architecture review report in markdown from these verified findings (JSON):\n\n"
    + json_encode(confirmed);
if unverified.len() > 0 {
    synth_prompt += "\n\nThese additional findings were reported but not independently verified (JSON):\n\n" + json_encode(unverified);
}
synth_prompt += "\n\nSections: ## High severity, ## Medium severity, ## Low severity, ## Unverified (check manually). "
    + "For each finding give location, the problem, evidence, and the recommended fix. "
    + "End with a one-paragraph recommended order of attack. Output only markdown.";
let synth = agent(synth_prompt, #{ label: "synthesize:report", capability_mode: "read-only" });

let report = if synth != () && synth.success { synth.output } else { "Synthesis failed; raw: " + json_encode(confirmed) };
let p = write_scratch_file("report.md", report);
log(confirmed.len().to_string() + " confirmed / " + all.len().to_string() + " raw findings");
complete(#{
    summary: confirmed.len().to_string() + " confirmed, " + unverified.len().to_string() + " unverified",
    path: p,
    report: report,
    confirmed_count: confirmed.len(),
    raw_count: all.len(),
});
