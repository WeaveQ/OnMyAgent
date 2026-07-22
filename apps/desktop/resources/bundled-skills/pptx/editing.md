# Editing an existing presentation with JavaScript

Use the bundled CommonJS toolchain. Run `node runtime/artifact_runtime.cjs doctor` and inspect the source before editing.

## Preferred paths

- For a new deck or a substantial redesign, recreate the deck with `pptxgenjs` while preserving the requested content and visual language.
- For a targeted edit, load the PPTX ZIP with `jszip`, update only the required OOXML parts, and preserve all unrelated parts, relationships, masters, layouts, notes, charts, and media.
- Never rename ZIP parts without updating their relationships and content-type overrides.

## Targeted OOXML workflow

1. Read the package with `JSZip.loadAsync()`.
2. Locate text in `ppt/slides/slide*.xml` and related charts, notes, or media relationships.
3. Parse XML with `fast-xml-parser` when structure matters; use narrowly scoped string replacement only for an exact unique value.
4. Update corresponding relationship and content-type parts when adding or removing assets.
5. Generate a new ZIP with `type: "nodebuffer"` and write it to a new `.pptx` path.
6. Run `inspect` and `verify`, then open the result in OnMyAgent preview and inspect every slide.

## Template rules

- Preserve slide dimensions, theme, fonts, masters, and layouts unless the user requested a redesign.
- Remove leftover placeholders and sample content.
- Keep text boxes within slide boundaries and allow room for font fallback differences.
- Prefer replacing existing media in place when that avoids relationship churn.

The bundled runtime validates package structure; the built-in Office preview is the visual source of truth.
