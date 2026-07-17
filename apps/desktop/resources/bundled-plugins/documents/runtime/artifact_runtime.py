#!/usr/bin/env python3
"""Temporary Documents artifact runtime contract placeholder."""

import json
import sys


def main() -> int:
    request = "capabilities" if "--capabilities" in sys.argv[1:] else "execute"
    print(
        json.dumps(
            {
                "status": "not_implemented",
                "message": "The Documents artifact runtime is not implemented yet.",
                "request": request,
                "capabilities": [],
            }
        )
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
