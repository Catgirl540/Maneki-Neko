"""Export a consistent, single-file snapshot of the demo bank SQLite database."""

import argparse
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=ROOT / "server/data/bank.sqlite",
        help="Live database to snapshot (default: server/data/bank.sqlite)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "demo-database/bank.sqlite",
        help="Snapshot path (default: demo-database/bank.sqlite)",
    )
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not source.is_file():
        parser.error(f"source database does not exist: {source}")
    if source == output:
        parser.error("source and output must be different files")

    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".bank-snapshot-", suffix=".sqlite", dir=output.parent)
    os.close(fd)
    try:
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as live:
            with closing(sqlite3.connect(temporary)) as snapshot:
                live.backup(snapshot)
                snapshot.execute("PRAGMA journal_mode=DELETE")
                result = snapshot.execute("PRAGMA integrity_check").fetchone()[0]
                if result != "ok":
                    raise RuntimeError(f"snapshot integrity check failed: {result}")
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

    print(f"Exported consistent SQLite snapshot to {output}")


if __name__ == "__main__":
    main()
