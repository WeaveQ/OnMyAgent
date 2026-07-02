#!/usr/bin/env python3
"""
Expert Packager - Validates and packages an expert directory into a zip file.

Usage:
    package_expert.py <path/to/expert-dir> [output-dir]

Example:
    python3 package_expert.py plugins/my-expert
    python3 package_expert.py plugins/my-expert ./dist
"""

import sys
import zipfile
from pathlib import Path

# Import validate_expert from sibling script
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))
from validate_expert import validate_expert


def package_expert(expert_path, output_dir=None):
    """
    Validate and package an expert directory into a .zip file.

    Args:
        expert_path: Path to the expert directory
        output_dir: Optional output directory (defaults to current directory)

    Returns:
        Path to the created zip file, or None if error
    """
    expert_path = Path(expert_path).resolve()

    if not expert_path.exists():
        print(f"❌ Error: Expert directory not found: {expert_path}")
        return None

    if not expert_path.is_dir():
        print(f"❌ Error: Path is not a directory: {expert_path}")
        return None

    # Validate first
    print("🔍 Validating expert package...\n")
    result = validate_expert(expert_path)
    print(result.summary())

    if not result.is_valid:
        print("\n❌ Packaging aborted. Please fix validation errors first.")
        return None

    print()

    # Determine output location
    expert_name = expert_path.name
    if output_dir:
        out = Path(output_dir).resolve()
        out.mkdir(parents=True, exist_ok=True)
    else:
        out = Path.cwd()

    zip_filename = out / f"{expert_name}.zip"

    # Create the zip file
    try:
        file_count = 0
        with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_path in sorted(expert_path.rglob('*')):
                if file_path.is_file():
                    # Skip hidden files except .expert-plugin
                    rel = file_path.relative_to(expert_path)
                    parts = rel.parts
                    if any(p.startswith('.') and p != '.expert-plugin' for p in parts):
                        continue
                    # Skip common junk files/directories
                    if any(p in ('__pycache__', 'node_modules') for p in parts):
                        continue
                    if file_path.name in ('.gitkeep', '.DS_Store', 'Thumbs.db'):
                        continue

                    arcname = str(Path(expert_name) / rel)
                    zipf.write(file_path, arcname)
                    print(f"  📄 {arcname}")
                    file_count += 1

        print(f"\n✅ Packaged {file_count} files to: {zip_filename}")
        print(f"   Size: {zip_filename.stat().st_size / 1024:.1f} KB")
        return zip_filename

    except Exception as e:
        print(f"❌ Error creating zip: {e}")
        return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 package_expert.py <path/to/expert-dir> [output-dir]")
        print("\nExample:")
        print("  python3 package_expert.py plugins/my-expert")
        print("  python3 package_expert.py plugins/my-expert ./dist")
        sys.exit(1)

    expert_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"📦 Packaging expert: {expert_path}")
    if output_dir:
        print(f"   Output directory: {output_dir}")
    print()

    result = package_expert(expert_path, output_dir)

    if result:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
