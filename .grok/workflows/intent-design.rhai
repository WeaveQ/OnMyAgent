let meta = #{
    name: "intent-design",
    description: "From an accepted docs/intent slug, write a design doc into docs/design/, review it, then stop for a human /execute-plan decision.",
    when_to_use: "User has an accepted intent and wants a design doc in docs/design/ before implementation. Not for UI token audits or iPPT.",
    phases: [
        #{ title: "Load", detail: "read accepted intent and SoT constraints" },
        #{ title: "Write", detail: "design doc with Key Decisions and PR Plan" },
        #{ title: "Review", detail: "bounded write-review loop" },
    ],
};

fn truthy(v) {
    return v == true;
}
fn as_str(v) {
    if type_of(v) == "string" { return v; }
    return "";
}

let load_schema = #{
    "type": "object",
    "required": ["exists", "intent_path"],
    "properties": #{
        "exists": #{ "type": "boolean" },
        "intent_path": #{ "type": "string" },
        "title": #{ "type": "string" },
        "date": #{ "type": "string" },
        "problem": #{ "type": "string" },
        "constraints": #{ "type": "string" },
        "missing": #{ "type": "string" },
    },
};

let write_schema = #{
    "type": "object",
    "required": ["path", "title", "pr_count"],
    "properties": #{
        "path": #{ "type": "string" },
        "title": #{ "type": "string" },
        "pr_count": #{ "type": "integer" },
        "key_decisions": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
    },
};

let review_schema = #{
    "type": "object",
    "required": ["open_count"],
    "properties": #{
        "open_count": #{ "type": "integer" },
        "issues": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["severity", "section", "description"],
                "properties": #{
                    "severity": #{ "type": "string" },
                    "section": #{ "type": "string" },
                    "description": #{ "type": "string" },
                    "suggestion": #{ "type": "string" },
                },
            },
        },
        "summary": #{ "type": "string" },
    },
};

let slug = if args == () { () } else { args.slug };
if slug == () {
    pause("verification", "Pass args.slug: the docs/intent/<slug>.md basename without .md");
}

let intent_path = "docs/intent/" + slug + ".md";

phase("Load");
let load_prompt = "Read the accepted intent file at " + intent_path;
load_prompt += " using read_file (and list_dir docs/intent if the path is wrong). ";
load_prompt += "Also read AGENTS.md (intent vs docs/design vs DESIGN.md token table), docs/intent/_TEMPLATE.md, and docs/README.md if needed. ";
load_prompt += "Do not invent an intent if the file is missing. ";
load_prompt += "Return exists=true only if the markdown file is present and is not the template. ";
load_prompt += "Copy Date/Problem/Constraints from the file into the schema fields. Empty problem is allowed only after you actually read the file.";
let loaded = agent(load_prompt, #{
    label: "load:intent",
    capability_mode: "read-only",
    output_schema: load_schema,
});

let intent_exists = loaded != () && loaded.success && truthy(loaded.output.exists);
if loaded != () && loaded.success && loaded.output.exists == false {
    pause("verification", "No accepted intent at " + intent_path + ". Copy docs/intent/_TEMPLATE.md first.");
}

phase("Write");
let write_prompt = "Write a technical design document for OnMyAgent from the accepted intent at " + intent_path + ". ";
write_prompt += "Use read_file on that intent, AGENTS.md, docs/Architecture.md, and any linked docs/design/* constraints. ";
write_prompt += "Do NOT put the doc in scratch or repo-root design/. Product SoT is docs/design/. ";
write_prompt += "Do NOT confuse root DESIGN.md (color/token table) with this architecture design doc. ";
write_prompt += "Filename: docs/design/<intent-Date-or-YYYY-MM-DD>-" + slug + ".md (use the intent Date field if present). ";
write_prompt += "Create or overwrite that path with write/search_replace. ";
write_prompt += "Mandatory sections: Problem, Proposed outcome, Constraints, Key Decisions (with rationale), Open Questions, Out of scope, PR Plan. ";
write_prompt += "PR Plan entries must use headings like ### PR 1: Title, with Files/components affected, Dependencies, and Description bullets so /execute-plan can parse them. ";
write_prompt += "Do not start implementation. Return the written path, title, pr_count, and key_decisions.";
if intent_exists && loaded.output.problem != () {
    write_prompt += " Intent problem excerpt: ";
    write_prompt += json_encode(loaded.output.problem);
}

let writer = agent(write_prompt, #{
    label: "write:design-doc",
    capability_mode: "read-write",
    output_schema: write_schema,
});

if writer == () || !writer.success || writer.output.path == () || as_str(writer.output.path) == "" {
    complete(#{
        summary: "Writer failed; no design doc path.",
        intent_path: intent_path,
        next: "Fix the intent file and re-run /workflow intent-design",
    });
}

let design_path = as_str(writer.output.path);
log("Wrote " + design_path);

phase("Review");
let writer_id = writer.agent_id;
let round = 0;
let open_count = 1;
while round < 2 && open_count > 0 {
    let review_prompt = "Review the design document at " + design_path;
    review_prompt += " using read_file. Also read " + intent_path + " and AGENTS.md constraints. ";
    review_prompt += "Count Status-open issues. Check: PR Plan is parseable (### PR N: headings), Key Decisions have rationale, intent constraints are not violated, DESIGN.md token file was not used as architecture SoT, and an engineer could implement from it. ";
    review_prompt += "Return open_count=0 only after actually reading the file. Empty issues is valid.";
    let reviewed = agent(review_prompt, #{
        label: "review:design-doc",
        capability_mode: "read-only",
        output_schema: review_schema,
    });
    open_count = 0;
    if reviewed != () && reviewed.success && reviewed.output.open_count != () {
        open_count = reviewed.output.open_count;
    }
    log("Review round " + (round + 1).to_string() + " open_count=" + open_count.to_string());
    if open_count > 0 && writer_id != () {
        let rev_prompt = "The reviewer found open issues in " + design_path + ". ";
        rev_prompt += "Read that file and the intent at " + intent_path + ". ";
        if reviewed != () && reviewed.success {
            rev_prompt += "Issues JSON: " + json_encode(reviewed.output);
        }
        rev_prompt += " Address every open issue in the design doc (write/search_replace). Do not implement product code. Return the same schema with the updated path and pr_count.";
        let revised = agent(rev_prompt, #{
            label: "revise:design-doc",
            capability_mode: "read-write",
            output_schema: write_schema,
            resume_from: writer_id,
        });
        if revised != () && revised.success {
            writer_id = revised.agent_id;
            if revised.output.path != () && as_str(revised.output.path) != "" {
                design_path = as_str(revised.output.path);
            }
        }
    }
    round += 1;
}

let next = "Run /execute-plan " + design_path + " --no-graphite (this repo default branch is dev; current trains are release/0.7, not main). Do not auto-merge.";
complete(#{
    summary: "Design doc at " + design_path,
    intent_path: intent_path,
    design_path: design_path,
    open_count: open_count,
    next: next,
});
