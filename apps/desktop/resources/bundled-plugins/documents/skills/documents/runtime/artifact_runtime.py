#!/usr/bin/env python3
"""Local DOCX inspection, rendering, and verification runtime."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree

CAPABILITIES = [
    "create", "read", "edit", "review", "comments", "tracked-changes",
    "styles", "tables", "headers-footers", "toc", "inspect", "render", "verify",
]
MODULES = {"docx": "python-docx", "lxml": "lxml", "defusedxml": "defusedxml", "PIL": "Pillow"}
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def emit(payload: dict[str, object], code: int = 0) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return code


def office_binary() -> str | None:
    executable_path = Path(sys.executable).resolve()
    runtime_root = executable_path.parents[2] if len(executable_path.parents) > 2 else executable_path.parent
    candidates = [
        os.environ.get("ONMYAGENT_LIBREOFFICE_PATH"),
        str(runtime_root / "bin" / "soffice"),
        str(runtime_root / "libreoffice" / "LibreOffice.app" / "Contents" / "MacOS" / "soffice"),
        str(runtime_root / "libreoffice" / "LibreOffice" / "program" / "soffice.exe"),
    ]
    for name in ("soffice", "libreoffice"):
        if binary := shutil.which(name):
            candidates.append(binary)
    candidates.append("/Applications/LibreOffice.app/Contents/MacOS/soffice")
    for candidate in candidates:
        if not candidate:
            continue
        resolved = str(Path(candidate).expanduser().resolve())
        if "/.cache/codex-runtimes/" in resolved or "/.codex/" in resolved:
            continue
        if Path(resolved).is_file():
            return resolved
    return None


def dependency_report() -> dict[str, object]:
    modules = {package: importlib.util.find_spec(module) is not None for module, package in MODULES.items()}
    office = office_binary()
    return {
        "python_modules": modules,
        "office_renderer": {"available": office is not None, "path": office},
        "ready_for_editing": all(modules.values()),
        "ready_for_rendering": office is not None,
    }


def require_docx(source: Path) -> Path:
    source = source.resolve()
    if source.suffix.lower() != ".docx" or not source.is_file():
        raise ValueError(f"Input must be an existing .docx file: {source}")
    if not zipfile.is_zipfile(source):
        raise ValueError(f"Input is not a valid OOXML ZIP package: {source}")
    return source


def inspect_docx(source: Path) -> dict[str, object]:
    source = require_docx(source)
    with zipfile.ZipFile(source) as archive:
        names = set(archive.namelist())
        if "word/document.xml" not in names or "[Content_Types].xml" not in names:
            raise ValueError("DOCX package is missing required OOXML parts")
        root = ElementTree.fromstring(archive.read("word/document.xml"))
        paragraphs = root.findall(f".//{WORD_NS}p")
        tables = root.findall(f".//{WORD_NS}tbl")
        comments = "word/comments.xml" in names
        footnotes = "word/footnotes.xml" in names
        endnotes = "word/endnotes.xml" in names
        headers = len([name for name in names if name.startswith("word/header") and name.endswith(".xml")])
        footers = len([name for name in names if name.startswith("word/footer") and name.endswith(".xml")])
        text = "".join(node.text or "" for node in root.findall(f".//{WORD_NS}t"))
    return {
        "status": "success", "source": str(source), "format": "docx",
        "paragraph_count": len(paragraphs), "table_count": len(tables),
        "character_count": len(text), "has_comments": comments,
        "has_footnotes": footnotes, "has_endnotes": endnotes,
        "header_count": headers, "footer_count": footers,
    }


def run(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise RuntimeError(f"Command failed ({Path(command[0]).name}): {detail}")


def render_docx(source: Path, output_dir: Path) -> dict[str, object]:
    source = require_docx(source)
    office = office_binary()
    if office is None:
        raise RuntimeError("LibreOffice is required for DOCX rendering but is unavailable")
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="onmyagent-docx-") as temporary:
        temporary_path = Path(temporary)
        profile = temporary_path / "profile"
        profile.mkdir()
        run([office, "--headless", f"-env:UserInstallation={profile.as_uri()}", "--convert-to", "pdf", "--outdir", str(output_dir), str(source)])
    pdf = output_dir / f"{source.stem}.pdf"
    if not pdf.is_file():
        raise RuntimeError("LibreOffice completed without producing a PDF")
    return {"status": "success", "source": str(source), "pdf": str(pdf), "output_dir": str(output_dir)}


def verify_docx(source: Path, output_dir: Path | None) -> dict[str, object]:
    result = inspect_docx(source)
    issues: list[str] = []
    rendered = None
    if result["paragraph_count"] == 0 and result["table_count"] == 0:
        issues.append("document has no paragraphs or tables")
    if output_dir is not None:
        rendered = render_docx(source, output_dir)
    return {"status": "success" if not issues else "issues_found", "inspection": result, "issues": issues, "render": rendered}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("capabilities", "doctor", "inspect", "render", "verify"))
    parser.add_argument("input", nargs="?", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--capabilities", action="store_true")
    args = parser.parse_args()
    command = "capabilities" if args.capabilities else args.command
    try:
        if command == "capabilities":
            return emit({"status": "ready", "runtime": "documents", "capabilities": CAPABILITIES, "commands": ["doctor", "inspect", "render", "verify"]})
        if command == "doctor":
            report = dependency_report()
            return emit({"status": "ready" if report["ready_for_editing"] else "degraded", "runtime": "documents", "dependencies": report, "capabilities": CAPABILITIES})
        if args.input is None:
            raise ValueError(f"{command or 'command'} requires an input path")
        if command == "inspect":
            return emit(inspect_docx(args.input))
        if command == "render":
            if args.output_dir is None:
                raise ValueError("render requires --output-dir")
            return emit(render_docx(args.input, args.output_dir))
        if command == "verify":
            return emit(verify_docx(args.input, args.output_dir))
        raise ValueError("A command is required")
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile, ElementTree.ParseError) as error:
        return emit({"status": "error", "runtime": "documents", "error": str(error)}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
