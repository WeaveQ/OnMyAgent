"""PDFKit Extension Template — copy and customize to add new commands."""
import argparse

COMMAND = "my_extension"
DESCRIPTION = "My custom PDF extension"
CATEGORY = "extension"

def register(subparsers):
    parser = subparsers.add_parser(COMMAND, help=DESCRIPTION)
    parser.add_argument("--input", required=True, help="Input PDF file")
    parser.add_argument("--output", required=True, help="Output file")
    return parser

def handler(args):
    """Implement your extension logic here."""
    raise NotImplementedError("Customize this handler function for your extension")
