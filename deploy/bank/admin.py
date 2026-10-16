#!/usr/bin/env python3
"""Offline account maintenance. Stop luckycat-bank before running this script.

Passwords are read with getpass and sent directly to Node on stdin. They are never
accepted in arguments, copied into environment variables, or written to files.
"""
import argparse
import getpass
import hmac
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import warnings

from restore import assert_stopped, exclusive_lock
from sqlite_ops import guarded_path


SERVICE = "luckycat-bank.service"
ACTIONS = (
    "set-staff-password", "set-customer-password", "set-payment-password", "unlock-payment",
)


def read_environment(path: Path) -> dict[str, str]:
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("environment file must use an absolute path without parent traversal")
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError("environment file and its parents must not be symlinks")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise PermissionError("environment file must be a root:root regular file with mode 0600")
        if info.st_size > 65536:
            raise ValueError("environment file exceeds 64 KiB")
        result = {}
        for number, raw in enumerate(stream, 1):
            line = raw.rstrip("\r\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=([^\x00\r\n]*)", line)
            if not match:
                raise ValueError(f"invalid KEY=VALUE syntax at environment line {number}")
            key, value = match.groups()
            # Unquoted single-line literals only. No shell, interpolation or escape parser.
            if value != value.strip() or any(character in value for character in ("'", '"', "\\")):
                raise ValueError(f"environment line {number} must use an unquoted literal value")
            if key in result:
                raise ValueError(f"duplicate environment key at line {number}")
            result[key] = value
    return result


def prompt_password(action: str) -> str:
    with warnings.catch_warnings():
        # getpass otherwise falls back to echoing input when no controlling TTY exists.
        warnings.simplefilter("error", getpass.GetPassWarning)
        password = getpass.getpass("新密码（输入不回显）：")
        confirmation = getpass.getpass("再次输入新密码：")
    if not hmac.compare_digest(password.encode("utf-8"), confirmation.encode("utf-8")):
        raise ValueError("password confirmation did not match")
    if action == "set-payment-password":
        if not re.fullmatch(r"[0-9]{6}", password):
            raise ValueError("payment password requires exactly six digits")
    elif not 12 <= len(password) <= 20 or any(character in password for character in ("\0", "\r", "\n")):
        raise ValueError("staff/customer password requires 12–20 characters without line breaks")
    return password


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=ACTIONS)
    parser.add_argument("id", help="stable staff/customer ID; not a phone number or password")
    parser.add_argument("--env-file", type=Path, default=Path("/etc/luckycat-bank/bank.env"))
    args = parser.parse_args()
    password = ""
    environment = None
    os.umask(0o077)
    try:
        if sys.platform != "linux" or os.geteuid() != 0:
            raise PermissionError("account maintenance requires Linux root and systemd")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", args.id):
            raise ValueError("invalid stable account ID")
        release = Path(__file__).resolve(strict=True).parents[2]
        releases = Path("/srv/maneki-bank/releases")
        if releases.resolve(strict=True) != releases or release == releases or not release.is_relative_to(releases):
            raise ValueError("maintenance script must reside in /srv/maneki-bank/releases/<release>")
        entry = release / "server/admin.mjs"
        if not entry.is_file() or entry.is_symlink():
            raise ValueError("release does not contain a regular server/admin.mjs")
        configured = read_environment(args.env_file)
        if configured.get("NODE_ENV") != "production" or not configured.get("BANK_DATA_KEY") or not configured.get("BANK_DB_FILE"):
            raise ValueError("maintenance requires the production database/key environment")
        environment = os.environ.copy()
        environment.update(configured)
        configured.clear()
        environment["BANK_MAINTENANCE"] = "1"
        database = guarded_path(environment.get("BANK_DB_FILE", ""), "/var/lib/luckycat-bank")
        assert_stopped(SERVICE)
        info = database.stat()
        with exclusive_lock(database.parent / ".restore.lock", info.st_uid, info.st_gid):
            assert_stopped(SERVICE)
            if args.action != "unlock-payment":
                password = prompt_password(args.action)
            # Recheck after the interactive prompt; this script never stops/starts the service.
            assert_stopped(SERVICE)
            import pwd
            runtime_user = pwd.getpwnam("bank")
            if info.st_uid != runtime_user.pw_uid or info.st_gid != runtime_user.pw_gid:
                raise PermissionError("database must be owned by bank:bank before maintenance")
            result = subprocess.run(
                ["/opt/maneki-node24/bin/node", str(entry), args.action, args.id],
                cwd=release, env=environment, input=password, text=True, timeout=120, check=False,
                user=runtime_user.pw_uid, group=runtime_user.pw_gid, extra_groups=[],
            )
            return result.returncode if result.returncode >= 0 else 1
    except (KeyboardInterrupt, EOFError, getpass.GetPassWarning):
        print("Maintenance cancelled; service state was not changed.", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Maintenance refused: {error}", file=sys.stderr)
        return 1
    finally:
        password = ""
        if environment is not None:
            environment.clear()


if __name__ == "__main__":
    raise SystemExit(main())
