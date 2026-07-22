# PDF forms with pdf-lib

Use `PDFDocument.load(bytes)` and `document.getForm()` to enumerate and fill AcroForm fields. Match by exact field name, set values with the appropriate field type, update appearances with an embedded font, and save to a new file.

When a document has no real form fields, disclose that limitation. An annotation or drawn-text overlay is a visual fallback, not a fillable form value. Always open the result in OnMyAgent's Chromium PDF preview and inspect every affected page before running the runtime verifier.

Do not execute document JavaScript or launch actions, and do not flatten fields unless the user requests a non-editable result.
