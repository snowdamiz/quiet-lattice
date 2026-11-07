"""Real filesystem controls for caller aliases and failure-safe prior preservation."""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from export_transaction import export_transaction
from file_protocol import archive_outputs, read_bound, verify_bound
from receipts import ROOT, STEMS, Attempt, sha, write_json


class FileProtocolTests(unittest.TestCase):
    def setUp(self):
        retained = os.environ.get("T05_TEST_EVIDENCE")
        self.temp = None
        if retained:
            Path(retained).mkdir(parents=True, exist_ok=True)
            self.root = Path(
                tempfile.mkdtemp(prefix=self._testMethodName + "-", dir=retained)
            )
        else:
            self.temp = tempfile.TemporaryDirectory(prefix="t05-files-")
            self.root = Path(self.temp.name)
        self.runtime = self.root / "models/flora"
        self.runtime.mkdir(parents=True)
        self.sources = self.root / "sources/flora"
        self.sources.mkdir(parents=True)
        self.originals = ROOT / "packages/client/public/models/flora"
        for stem in STEMS:
            shutil.copyfile(
                self.originals / (stem + ".glb"), self.runtime / (stem + ".glb")
            )
            shutil.copyfile(
                ROOT / "assets/blend/flora" / (stem + ".blend"),
                self.sources / (stem + ".blend"),
            )
        (self.sources / (STEMS[2] + ".blend")).unlink()

    def tearDown(self):
        if self.temp:
            self.temp.cleanup()

    def fail_export(self):
        def forbidden(*_):
            raise AssertionError("must not reach source/export callback")

        with self.assertRaises((RuntimeError, FileNotFoundError)):
            export_transaction(
                self.sources.parent,
                self.runtime.parent,
                self.root / "evidence",
                forbidden,
                forbidden,
            )
        latest = json.loads((self.root / "evidence/latest.json").read_text())
        self.assertEqual(latest["status"], "FAIL")
        self.assertFalse(list(self.runtime.iterdir()))
        return (self.root / "evidence" / latest["receipt"]).parent

    def test_unreadable_prior_still_invalidates_every_runtime_name(self):
        blocked = self.runtime / (STEMS[1] + ".glb")
        blocked.chmod(0)
        folder = self.fail_export()
        records = json.loads((folder / "prior-assets.json").read_text())
        self.assertTrue(all(row["invalidated"] for row in records))
        self.assertEqual(records[1]["errors"][0]["errno"], 13)
        held = folder / "prior-assets/quarantine" / blocked.name
        self.assertEqual(held.stat().st_mode & 0o777, 0)
        receipt = json.loads((folder / "receipt.json").read_text())
        self.assertIn(
            "prior-assets/quarantine/" + blocked.name, receipt["closure_errors"]
        )
        # This is our scratch fixture only: recover permission after asserting the
        # failure so retained archives can verify the preserved otherwise unreadable bytes.
        held.chmod(0o600)
        self.assertEqual(sha(held), sha(self.originals / blocked.name))
        write_json(
            self.root / "scratch-permission-recovery.json",
            {"file": str(held), "before": "000", "after": "600", "sha256": sha(held)},
        )
        for stem in (STEMS[0], STEMS[2]):
            self.assertEqual(
                sha(folder / "prior-assets" / (stem + ".glb")),
                sha(self.originals / (stem + ".glb")),
            )

    def test_symlink_relative_symlink_and_hardlink_archives_detach(self):
        backing = self.root / "backing"
        backing.mkdir()
        before = {}
        for i, path in enumerate(sorted(self.runtime.iterdir())):
            dest = backing / path.name
            path.rename(dest)
            before[path.name] = sha(dest)
            if i == 0:
                path.symlink_to(dest)
            elif i == 1:
                path.symlink_to(os.path.relpath(dest, path.parent))
            else:
                os.link(dest, path)
        folder = self.fail_export()
        old = {
            str(p.relative_to(folder)): sha(p) for p in folder.rglob("*") if p.is_file()
        }
        for p in backing.iterdir():
            p.write_bytes(b"external owner changed its bytes")
        for name, value in before.items():
            archived = folder / "prior-assets" / name
            self.assertFalse(archived.is_symlink())
            self.assertEqual(archived.stat().st_nlink, 1)
            self.assertEqual(sha(archived), value)
        self.assertEqual(
            old,
            {
                str(p.relative_to(folder)): sha(p)
                for p in folder.rglob("*")
                if p.is_file()
            },
        )
        self.assertEqual(len(list(backing.iterdir())), 3)

    def test_unreadable_and_dangling_external_targets_are_never_changed(self):
        backing = self.root / "external.glb"
        backing.write_bytes(b"private external bytes")
        backing.chmod(0)
        info = backing.stat()
        for i, path in enumerate(sorted(self.runtime.iterdir())[:2]):
            path.unlink()
            path.symlink_to(backing if i == 0 else self.root / "missing-external")
        folder = self.fail_export()
        self.assertEqual(backing.stat(), info)
        self.assertFalse(any(p.is_symlink() for p in folder.rglob("*")))
        records = json.loads((folder / "prior-assets.json").read_text())
        self.assertTrue(records[0]["errors"] and records[1]["errors"])
        backing.chmod(0o600)  # recover only this test's external scratch fixture

    def test_unremovable_name_is_reported_and_other_names_are_invalidated(self):
        blocked = self.root / "blocked"
        blocked.mkdir()
        p = blocked / "non_tree_blocked.glb"
        p.write_bytes(b"cannot remove")
        blocked.chmod(0o500)
        destination = self.root / "archive"
        try:
            with self.assertRaisesRegex(RuntimeError, "preservation failed"):
                archive_outputs([p, *sorted(self.runtime.iterdir())], destination)
            records = json.loads(destination.with_suffix(".json").read_text())
            self.assertFalse(records[0]["invalidated"])
            self.assertEqual(records[0]["errors"][0]["errno"], 13)
            self.assertTrue(p.exists())
            self.assertFalse(list(self.runtime.iterdir()))
        finally:
            blocked.chmod(0o700)

    def test_looping_alias_is_invalidated_and_error_is_retained(self):
        path = self.runtime / (STEMS[0] + ".glb")
        path.unlink()
        path.symlink_to(path.name)
        folder = self.fail_export()
        records = json.loads((folder / "prior-assets.json").read_text())
        self.assertTrue(records[0]["invalidated"])
        self.assertTrue(records[0]["errors"])
        self.assertEqual(records[0]["link"], path.name)
        self.assertFalse(any(p.is_symlink() for p in folder.rglob("*")))

    def test_aliases_to_another_owned_output_preserve_its_payload(self):
        target = self.runtime / (STEMS[0] + ".glb")
        before = sha(target)
        for stem in STEMS[1:]:
            p = self.runtime / (stem + ".glb")
            p.unlink()
            p.symlink_to(target.name)
        folder = self.fail_export()
        for stem in STEMS:
            self.assertEqual(sha(folder / "prior-assets" / (stem + ".glb")), before)

    def test_leaf_ancestor_identical_bytes_and_tmp_alias_binding(self):
        left = self.root / "left"
        right = self.root / "right"
        left.mkdir()
        right.mkdir()
        for folder in (left, right):
            (folder / "same.glb").write_bytes(b"identical bytes")
        alias = self.root / "alias"
        alias.symlink_to(left)
        bound, _ = read_bound(alias / "same.glb")
        alias.unlink()
        alias.symlink_to(right)
        with self.assertRaisesRegex(RuntimeError, "input changed"):
            verify_bound(bound)
        leaf = self.root / "requested.glb"
        leaf.symlink_to(left / "same.glb")
        with Attempt(self.root / "identity-evidence", "test") as attempt:
            snapshot = attempt.snapshot(leaf, "exports")
            self.assertEqual(snapshot.name, "requested.glb")
            leaf.unlink()
            leaf.symlink_to(right / "same.glb")
            with self.assertRaisesRegex(RuntimeError, "input changed"):
                attempt.assert_stable()
        if str(self.root).startswith("/private/tmp/"):
            routed = (
                Path(str(self.root).replace("/private/tmp/", "/tmp/", 1))
                / "right/same.glb"
            )
            bound, _ = read_bound(routed)
            verify_bound(bound)
            self.assertTrue(bound["path"].startswith("/tmp/"))
            self.assertTrue(bound["resolved_path"].startswith("/private/tmp/"))


if __name__ == "__main__":
    unittest.main()
