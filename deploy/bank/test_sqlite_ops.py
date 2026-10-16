#!/usr/bin/env python3
"""Local regression checks: temporary DBs only; never calls a real service manager."""
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import sqlite3
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

import backup
import restore
from sqlite_ops import create_snapshot, guarded_path, verify_manifest


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="luckycat-ops-test-", dir=Path(__file__).parent if os.name == "nt" else None,
        )
        self.root = Path(self.temporary.name).resolve()
        self.data = self.root / "data"
        self.copies = self.root / "backups"
        self.data.mkdir()
        self.copies.mkdir()
        self.source = self.data / "bank.sqlite"
        self.target = self.copies / "bank-backup.sqlite"
        self.connection = sqlite3.connect(self.source)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("CREATE TABLE sample(id INTEGER PRIMARY KEY, amount INTEGER)")
        self.connection.execute("INSERT INTO sample VALUES (1, 100)")
        self.connection.commit()

    def tearDown(self):
        self.connection.close()
        self.temporary.cleanup()

    def test_online_wal_backup_and_manifest(self):
        self.assertTrue(Path(str(self.source) + "-wal").exists())
        result = create_snapshot(self.source, self.target)
        self.assertTrue(result["ok"])
        verify_manifest(self.target, Path(result["manifest"]))
        connection = sqlite3.connect(self.target)
        try:
            self.assertEqual(connection.execute("SELECT amount FROM sample").fetchone(), (100,))
        finally:
            connection.close()
        self.assertFalse(Path(str(self.target) + "-wal").exists())

    def test_snapshot_never_overwrites_existing_file(self):
        self.target.write_bytes(b"keep-this")
        with self.assertRaises(FileExistsError):
            create_snapshot(self.source, self.target)
        self.assertEqual(self.target.read_bytes(), b"keep-this")

    def test_manifest_rejects_tampered_snapshot(self):
        result = create_snapshot(self.source, self.target)
        with self.target.open("ab") as stream:
            stream.write(b"modified")
        with self.assertRaises(ValueError):
            verify_manifest(self.target, Path(result["manifest"]))

    def test_guard_rejects_escape_and_missing_source(self):
        with self.assertRaises(ValueError):
            guarded_path(self.copies / "elsewhere.sqlite", self.data, exists=False)
        with self.assertRaises(ValueError):
            guarded_path(self.data / ".." / "backups" / "bad.sqlite", self.data, exists=False)
        with self.assertRaises(FileNotFoundError):
            guarded_path(self.data / "missing.sqlite", self.data)

    def test_backup_cli_rejects_missing_source_without_creating_database(self):
        missing = self.data / "missing.sqlite"
        args = ["backup.py", "--data-root", str(self.data), "--backup-root", str(self.copies),
                "--source", str(missing)]
        with patch.object(sys, "argv", args), redirect_stderr(io.StringIO()) as captured:
            self.assertEqual(backup.main(), 1)
        self.assertFalse(json.loads(captured.getvalue())["ok"])
        self.assertFalse(missing.exists())

    def test_restore_stops_validates_preserves_and_replaces(self):
        result = create_snapshot(self.source, self.target)
        self.connection.execute("UPDATE sample SET amount = 200")
        self.connection.commit()
        self.connection.close()
        calls = []

        def fake_systemctl(*args):
            calls.append(args)
            if "--property=EnvironmentFiles" in args:
                return "/etc/luckycat-bank/bank.env (ignore_errors=no)"
            if "--property=ActiveState" in args:
                return "inactive"
            if "--property=MainPID" in args:
                return "0"
            return ""

        @contextmanager
        def fake_lock(*_args):
            yield

        args = ["restore.py", "--snapshot", str(self.target), "--target", str(self.source),
                "--data-root", str(self.data), "--backup-root", str(self.copies),
                "--confirm-restore", "STOP-AND-RESTORE"]
        with patch.object(sys, "argv", args), patch.object(sys, "platform", "linux"), \
             patch.object(os, "geteuid", return_value=0, create=True), \
             patch.object(os, "chown", create=True), \
             patch.object(os, "link", side_effect=lambda source, target: shutil.copyfile(source, target)), \
             patch.object(restore, "systemctl", side_effect=fake_systemctl), \
             patch.object(restore, "exclusive_lock", fake_lock), redirect_stdout(io.StringIO()) as captured:
            self.assertEqual(restore.main(), 0)
        self.assertEqual(json.loads(captured.getvalue())["service_state"], "stopped")
        connection = sqlite3.connect(self.source)
        try:
            self.assertEqual(connection.execute("SELECT amount FROM sample").fetchone(), (100,))
        finally:
            connection.close()
        preserved = list(self.copies.glob("pre-restore-*.sqlite"))
        self.assertEqual(len(preserved), 1)
        connection = sqlite3.connect(preserved[0])
        try:
            self.assertEqual(connection.execute("SELECT amount FROM sample").fetchone(), (200,))
        finally:
            connection.close()
        self.assertTrue(any(call[0] == "stop" for call in calls))
        self.assertFalse(any(call[0] in ("start", "restart") for call in calls))
        self.assertEqual(len(list(self.data.glob("pre-restore-files-*/restore-record.json"))), 1)

    def test_restore_bad_manifest_does_not_stop_service(self):
        result = create_snapshot(self.source, self.target)
        manifest_path = Path(result["manifest"])
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["sha256"] = "0" * 64
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        args = ["restore.py", "--snapshot", str(self.target), "--target", str(self.source),
                "--data-root", str(self.data), "--backup-root", str(self.copies),
                "--confirm-restore", "STOP-AND-RESTORE"]
        with patch.object(sys, "argv", args), patch.object(sys, "platform", "linux"), \
             patch.object(os, "geteuid", return_value=0, create=True), \
             patch.object(restore, "systemctl") as manager, redirect_stderr(io.StringIO()):
            self.assertEqual(restore.main(), 1)
        manager.assert_not_called()
        self.assertFalse(list(self.data.glob("pre-restore-files-*")))

    def test_restore_refuses_if_service_did_not_stop(self):
        create_snapshot(self.source, self.target)

        def active_systemctl(*args):
            if "--property=EnvironmentFiles" in args:
                return "/etc/luckycat-bank/bank.env (ignore_errors=no)"
            if "--property=ActiveState" in args:
                return "active"
            if "--property=MainPID" in args:
                return "123"
            return ""

        args = ["restore.py", "--snapshot", str(self.target), "--target", str(self.source),
                "--data-root", str(self.data), "--backup-root", str(self.copies),
                "--confirm-restore", "STOP-AND-RESTORE"]
        with patch.object(sys, "argv", args), patch.object(sys, "platform", "linux"), \
             patch.object(os, "geteuid", return_value=0, create=True), \
             patch.object(restore, "systemctl", side_effect=active_systemctl), \
             redirect_stderr(io.StringIO()):
            self.assertEqual(restore.main(), 1)
        self.assertEqual(self.connection.execute("SELECT amount FROM sample").fetchone(), (100,))
        self.assertFalse(list(self.copies.glob("pre-restore-*.sqlite")))


if __name__ == "__main__":
    unittest.main()
