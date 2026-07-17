---
name: documents
description: Use when a user asks to create, read, edit, review, or inspect a DOCX or Word document through the bundled Documents artifact plugin.
---

# Documents

## Overview

Use only the runtime shipped in this plugin. Treat its JSON response as the source of truth about available document operations.

## Runtime contract

1. Resolve the plugin root as two directories above this `SKILL.md`.
2. Run `python3 <plugin-root>/runtime/artifact_runtime.py --capabilities` before promising any document operation.
3. Parse standard output as JSON and inspect `status` and `capabilities`.
4. Continue only when the requested operation appears in `capabilities` and `status` permits execution.
5. When `status` is `not_implemented`, stop. Tell the user that no document was created or changed and include the runtime message.

Do not substitute imagined scripts, office applications, or external connectors for a missing runtime capability.

## Quick reference

| Runtime result | Action |
| --- | --- |
| `not_implemented` | Report the limitation; produce no success claim |
| Requested capability absent | Explain that the operation is unavailable |
| Capability advertised | Follow the runtime contract returned by that runtime |

## Example

For “Create a DOCX from these notes,” query capabilities first. If the runtime returns `{"status":"not_implemented","capabilities":[]}`, state that the plugin cannot create the DOCX yet and that no output file exists.

## Common mistakes

- Promising a DOCX before checking capabilities.
- Claiming a file was written without a successful runtime response and an existing output path.
- Relying on package resources that the runtime has not advertised.
