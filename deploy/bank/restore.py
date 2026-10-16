#!/usr/bin/env python3
"""Root-only Linux restore: stop unit, validate, preserve current DB, atomically install.

The service remains stopped. Inspect results, run reconciliation, then start it manually.
"""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
from uuid import uuid4

from sqlite_ops import (
    create_snapshot, fsync_directory, guarded_path, sha256_file,
    unique_snapshot_name, utc_now, validate_database, verify_manifest,
)


def systemctl(*args: str) -> str:
    result = subprocess.run(
        ["/usr/bin/systemctl", *args], text=True, capture_output=True, timeout=90, check=False,
    )
    if result.returncode:
        raise RuntimeError("systemctl failed; service must remain stopped for restore")
    return result.stdout.strip()


def assert_stopped(service: str) -> None:
    state = systemctl("show", service, "--property=ActiveState", "--value")
    pid = systemctl("show", service, "--property=MainPID", "--value")
    if state not in ("inactive", "failed") or pid != "0":
        raise RuntimeError("service has not fully stopped")


@contextmanager
def exclusive_lock(path: Path, owner_uid: int, owner_gid: int):
    import fcntl
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        os.fchown(descriptor, owner_uid, owner_gid)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--manifest", help="defaults to SNAPSHOT.manifest.json")
    parser.add_argument("--data-root", default="/var/lib/luckycat-bank")
    parser.add_argument("--backup-root", default="/var/backups/luckycat-bank")
    parser.add_argument("--target", default="/var/lib/luckycat-bank/bank.sqlite")
    parser.add_argument("--service", default="luckycat-bank.service")
    parser.add_argument("--confirm-restore", required=True, choices=["STOP-AND-RESTORE"])
    args = parser.parse_args()
    os.umask(0o077)
    staged = None
    try:
        if sys.platform != "linux" or os.geteuid() != 0:
            raise PermissionError("restore requires Linux root and systemd")
        if not re.fullmatch(r"[a-zA-Z0-9_.@-]+\.service", args.service):
            raise ValueError("invalid systemd service name")
        source = guarded_path(args.snapshot, args.backup_root)
        manifest_path = guarded_path(args.manifest or args.snapshot + ".manifest.json", args.backup_root)
        target = guarded_path(args.target, args.data_root)
        if source == target or os.path.samefile(source, target):
            raise ValueError("snapshot and current database must differ")
        expected = verify_manifest(source, manifest_path)
        # Require an installed unit with its secret/config file; operators verify its DB path.
        properties = systemctl("show", args.service, "--property=EnvironmentFiles", "--value")
        if not properties:
            raise RuntimeError("service needs an EnvironmentFile with the database/key configuration")
        systemctl("stop", args.service)
        assert_stopped(args.service)
        original_stat = target.stat()
        with exclusive_lock(target.parent / ".restore.lock", original_stat.st_uid, original_stat.st_gid):
            rescue = guarded_path(
                Path(args.backup_root) / unique_snapshot_name("pre-restore"), args.backup_root, exists=False,
            )
            rescue_result = create_snapshot(target, rescue)
            # No other program may access this DB during restore. Checkpoint committed WAL first.
            connection = sqlite3.connect(target, timeout=5)
            try:
                connection.execute("PRAGMA locking_mode=EXCLUSIVE")
                connection.execute("BEGIN EXCLUSIVE")
                connection.execute("COMMIT")
                checkpoint = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                if checkpoint and checkpoint[0] != 0:
                    raise RuntimeError("WAL checkpoint busy; another database connection exists")
            finally:
                connection.close()
            assert_stopped(args.service)
            staged = target.with_name(f".{target.name}.restore-{uuid4().hex}")
            fd = os.open(staged, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "wb") as output, source.open("rb") as input_file:
                shutil.copyfileobj(input_file, output, 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            if sha256_file(staged) != expected["sha256"]:
                raise ValueError("staged snapshot SHA256 changed during restore")
            validate_database(staged)
            os.chown(staged, original_stat.st_uid, original_stat.st_gid)
            os.chmod(staged, 0o600)
            # Preserve the original file group on the same filesystem. No WAL is deleted.
            evidence = target.parent / ("pre-restore-files-" + uuid4().hex)
            evidence.mkdir(mode=0o700)
            os.link(target, evidence / target.name)
            for suffix in ("-wal", "-shm", "-journal"):
                sidecar = Path(str(target) + suffix)
                if sidecar.exists() or sidecar.is_symlink():
                    guarded_path(sidecar, args.data_root)
                    os.replace(sidecar, evidence / sidecar.name)
            assert_stopped(args.service)
            os.replace(staged, target)
            staged = None
            fsync_directory(target.parent)
            report = {
                "ok": True, "completed_at_utc": utc_now(), "service": args.service,
                "service_state": "stopped", "target": str(target), "snapshot": str(source),
                "sha256": expected["sha256"], "pre_restore_snapshot": rescue_result["snapshot"],
                "preserved_file_group": str(evidence),
                "next": "verify matching BANK_DATA_KEY, reconcile, then start service manually",
            }
            report_path = evidence / "restore-record.json"
            with report_path.open("x", encoding="utf-8") as stream:
                json.dump(report, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            fsync_directory(evidence)
            print(json.dumps(report, ensure_ascii=False))
            return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error), "service": args.service,
                          "note": "If the stop step ran, service remains stopped; inspect before restarting."},
                         ensure_ascii=False), file=sys.stderr)
        return 1
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
