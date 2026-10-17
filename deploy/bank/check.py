#!/usr/bin/env python3
"""Read-only host checks. Prints JSON; a failed check returns exit status 1."""
import argparse
from datetime import datetime, timezone
import ipaddress
import json
from pathlib import Path
import shutil
import sys
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from sqlite_ops import guarded_path, readonly_connection, verify_manifest


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", default="/var/lib/luckycat-bank")
    parser.add_argument("--backup-root", default="/var/backups/luckycat-bank")
    parser.add_argument("--database", default="/var/lib/luckycat-bank/bank.sqlite")
    parser.add_argument("--health-url", default="http://127.0.0.1:8080/health")
    parser.add_argument("--max-backup-age-hours", type=float, default=2)
    parser.add_argument("--min-free-percent", type=float, default=15)
    args = parser.parse_args()
    checks = []

    def record(name, callback):
        try:
            detail = callback()
            checks.append({"check": name, "ok": True, "detail": detail})
        except Exception as error:
            checks.append({"check": name, "ok": False, "error": str(error)})

    def health():
        parsed = urlsplit(args.health_url)
        if parsed.scheme != "http" or parsed.username or parsed.password or not ipaddress.ip_address(parsed.hostname).is_loopback:
            raise ValueError("health URL must be plain HTTP on a literal loopback IP")
        opener = build_opener(ProxyHandler({}), NoRedirect())
        with opener.open(Request(args.health_url, headers={"Accept": "application/json"}), timeout=5) as response:
            value = json.loads(response.read(32768))
            if response.status != 200 or value.get("ok") is not True:
                raise ValueError("health did not return HTTP 200 and ok=true")
        return "HTTP 200, ok=true"

    def unauthorized():
        parsed = urlsplit(args.health_url)
        if parsed.scheme != "http" or not ipaddress.ip_address(parsed.hostname).is_loopback:
            raise ValueError("only a literal loopback URL is allowed")
        url = f"{parsed.scheme}://{parsed.netloc}/api/accounts"
        opener = build_opener(ProxyHandler({}), NoRedirect())
        try:
            with opener.open(url, timeout=5):
                raise ValueError("unauthenticated accounts request unexpectedly succeeded")
        except HTTPError as error:
            if error.code != 401:
                raise ValueError(f"unauthenticated accounts returned HTTP {error.code}; expected 401")
        return "HTTP 401"

    def database():
        path = guarded_path(args.database, args.data_root)
        connection = readonly_connection(path)
        try:
            if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("SQLite quick_check failed")
        finally:
            connection.close()
        wal = Path(str(path) + "-wal")
        return {"quick_check": "ok", "database_bytes": path.stat().st_size,
                "wal_bytes": wal.stat().st_size if wal.exists() else 0}

    def storage():
        usage = shutil.disk_usage(args.data_root)
        free_percent = round(usage.free / usage.total * 100, 2)
        if free_percent < args.min_free_percent:
            raise ValueError(f"free space {free_percent}% is below {args.min_free_percent}%")
        return {"free_percent": free_percent, "free_bytes": usage.free}

    def backup():
        root = Path(args.backup_root)
        candidates = list(root.glob("bank-*.sqlite.manifest.json"))
        if not candidates:
            raise ValueError("no scheduled backup manifest found")
        latest = max(candidates, key=lambda path: path.stat().st_mtime)
        manifest_path = guarded_path(latest, root)
        snapshot = guarded_path(str(manifest_path)[:-len(".manifest.json")], root)
        manifest = verify_manifest(snapshot, manifest_path)
        created = datetime.fromisoformat(manifest["created_at_utc"])
        if created.tzinfo is None:
            raise ValueError("backup timestamp has no timezone")
        age = (datetime.now(timezone.utc) - created).total_seconds() / 3600
        if age < -0.1 or age > args.max_backup_age_hours:
            raise ValueError(f"latest backup age {age:.2f} hours is outside allowed range")
        return {"snapshot": str(snapshot), "age_hours": round(age, 2), "sha256": manifest["sha256"]}

    record("loopback-health", health)
    record("unauthenticated-api", unauthorized)
    record("database", database)
    record("disk-free", storage)
    record("latest-backup", backup)
    ok = all(item["ok"] for item in checks)
    print(json.dumps({"ok": ok, "checks": checks}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
