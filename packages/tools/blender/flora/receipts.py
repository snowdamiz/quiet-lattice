"""Task-local immutable attempt evidence and fail-closed current qualification."""

import fcntl
import hashlib
import json
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
STEMS = ("non_tree_foliage", "non_tree_resources", "non_tree_stone")
DEFAULT_EVIDENCE = ROOT / "assets/renders/flora/t05/revision7"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def atomic_json(path, value):
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    write_json(temp, value)
    os.replace(temp, path)


def tool_paths():
    return sorted(
        [
            *Path(__file__).parent.glob("*.py"),
            *Path(__file__).parent.parent.joinpath("artlib").rglob("*.py"),
            Path(__file__).parent.parent / "families.json",
            Path(__file__).parent.parent / "material_mask_selftest.py",
            Path(__file__).parent.parent / "selftest.py",
            ROOT / "packages/client/test/floraAssets.test.js",
            ROOT / "packages/client/src/core/Engine.js",
            ROOT / "packages/client/src/gameplay/modelLibrary.js",
            ROOT / "packages/client/src/gameplay/floraModels.js",
        ]
    )


class Attempt:
    def __init__(self, evidence, operation):
        self.evidence = Path(evidence).resolve()
        self.operation = operation
        self.id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex
        self.path = self.evidence / "attempts" / self.id
        self.inputs = []
        self.finished = False

    def __enter__(self):
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.lock = (self.evidence / ".lock").open("a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.path.mkdir(parents=True, exist_ok=False)
            latest = self.evidence / "latest.json"
            previous = json.loads(latest.read_text()) if latest.exists() else None
            # Invalidate current success before reading inputs or running any checks.
            atomic_json(
                latest,
                {"run_id": self.id, "status": "RUNNING", "operation": self.operation},
            )
            write_json(
                self.path / "start.json",
                {
                    "run_id": self.id,
                    "operation": self.operation,
                    "previous": previous,
                    "command": sys.argv,
                    "python": sys.version,
                    "executable": sys.executable,
                    "tool_hashes": {
                        str(p.relative_to(ROOT)): sha(p)
                        for p in tool_paths()
                        if p.is_file()
                    },
                },
            )
            return self
        except BaseException:
            self.lock.close()
            raise

    def snapshot(self, path, category):
        path = Path(path).resolve()
        target = self.path / "inputs" / category / "flora" / path.name
        row = {
            "path": str(path),
            "snapshot": str(target.relative_to(self.path)),
            "sha256": None,
        }
        self.inputs.append(row)
        data = path.read_bytes()
        row["sha256"] = hashlib.sha256(data).hexdigest()
        row["bytes"] = len(data)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(data)
        if sha(path) != row["sha256"]:
            raise RuntimeError(f"input changed during snapshot: {path}")
        if category == "sources" and data.startswith(
            b"version https://git-lfs.github.com/spec/v1"
        ):
            raise RuntimeError(f"LFS pointer source: {path}")
        return target

    def assert_stable(self):
        for row in self.inputs:
            for p in (Path(row["path"]), self.path / row["snapshot"]):
                if row["sha256"] is None or sha(p) != row["sha256"]:
                    raise RuntimeError(f"input changed during attempt: {p}")
        start = json.loads((self.path / "start.json").read_text())
        for path, digest in start["tool_hashes"].items():
            if sha(ROOT / path) != digest:
                raise RuntimeError(f"tool changed during attempt: {path}")

    def finish(self, status, **details):
        if self.finished:
            raise RuntimeError("attempt already sealed")
        if status == "PASS":
            self.assert_stable()
        after = []
        for row in self.inputs:
            observed = {}
            for label, path in (
                ("current", Path(row["path"])),
                ("snapshot", self.path / row["snapshot"]),
            ):
                try:
                    observed[label] = sha(path)
                except OSError:
                    observed[label] = None
            after.append({"path": row["path"], **observed})
        if status == "PASS" and any(
            row["sha256"] != obs[key]
            for row, obs in zip(self.inputs, after)
            for key in ("current", "snapshot")
        ):
            raise RuntimeError("input changed while sealing attempt")
        receipt = {
            "schema": 1,
            "run_id": self.id,
            "operation": self.operation,
            "status": status,
            "inputs": self.inputs,
            "after": after,
            **details,
        }
        write_json(self.path / "receipt.json", receipt)
        closure = {
            str(p.relative_to(self.path)): sha(p)
            for p in sorted(self.path.rglob("*"))
            if p.is_file()
        }
        write_json(self.path / "closure.json", closure)
        atomic_json(
            self.evidence / "latest.json",
            {
                "run_id": self.id,
                "operation": self.operation,
                "status": status,
                "receipt": str((self.path / "receipt.json").relative_to(self.evidence)),
                "closure_sha256": sha(self.path / "closure.json"),
            },
        )
        self.finished = True
        return receipt

    def __exit__(self, typ, value, tb):
        try:
            if not self.finished:
                self.finish(
                    "FAIL", error=str(value or "attempt ended without qualification")
                )
        finally:
            self.lock.close()


def consume_current(evidence):
    """Only a current, closed, byte-matching validation PASS can qualify assets."""
    evidence = Path(evidence).resolve()
    current = json.loads((evidence / "latest.json").read_text())
    if current["status"] != "PASS" or current["operation"] != "validate":
        raise ValueError("current validation is not PASS")
    receipt_path = (evidence / current["receipt"]).resolve()
    if not receipt_path.is_relative_to(evidence / "attempts"):
        raise ValueError("receipt is outside attempt history")
    folder = receipt_path.parent
    if sha(folder / "closure.json") != current["closure_sha256"]:
        raise ValueError("evidence closure changed")
    closure = json.loads((folder / "closure.json").read_text())
    required = {
        "receipt.json",
        "start.json",
        "source_manifest.json",
        "consumer.json",
        "consumer.log",
        "consumer-tests.json",
        "export_manifest.json",
    }
    if not required.issubset(closure):
        raise ValueError("incomplete evidence closure")
    for name, digest in closure.items():
        path = (folder / name).resolve()
        if not path.is_relative_to(folder) or sha(path) != digest:
            raise ValueError(f"evidence changed: {name}")
    receipt = json.loads(receipt_path.read_text())
    if (
        receipt["status"] != "PASS"
        or receipt["run_id"] != current["run_id"]
        or receipt["operation"] != "validate"
    ):
        raise ValueError("receipt identity mismatch")
    expected = {s + ext for s in STEMS for ext in (".blend", ".glb")}
    if {Path(row["path"]).name for row in receipt["inputs"]} != expected or len(
        receipt["inputs"]
    ) != 6:
        raise ValueError("incomplete input pairs")
    for row in receipt["inputs"]:
        if (
            sha(row["path"]) != row["sha256"]
            or sha(folder / row["snapshot"]) != row["sha256"]
        ):
            raise ValueError(f"validated input changed: {row['path']}")
    source_manifest = json.loads((folder / "source_manifest.json").read_text())
    export_manifest = json.loads((folder / "export_manifest.json").read_text())
    consumer = json.loads((folder / "consumer.json").read_text())
    tests = json.loads((folder / "consumer-tests.json").read_text())
    for record in (source_manifest, export_manifest, consumer):
        if record.get("run_id") != current["run_id"]:
            raise ValueError("evidence run identity mismatch")
    if consumer.get("exit") != 0 or consumer.get("manifest_sha256") != sha(
        folder / "source_manifest.json"
    ):
        raise ValueError("consumer did not validate this source manifest")
    if (
        not tests.get("success")
        or tests.get("numPassedTests", 0) < 130
        or tests.get("numFailedTests") != 0
    ):
        raise ValueError("consumer tests incomplete")
    hashes = {Path(row["path"]).name: row["sha256"] for row in receipt["inputs"]}
    if len(export_manifest["exports"]) != 3 or {
        row["file"] for row in export_manifest["exports"]
    } != {s + ".glb" for s in STEMS}:
        raise ValueError("incomplete export reports")
    for stem in STEMS:
        source, export = stem + ".blend", stem + ".glb"
        entry = next(row for row in export_manifest["exports"] if row["file"] == export)
        if (
            source_manifest["files"][source]["sha256"] != hashes[source]
            or entry["source_sha256"] != hashes[source]
            or entry["sha256"] != hashes[export]
            or entry["status"] != "PASS"
            or consumer["exports"][stem] != hashes[export]
        ):
            raise ValueError("source/export/consumer binding mismatch")
        for mode, name in (("sources", source), ("exports", export)):
            report_path = f"reports/{mode}/{name}.json"
            if (
                report_path not in closure
                or json.loads((folder / report_path).read_text())["status"] != "PASS"
            ):
                raise ValueError("missing successful full validator report")
    if len(receipt.get("after", [])) != 6 or any(
        row["current"] != hashes[Path(row["path"]).name]
        or row["snapshot"] != row["current"]
        for row in receipt["after"]
    ):
        raise ValueError("before/after hash mismatch")
    start = json.loads((folder / "start.json").read_text())
    for name, digest in start["tool_hashes"].items():
        if sha(ROOT / name) != digest:
            raise ValueError(f"validation tool changed: {name}")
    # Re-read the mutable selector after consuming the immutable closure.
    if json.loads((evidence / "latest.json").read_text()) != current:
        raise ValueError("current attempt changed while consuming receipt")
    return receipt
