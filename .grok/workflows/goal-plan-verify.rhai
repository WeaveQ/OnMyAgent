let meta = #{
    name: "goal-plan-verify",
    description: "Plan a goal with acceptance criteria, implement it in an isolated worktree, then adversarially verify against the criteria. Edits stay in the worktree; the parent workspace is not modified.",
    when_to_use: "User wants a goal planned and implemented with independent verification (the recurring plan -> implement -> adversarial verify loop).",
    phases: [
        #{ title: "Plan", detail: "goal + numbered acceptance criteria" },
        #{ title: "Implement", detail: "in an isolated worktree" },
        #{ title: "Verify", detail: "acceptance check + adversarial reviewer" },
    ],
};

// Canned-host and failed-agent results may carry unit instead of arrays;
// guard every array op so the script fails with data instead of a runtime error.
fn arr(v) {
    if type_of(v) == "array" { return v; }
    return [];
}
fn truthy(v) {
    return v == true;
}

let plan_schema = #{
    "type": "object",
    "required": ["title", "objective", "acceptance_criteria", "approach", "out_of_scope"],
    "properties": #{
        "title": #{ "type": "string" },
        "objective": #{ "type": "string" },
        "acceptance_criteria": #{
            "type": "array",
            "minItems": 2,
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["id", "criterion", "how_to_check"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "criterion": #{ "type": "string" },
                    "how_to_check": #{ "type": "string" },
                },
            },
        },
        "approach": #{
            "type": "array",
            "maxItems": 8,
            "items": #{ "type": "string" },
        },
        "out_of_scope": #{
            "type": "array",
            "maxItems": 8,
            "items": #{ "type": "string" },
        },
        "risk_notes": #{
            "type": "array",
            "maxItems": 6,
            "items": #{ "type": "string" },
        },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["summary", "files_changed", "tests_run", "done"],
    "properties": #{
        "summary": #{ "type": "string" },
        "files_changed": #{
            "type": "array",
            "maxItems": 40,
            "items": #{ "type": "string" },
        },
        "tests_run": #{
            "type": "array",
            "maxItems": 20,
            "items": #{
                "type": "object",
                "required": ["command", "result"],
                "properties": #{
                    "command": #{ "type": "string" },
                    "result": #{ "type": "string" },
                },
            },
        },
        "done": #{ "type": "boolean" },
        "notes": #{ "type": "string" },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["passed", "per_criterion", "regressions", "summary"],
    "properties": #{
        "passed": #{ "type": "boolean" },
        "per_criterion": #{
            "type": "array",
            "items": #{
                "type": "object",
                "required": ["id", "met", "evidence"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "met": #{ "type": "boolean" },
                    "evidence": #{ "type": "string" },
                },
            },
        },
        "regressions": #{
            "type": "array",
            "items": #{ "type": "string" },
        },
        "summary": #{ "type": "string" },
    },
};

let objective = if args == () { () } else { args.objective };
if objective == () || objective == "" {
    pause("verification", "Pass args.objective — the goal to plan, implement, and verify.");
}

phase("Plan");
let planner_prompt = "Write a concrete implementation plan for this goal in the current repo:\n\n"
    + objective
    + "\n\nRead AGENTS.md and the relevant package AGENTS.md / docs/Architecture.md first. "
    + "Produce 2-8 numbered acceptance criteria, each with an exact how_to_check (command, file to inspect, or behavior to exercise). "
    + "List approach steps and explicit out_of_scope items. Do not edit anything.";
let plan_r = agent(planner_prompt, #{
    label: "plan:goal",
    capability_mode: "read-only",
    output_schema: plan_schema,
});
if plan_r == () || !plan_r.success || plan_r.output == () {
    complete(#{ summary: "Planner failed; aborting.", error: "planner did not return a plan" });
}
let plan = plan_r.output;
let criteria = arr(plan.acceptance_criteria);
log("Plan: " + plan.title + " (" + criteria.len().to_string() + " criteria)");

phase("Implement");
let impl_prompt = "Implement the following plan in your isolated worktree. Make the smallest correct change. "
    + "Follow the repo's AGENTS.md rules (no unnecessary `any`, i18n via t(), run the relevant checks). "
    + "After editing, run the most targeted verification command(s) for the changed package and record them. "
    + "Report files_changed, tests_run (each command + result), and done=true only if all acceptance criteria are addressed.\n\n"
    + "PLAN:\n" + json_encode(plan);
let impl_r = agent(impl_prompt, #{
    label: "implement:worktree",
    capability_mode: "read-write",
    isolation_worktree: true,
    output_schema: impl_schema,
});
if impl_r == () || !impl_r.success || impl_r.output == () {
    complete(#{ summary: "Implementer failed.", plan: plan, error: "implementer did not return a result" });
}
let impl = impl_r.output;
let files_changed = arr(impl.files_changed);
log(files_changed.len().to_string() + " files changed; done=" + truthy(impl.done).to_string());

phase("Verify");
let verify_prompt = "You are an independent acceptance verifier. The implementer worked in an isolated worktree. "
    + "Inspect the actual changed files and run/read whatever checks you need (read-only). "
    + "For EACH acceptance criterion, set met=true ONLY with concrete evidence (file:line, command output). "
    + "A missing or failed check means met=false. Also list any regressions or breakage you find.\n\n"
    + "OBJECTIVE: " + objective + "\n\n"
    + "PLAN: " + json_encode(plan) + "\n\n"
    + "IMPLEMENTATION REPORT: " + json_encode(impl);
let adv_prompt = "You are an adversarial reviewer trying to refute that this implementation is correct and complete. "
    + "Assume it is wrong until evidence convinces you. Hunt for: edge cases missed, acceptance criteria technically met but behaviorally broken, "
    + "missing tests, missing i18n, boundary/layering violations, and changes that break unrelated flows. "
    + "Read the changed code and surrounding code before answering. Set passed=true only if you cannot find a real defect. "
    + "Record concrete regressions as strings.\n\n"
    + "OBJECTIVE: " + objective + "\n\n"
    + "PLAN: " + json_encode(plan) + "\n\n"
    + "IMPLEMENTATION REPORT: " + json_encode(impl);
let vresults = parallel([
    #{
        prompt: verify_prompt,
        label: "verify:acceptance",
        capability_mode: "read-only",
        output_schema: verdict_schema,
    },
    #{
        prompt: adv_prompt,
        label: "verify:adversarial",
        capability_mode: "read-only",
        output_schema: verdict_schema,
    },
]);

let v_acc = vresults[0];
let v_adv = vresults[1];
let acc_passed = false;
let adv_passed = false;
let acc_summary = "verifier did not return a result";
let adv_summary = "adversarial reviewer did not return a result";
if v_acc != () && v_acc.success && v_acc.output != () {
    acc_passed = v_acc.output.passed == true;
    acc_summary = v_acc.output.summary;
}
if v_adv != () && v_adv.success && v_adv.output != () {
    adv_passed = v_adv.output.passed == true;
    adv_summary = v_adv.output.summary;
}
let overall_passed = acc_passed && adv_passed && truthy(impl.done);

// Compose a markdown report.
let report = "# " + plan.title + "\n\n";
report += "**Objective:** " + plan.objective + "\n\n";
report += "**Status: " + (if overall_passed { "PASSED" } else { "NEEDS WORK" }) + "**\n\n";
report += "## Acceptance criteria\n\n";
let k = 0;
while k < criteria.len() {
    let c = criteria[k];
    report += "- **" + c.id + "**. " + c.criterion + " — _check: " + c.how_to_check + "_\n";
    k += 1;
}
report += "\n## Implementation\n\n" + impl.summary + "\n\n";
if files_changed.len() > 0 {
    report += "Files changed:\n";
    let m = 0;
    while m < files_changed.len() {
        report += "- `" + files_changed[m] + "`\n";
        m += 1;
    }
    report += "\n";
}
let tests_run = arr(impl.tests_run);
if tests_run.len() > 0 {
    report += "### Tests run\n\n";
    let n = 0;
    while n < tests_run.len() {
        let t = tests_run[n];
        report += "- `" + t.command + "` — " + t.result + "\n";
        n += 1;
    }
    report += "\n";
}
report += "## Acceptance verifier: " + (if acc_passed { "PASSED" } else { "FAILED" }) + "\n\n" + acc_summary + "\n\n";
report += "## Adversarial reviewer: " + (if adv_passed { "PASSED" } else { "FOUND ISSUES" }) + "\n\n" + adv_summary + "\n\n";
if v_adv != () && v_adv.success && v_adv.output != () && arr(v_adv.output.regressions).len() > 0 {
    let regressions = arr(v_adv.output.regressions);
    report += "### Reported regressions / defects\n\n";
    let r2 = 0;
    while r2 < regressions.len() {
        report += "- " + regressions[r2] + "\n";
        r2 += 1;
    }
    report += "\n";
}
report += "---\n_Edits are in the isolated worktree (agent id `" + impl_r.agent_id
    + "`). Inspect or apply them manually; nothing was merged into the parent workspace._\n";

let p = write_scratch_file("report.md", report);
complete(#{
    summary: if overall_passed { "Plan implemented and verified." } else { "Implemented but verification found gaps." },
    passed: overall_passed,
    plan: plan,
    implementation: impl,
    acceptance: if v_acc != () && v_acc.success { v_acc.output } else { () },
    adversarial: if v_adv != () && v_adv.success { v_adv.output } else { () },
    path: p,
    report: report,
});
