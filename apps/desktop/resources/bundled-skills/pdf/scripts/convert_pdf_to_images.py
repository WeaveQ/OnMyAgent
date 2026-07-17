#!/usr/bin/env python3
"""Render every page of a PDF to PNG for visual QA."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


def render_with_poppler(source: Path, output_dir: Path, dpi: int) -> list[Path]:
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("pdftoppm is unavailable")
    result = subprocess.run(
        [pdftoppm, "-png", "-r", str(dpi), str(source), str(output_dir / "page")],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise RuntimeError(f"pdftoppm failed: {detail}")
    return sorted(output_dir.glob("page-*.png"))


def render_with_pdf2image(source: Path, output_dir: Path, dpi: int) -> list[Path]:
    try:
        from pdf2image import convert_from_path
    except ImportError as error:
        raise RuntimeError("Neither pdftoppm nor pdf2image is available") from error

    pages = []
    for index, image in enumerate(convert_from_path(source, dpi=dpi), start=1):
        page = output_dir / f"page-{index}.png"
        image.save(page)
        pages.append(page)
    return pages


def render(source: Path, output_dir: Path, dpi: int) -> dict[str, object]:
    if source.suffix.lower() != ".pdf" or not source.is_file():
        raise ValueError(f"Input must be an existing .pdf file: {source}")
    output_dir.mkdir(parents=True, exist_ok=True)
    pages = (
        render_with_poppler(source, output_dir, dpi)
        if shutil.which("pdftoppm")
        else render_with_pdf2image(source, output_dir, dpi)
    )
    if not pages:
        raise RuntimeError("Renderer completed without producing page images")
    return {
        "status": "success",
        "source": str(source.resolve()),
        "page_count": len(pages),
        "pages": [str(page.resolve()) for page in pages],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--dpi", type=int, default=160)
    args = parser.parse_args()
    try:
        print(json.dumps(render(args.input, args.output_dir, args.dpi)))
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(json.dumps({"status": "error", "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
