#!/usr/bin/env python3
"""Local PDF inspection, rendering, and verification runtime."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

CAPABILITIES = ["read", "create", "extract", "merge", "split", "rotate", "forms", "watermark", "inspect", "render", "verify"]
MODULES = {"pypdf": "pypdf", "pdfplumber": "pdfplumber", "reportlab": "reportlab", "fitz": "PyMuPDF", "PIL": "Pillow"}


def emit(payload: dict[str, object], code: int = 0) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return code


def require_pdf(source: Path) -> Path:
    source = source.resolve()
    if source.suffix.lower() != ".pdf" or not source.is_file():
        raise ValueError(f"Input must be an existing .pdf file: {source}")
    if source.read_bytes()[:5] != b"%PDF-":
        raise ValueError(f"Input does not have a PDF header: {source}")
    return source


def dependencies() -> dict[str, bool]:
    return {package: importlib.util.find_spec(module) is not None for module, package in MODULES.items()}


def inspect_pdf(source: Path) -> dict[str, object]:
    source = require_pdf(source)
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise RuntimeError("pypdf is unavailable; run the bundled runtime preparation step") from error
    reader = PdfReader(source)
    fields = reader.get_fields() or {}
    encrypted = reader.is_encrypted
    metadata = reader.metadata or {}
    return {
        "status": "success", "source": str(source), "format": "pdf",
        "page_count": len(reader.pages), "encrypted": encrypted,
        "form_field_count": len(fields),
        "title": metadata.get("/Title"), "author": metadata.get("/Author"),
    }


def render_pdf(source: Path, output_dir: Path, dpi: int) -> dict[str, object]:
    source = require_pdf(source)
    try:
        import fitz
    except ImportError as error:
        raise RuntimeError("PyMuPDF is unavailable; run the bundled runtime preparation step") from error
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    scale = dpi / 72
    document = fitz.open(source)
    pages: list[str] = []
    try:
        for index, page in enumerate(document, start=1):
            output = output_dir / f"page-{index}.png"
            page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(output)
            pages.append(str(output))
    finally:
        document.close()
    if not pages:
        raise RuntimeError("PDF has no renderable pages")
    return {"status": "success", "source": str(source), "page_count": len(pages), "pages": pages, "output_dir": str(output_dir)}


def verify_pdf(source: Path, output_dir: Path | None, dpi: int) -> dict[str, object]:
    inspection = inspect_pdf(source)
    issues = ["PDF has no pages"] if inspection["page_count"] == 0 else []
    rendered = render_pdf(source, output_dir, dpi) if output_dir is not None else None
    return {"status": "success" if not issues else "issues_found", "inspection": inspection, "issues": issues, "render": rendered}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("capabilities", "doctor", "inspect", "render", "verify"))
    parser.add_argument("input", nargs="?", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--dpi", type=int, default=160)
    parser.add_argument("--capabilities", action="store_true")
    args = parser.parse_args()
    command = "capabilities" if args.capabilities else args.command
    try:
        if command == "capabilities":
            return emit({"status": "ready", "runtime": "pdf", "capabilities": CAPABILITIES, "commands": ["doctor", "inspect", "render", "verify"]})
        if command == "doctor":
            report = dependencies()
            return emit({"status": "ready" if all(report.values()) else "degraded", "runtime": "pdf", "dependencies": report, "capabilities": CAPABILITIES})
        if args.input is None:
            raise ValueError(f"{command or 'command'} requires an input path")
        if command == "inspect":
            return emit(inspect_pdf(args.input))
        if command == "render":
            if args.output_dir is None:
                raise ValueError("render requires --output-dir")
            return emit(render_pdf(args.input, args.output_dir, args.dpi))
        if command == "verify":
            return emit(verify_pdf(args.input, args.output_dir, args.dpi))
        raise ValueError("A command is required")
    except (OSError, RuntimeError, ValueError) as error:
        return emit({"status": "error", "runtime": "pdf", "error": str(error)}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
