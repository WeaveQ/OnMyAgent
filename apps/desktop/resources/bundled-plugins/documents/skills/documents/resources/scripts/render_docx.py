#!/usr/bin/env python3
"""Render a DOCX to PDF and per-page PNG files for visual QA."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def executable(name: str, macos_fallback: str | None = None) -> str:
    resolved = shutil.which(name)
    if resolved:
        return resolved
    if macos_fallback and Path(macos_fallback).is_file():
        return macos_fallback
    raise RuntimeError(f"Required executable is unavailable: {name}")


def run(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise RuntimeError(f"Command failed ({command[0]}): {detail}")


def render(source: Path, output_dir: Path, dpi: int, emit_pdf: bool) -> dict[str, object]:
    if source.suffix.lower() != ".docx" or not source.is_file():
        raise ValueError(f"Input must be an existing .docx file: {source}")

    output_dir.mkdir(parents=True, exist_ok=True)
    soffice = executable(
        "soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    )
    pdftoppm = executable("pdftoppm")

    with tempfile.TemporaryDirectory(prefix="onmyagent-docx-render-") as temp:
        temp_dir = Path(temp)
        profile = temp_dir / "profile"
        profile.mkdir()
        run(
            [
                soffice,
                "--headless",
                f"-env:UserInstallation={profile.as_uri()}",
                "--convert-to",
                "pdf",
                "--outdir",
                str(temp_dir),
                str(source.resolve()),
            ]
        )
        rendered_pdf = temp_dir / f"{source.stem}.pdf"
        if not rendered_pdf.is_file():
            raise RuntimeError("LibreOffice completed without producing a PDF")

        page_prefix = output_dir / "page"
        run([pdftoppm, "-png", "-r", str(dpi), str(rendered_pdf), str(page_prefix)])
        pages = sorted(output_dir.glob("page-*.png"))
        if not pages:
            raise RuntimeError("Poppler completed without producing page images")

        pdf_output = None
        if emit_pdf:
            pdf_output = output_dir / f"{source.stem}.pdf"
            shutil.copy2(rendered_pdf, pdf_output)

    return {
        "status": "success",
        "source": str(source.resolve()),
        "page_count": len(pages),
        "pages": [str(page.resolve()) for page in pages],
        "pdf": str(pdf_output.resolve()) if pdf_output else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--dpi", type=int, default=160)
    parser.add_argument("--emit-pdf", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(render(args.input, args.output_dir, args.dpi, args.emit_pdf)))
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(json.dumps({"status": "error", "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

