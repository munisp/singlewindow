#!/usr/bin/env python3
"""
Remove all NODE_ENV !== 'production' dev-mode blocks from tRPC routers.
These blocks return mock/hardcoded data and must be replaced with real DB queries.
"""
import os
import re
import sys
from pathlib import Path

ROUTERS_DIR = Path("/home/ubuntu/singlewindow/server/routers")
TARGET_FILES = [
    "corazaWaf.ts",
    "geoip.ts",
    "kafkaEvents.ts",
    "redis.ts",
    "temporalRuns.ts",
    "workflowSchemas.ts",
]


def remove_dev_blocks(text: str) -> tuple[str, int]:
    """Remove if (process.env.NODE_ENV !== 'production') { ... } blocks."""
    lines = text.split('\n')
    result = []
    in_dev_block = False
    brace_depth = 0
    removed = 0

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Detect start of dev-mode block
        if ('process.env.NODE_ENV !== "production"' in line or
                "process.env.NODE_ENV !== 'production'" in line) and \
                stripped.startswith('if ('):
            in_dev_block = True
            brace_depth = 0
            brace_depth += line.count('{') - line.count('}')
            removed += 1
            i += 1
            continue

        if in_dev_block:
            brace_depth += line.count('{') - line.count('}')
            removed += 1
            if brace_depth <= 0:
                in_dev_block = False
            i += 1
            continue

        result.append(line)
        i += 1

    return '\n'.join(result), removed


def process_file(filepath: Path) -> int:
    """Process a single file and return number of lines removed."""
    with open(filepath, 'r') as f:
        content = f.read()

    new_content, removed = remove_dev_blocks(content)

    if removed > 0:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"  {filepath.name}: removed {removed} dev-mode lines")
    else:
        print(f"  {filepath.name}: no dev-mode blocks found")

    return removed


def main():
    total_removed = 0
    for filename in TARGET_FILES:
        filepath = ROUTERS_DIR / filename
        if filepath.exists():
            total_removed += process_file(filepath)
        else:
            print(f"  WARNING: {filename} not found")

    print(f"\nTotal: removed {total_removed} dev-mode lines across {len(TARGET_FILES)} files")


if __name__ == "__main__":
    main()
