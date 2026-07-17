---
name: pdf
description: Use when a user asks to create, read, merge, split, rotate, inspect, or edit PDF files through the bundled PDF artifact plugin.
---

# PDF

## Overview

Use the plugin runtime as the only authority for available PDF operations. General knowledge of PDF tools does not prove that those tools exist in this package.

## Runtime contract

1. Resolve the plugin root as two directories above this `SKILL.md`.
2. Run `python3 <plugin-root>/runtime/artifact_runtime.py --capabilities` before committing to a PDF operation.
3. Parse the JSON response and inspect `status` and `capabilities`.
4. Continue only when the requested operation is advertised and the runtime permits execution.
5. On `not_implemented`, stop and quote the runtime message. State that no PDF was created or changed.

Do not invent merge, rotation, rendering, OCR, form, or extraction commands that the runtime has not advertised.

## Quick reference

| Runtime result | Action |
| --- | --- |
| `not_implemented` | Report the limitation and no output |
| Operation missing | Explain that the requested PDF operation is unavailable |
| Operation advertised | Use only the runtime contract it returns |

## Example

For “Merge and rotate these PDFs,” query capabilities. If the response is `{"status":"not_implemented","capabilities":[]}`, explain that merging and rotation are unavailable and do not claim an output file.

## Common mistakes

- Assuming a common PDF library or command is bundled.
- Reporting page or layout verification without a successful runtime result.
- Relying on package resources that the runtime has not advertised.
