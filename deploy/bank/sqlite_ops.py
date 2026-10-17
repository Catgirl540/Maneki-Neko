#!/usr/bin/env python3
"""Shared, dependency-free SQLite snapshot helpers (Python 3.10+)."""
from __future__ import annotations

import hashlib
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import stat
import time
from datetime import datetime, timezone
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def guarded_path(value: str | Path, root: str | Path, *, exists: bool = True) -> Path:
    """Require an absolute regular path inside an explicit, non-symlink root."""
    raw, base = Path(value), Path(root)
    if not raw.is_absolute() or not base.is_absolute():
        raise ValueError("paths and allowed roots must be absolute")
    if ".." in raw.parts or ".." in base.parts:
        raise ValueError("parent traversal is not allowed")
    for candidate in (base, raw):
        for part in (candidate, *candidate.parents):
            if part.is_symlink():
                raise ValueError("symlink paths are not allowed")
    base = base.resolve(strict=False)
    if not base.is_dir():
        raise ValueError("allowed root must be an existing directory")
    resolved = raw.resolve(strict=False)
    if resolved == base or not resolved.is_relative_to(base):
        raise ValueError("target must be a file below its allowed root")
    if exists and not stat.S_ISREG(resolved.stat().st_mode):
        raise ValueError("target must be a regular file")
    if not resolved.parent.is_dir():
        raise ValueError("target parent directory must already exist")
    return resolved


def readonly_connection(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=30)


def validate_database(path: Path) -> dict:
    with closing(readonly_connection(path)) as connection:
        rows = connection.execute("PRAGMA integrity_check").fetchall()
        if rows != [("ok",)]:
            raise ValueError("SQLite integrity_check failed; preserve the file for investigation")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("SQLite foreign_key_check failed")
        return {
            "integrity_check": "ok",
            "foreign_key_check": "ok",
            "user_version": connection.execute("PRAGMA user_version").fetchone()[0],
            "application_id": connection.execute("PRAGMA application_id").fetchone()[0],
            "table_count": connection.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchone()[0],
        }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fsync_directory(path: Path) -> None:
    if os.name != "nt":
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def unique_snapshot_name(prefix: str = "bank") -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{prefix}-{timestamp}-{uuid4().hex[:12]}.sqlite"


def create_snapshot(source: Path, target: Path, *, deadline_seconds: int = 1800) -> dict:
    """SQLite online backup + checks + SHA256 manifest. Never replaces a snapshot."""
    manifest_path = target.with_name(target.name + ".manifest.json")
    if target.exists() or manifest_path.exists():
        raise FileExistsError("snapshot or manifest already exists; choose a new filename")
    temporary = target.with_name(f".{target.name}.partial-{uuid4().hex}")
    manifest_created = False
    target_created = False
    started = time.monotonic()

    def progress(_status: int, _remaining: int, _total: int) -> None:
        if time.monotonic() - started > deadline_seconds:
            raise TimeoutError("SQLite backup exceeded its deadline")

    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        with closing(readonly_connection(source)) as original, closing(sqlite3.connect(temporary)) as snapshot:
            original.backup(snapshot, pages=1024, progress=progress, sleep=0.05)
            snapshot.execute("PRAGMA journal_mode=DELETE")
        checked = validate_database(temporary)
        with temporary.open("r+b") as stream:
            os.fsync(stream.fileno())
        manifest = {
            "format": "luckycat-sqlite-backup-v1",
            "created_at_utc": utc_now(),
            "database": target.name,
            "source": str(source),
            "size_bytes": temporary.stat().st_size,
            "sha256": sha256_file(temporary),
            "sqlite_version": sqlite3.sqlite_version,
            **checked,
        }
        # POSIX rename overwrites, whereas Windows rename fails if the target exists.
        # Both branches publish the complete file without a replace/overwrite race.
        if os.name == "nt":
            os.rename(temporary, target)
        else:
            os.link(temporary, target)
        target_created = True
        with manifest_path.open("x", encoding="utf-8") as stream:
            manifest_created = True
            os.chmod(manifest_path, 0o600)
            stream.write(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        fsync_directory(target.parent)
        return {"ok": True, "snapshot": str(target), "manifest": str(manifest_path), **manifest}
    except BaseException:
        if manifest_created:
            manifest_path.unlink(missing_ok=True)
        if target_created:
            target.unlink(missing_ok=True)
        raise
    finally:
        temporary.unlink(missing_ok=True)


def verify_manifest(snapshot: Path, manifest_path: Path) -> dict:
    with manifest_path.open(encoding="utf-8") as stream:
        manifest = json.load(stream)
    if manifest.get("format") != "luckycat-sqlite-backup-v1":
        raise ValueError("unsupported backup manifest format")
    if manifest.get("database") != snapshot.name:
        raise ValueError("manifest database filename differs from the selected snapshot")
    if manifest.get("size_bytes") != snapshot.stat().st_size:
        raise ValueError("snapshot size does not match manifest")
    if manifest.get("sha256") != sha256_file(snapshot):
        raise ValueError("snapshot SHA256 does not match manifest")
    for suffix in ("-wal", "-shm", "-journal"):
        if Path(str(snapshot) + suffix).exists():
            raise ValueError("backup must be self-contained; unexpected SQLite sidecar exists")
    validate_database(snapshot)
    return manifest
