#!/usr/bin/env python3
"""Create a checked, self-contained online SQLite backup; never overwrite."""
import argparse
import json
import os
from pathlib import Path
import sys

from sqlite_ops import create_snapshot, guarded_path, unique_snapshot_name


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", default="/var/lib/luckycat-bank")
    parser.add_argument("--backup-root", default="/var/backups/luckycat-bank")
    parser.add_argument("--source", default="/var/lib/luckycat-bank/bank.sqlite")
    parser.add_argument("--output", help="absolute new snapshot path below --backup-root")
    parser.add_argument("--deadline-seconds", type=int, default=1800)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.deadline_seconds <= 0:
            raise ValueError("deadline must be positive")
        source = guarded_path(args.source, args.data_root)
        target = guarded_path(
            args.output or str(Path(args.backup_root) / unique_snapshot_name()),
            args.backup_root,
            exists=False,
        )
        if source == target:
            raise ValueError("source and output cannot be the same")
        result = create_snapshot(source, target, deadline_seconds=args.deadline_seconds)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
