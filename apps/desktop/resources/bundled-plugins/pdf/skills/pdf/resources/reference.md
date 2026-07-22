# JavaScript PDF reference

The bundled PDF toolchain uses `pdf-lib` for creation and package-level changes.

- `PDFDocument.create()` creates a document.
- `PDFDocument.load(bytes)` opens an existing document.
- `copyPages()` supports merge and split workflows.
- Page APIs support rotation, dimensions, text, images, and vector drawing.
- `getForm()` reads and updates AcroForm fields.
- Metadata APIs read and update title, author, subject, keywords, and dates.

`pdf-lib` does not perform OCR, full document reflow, or pixel-perfect editing of arbitrary existing page content. Preserve unknown objects, disclose unsupported encrypted inputs, and use OnMyAgent's Chromium PDF preview for page-by-page visual verification.
