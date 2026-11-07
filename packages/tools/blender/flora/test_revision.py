"""Process ownership, failure retention, and qualification race regressions (no Blender)."""

import fcntl
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from export_transaction import export_transaction
from receipts import STEMS, atomic_json, consume_current, sha, write_json
from validate_exports import validate

HERE = Path(__file__).resolve().parent


def wait_for(predicate, timeout=8):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("deadline waiting for condition")


def live(pid):
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "stat="],
        check=False,
        capture_output=True,
        text=True,
        timeout=2,
    )
    return bool(result.stdout.strip()) and not result.stdout.strip().startswith("Z")


class Report:
    def __init__(self, status="PASS"):
        self.status = status

    def write(self, path, _rel):
        write_json(path, {"status": self.status})


class RevisionTests(unittest.TestCase):
    def setUp(self):
        retained = os.environ.get("T05_TEST_EVIDENCE")
        if retained:
            Path(retained).mkdir(parents=True, exist_ok=True)
            self.temp = None
            self.root = Path(
                tempfile.mkdtemp(prefix=self._testMethodName + "-", dir=retained)
            )
            print("CASE_DIR", self.root, flush=True)
        else:
            self.temp = tempfile.TemporaryDirectory(prefix="t05-regression-")
            self.root = Path(self.temp.name)
        self.sources = self.root / "sources/flora"
        self.exports = self.root / "models/flora"
        self.evidence = self.root / "evidence"
        self.sources.mkdir(parents=True)
        self.exports.mkdir(parents=True)
        for stem in STEMS:
            (self.sources / (stem + ".blend")).write_bytes(("source " + stem).encode())
            (self.exports / (stem + ".glb")).write_bytes(("prior " + stem).encode())

    def tearDown(self):
        if self.temp is not None:
            self.temp.cleanup()

    def current(self):
        return json.loads((self.evidence / "latest.json").read_text())

    def audit(self, sources, output):
        for source in sources:
            Report().write(output / (source.name + ".json"), str)
        return {"files": {p.name: {"sha256": sha(p)} for p in sources}, "meshes": {}}

    def loader(self, attempt, manifest, exports):
        # Lightweight race/receipt tests substitute the expensive boundary.
        # Actual geometry/pair negatives are separately run through real Blender + GLTFLoader.
        write_json(
            attempt.path / "consumer.json",
            {
                "run_id": attempt.id,
                "exit": 0,
                "manifest_sha256": sha(manifest),
                "exports": {stem: sha(exports / (stem + ".glb")) for stem in STEMS},
            },
        )
        write_json(
            attempt.path / "consumer-tests.json",
            {"success": True, "numPassedTests": 130, "numFailedTests": 0},
        )
        (attempt.path / "consumer.log").write_text("controlled consumer boundary\n")

    def validate(self, validator=None, loader=None):
        return validate(
            self.sources,
            self.exports,
            self.evidence,
            source_auditor=self.audit,
            export_validator=validator or (lambda *_: Report()),
            consumer_check=loader or self.loader,
        )

    def test_current_failure_replaces_success_and_history_is_immutable(self):
        self.assertEqual(self.validate(), 0)
        consume_current(self.evidence)
        previous = {
            p: sha(p) for p in (self.evidence / "attempts").rglob("*") if p.is_file()
        }
        self.assertEqual(self.validate(lambda *_: Report("FAIL")), 1)
        self.assertEqual(self.current()["status"], "FAIL")
        with self.assertRaisesRegex(ValueError, "not PASS"):
            consume_current(self.evidence)
        self.assertTrue(all(sha(p) == digest for p, digest in previous.items()))

    def test_source_export_and_snapshot_races_fail(self):
        for mode in ("source", "export", "snapshot"):
            with self.subTest(mode=mode):
                self.validate()

                def mutate(attempt, manifest, exports, mode=mode):
                    self.loader(attempt, manifest, exports)
                    path = {
                        "source": self.sources / (STEMS[0] + ".blend"),
                        "export": self.exports / (STEMS[0] + ".glb"),
                        "snapshot": exports / (STEMS[0] + ".glb"),
                    }[mode]
                    path.write_bytes(("unvalidated replacement-" + mode).encode())

                with self.assertRaisesRegex(RuntimeError, "input changed"):
                    self.validate(loader=mutate)
                self.assertEqual(self.current()["status"], "FAIL")
                with self.assertRaises(ValueError):
                    consume_current(self.evidence)

    def test_closed_receipt_detects_changed_assets_reports_and_missing_evidence(self):
        for mode in ("source", "export", "source_manifest", "consumer_log", "receipt"):
            with self.subTest(mode=mode):
                self.validate()
                folder = self.evidence / self.current()["receipt"]
                folder = folder.parent
                path = {
                    "source": self.sources / (STEMS[0] + ".blend"),
                    "export": self.exports / (STEMS[0] + ".glb"),
                    "source_manifest": folder / "source_manifest.json",
                    "consumer_log": folder / "consumer.log",
                    "receipt": folder / "receipt.json",
                }[mode]
                old = path.read_bytes()
                path.write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    consume_current(self.evidence)
                path.write_bytes(old)

    def test_malformed_receipt_bindings_are_rejected_even_with_updated_closure(self):
        for mode in ("run", "source_binding", "tests", "stock_report"):
            with self.subTest(mode=mode):
                self.validate()
                latest = self.current()
                folder = (self.evidence / latest["receipt"]).parent
                name = {
                    "run": "consumer.json",
                    "source_binding": "export_manifest.json",
                    "tests": "consumer-tests.json",
                    "stock_report": "reports/exports/" + STEMS[0] + ".glb.json",
                }[mode]
                path = folder / name
                data = json.loads(path.read_text())
                if mode == "run":
                    data["run_id"] = "wrong-attempt"
                elif mode == "source_binding":
                    data["exports"][0]["source_sha256"] = "0" * 64
                elif mode == "tests":
                    data["numPassedTests"] = 0
                else:
                    data["status"] = "FAIL"
                atomic_json(path, data)
                closure = json.loads((folder / "closure.json").read_text())
                closure[name] = sha(path)
                atomic_json(folder / "closure.json", closure)
                latest["closure_sha256"] = sha(folder / "closure.json")
                atomic_json(self.evidence / "latest.json", latest)
                with self.assertRaises(ValueError):
                    consume_current(self.evidence)

    def test_missing_source_fails_current_before_audit(self):
        self.validate()
        (self.sources / (STEMS[1] + ".blend")).unlink()
        with self.assertRaises(FileNotFoundError):
            self.validate()
        self.assertEqual(self.current()["status"], "FAIL")

    def test_export_failures_preserve_prior_assets_reports_and_rejected_bytes(self):
        for mode in (
            "missing",
            "pointer",
            "corrupt",
            "source_fail",
            "crash",
            "export_fail",
            "incomplete",
        ):
            with self.subTest(mode=mode):
                for stem in STEMS:
                    (self.sources / (stem + ".blend")).write_bytes(b"saved source")
                    (self.exports / (stem + ".glb")).write_bytes(b"prior runtime")
                prior = {
                    p: sha(p)
                    for p in self.evidence.rglob("*")
                    if p.is_file() and p.name != "latest.json"
                }
                source = self.sources / (STEMS[0] + ".blend")
                if mode == "missing":
                    source.unlink()
                if mode == "pointer":
                    source.write_bytes(b"version https://git-lfs.github.com/spec/v1\n")

                def source_check(path, mode=mode):
                    if mode == "corrupt":
                        raise RuntimeError("load failure")
                    return Report("FAIL" if mode == "source_fail" else "PASS")

                def invoke(_family, args, mode=mode):
                    out = Path(args[args.index("--out-dir") + 1]) / "flora"
                    reports = Path(args[args.index("--report-dir") + 1])
                    reports.mkdir(parents=True)
                    (reports / "rejected.glb").write_bytes(b"rejected-" + mode.encode())
                    if mode == "crash":
                        raise RuntimeError("export exception")
                    if mode == "export_fail":
                        return 1
                    out.mkdir(parents=True)
                    (out / (STEMS[0] + ".glb")).write_bytes(b"only one output")
                    return 0

                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    export_transaction(
                        self.sources.parent,
                        self.exports.parent,
                        self.evidence,
                        invoke,
                        source_check,
                    )
                self.assertEqual(self.current()["status"], "FAIL")
                self.assertFalse(list(self.exports.glob("*.glb")))
                folder = (self.evidence / self.current()["receipt"]).parent
                self.assertEqual(
                    [p.read_bytes() for p in (folder / "prior-assets").glob("*.glb")],
                    [b"prior runtime"] * 3,
                )
                self.assertTrue(all(sha(p) == digest for p, digest in prior.items()))

    def test_successful_export_preserves_history_and_requires_separate_validation(self):
        def invoke(_family, args):
            out = Path(args[args.index("--out-dir") + 1]) / "flora"
            out.mkdir(parents=True)
            for stem in STEMS:
                (out / (stem + ".glb")).write_bytes(b"new runtime")
            return 0

        self.assertEqual(
            export_transaction(
                self.sources.parent,
                self.exports.parent,
                self.evidence,
                invoke,
                lambda _: Report(),
            ),
            0,
        )
        self.assertEqual(
            [p.read_bytes() for p in self.exports.glob("*.glb")], [b"new runtime"] * 3
        )
        with self.assertRaises(ValueError):
            consume_current(self.evidence)

    def run_process_case(self, mode):
        case = self.root / mode
        case.mkdir()
        if mode == "leader_exit":
            (case / "leader_exit").touch()
        child = case / "child.py"
        child.write_text("""import os,signal,time
from pathlib import Path
p=Path.cwd()
signal.signal(signal.SIGTERM,lambda *_:(p/'term_seen').touch())
(p/'child_pid').write_text(str(os.getpid()))
pid=os.fork()
if pid==0:
 (p/'grandchild_pid').write_text(str(os.getpid()))
 while True: time.sleep(.05)
print('READY',flush=True)
if (p/'leader_exit').exists(): os._exit(0)
while True: time.sleep(.05)
""")
        driver = case / "driver.py"
        driver.write_text(f"""import sys
from pathlib import Path
sys.path.insert(0,{str(HERE)!r})
from run_cpu import run
sys.exit(run([sys.executable,'-B',{str(child)!r}],log=Path('runner.log'),timeout={0.5 if mode == "timeout" else 30},root=Path.cwd(),lock_path=Path('lane.lock')))
""")
        log = case / "runner.log"
        with (case / "driver.log").open("x") as output:
            proc = subprocess.Popen(
                [sys.executable, "-B", str(driver)],
                cwd=case,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            children = []
            try:
                wait_for(
                    lambda: all(
                        (case / name).exists()
                        and (case / name).read_text().strip().isdigit()
                        for name in ("child_pid", "grandchild_pid")
                    )
                )
                children = [
                    int((case / name).read_text())
                    for name in ("child_pid", "grandchild_pid")
                ]
                if mode == "contention":
                    wait_for(lambda: b"READY" in log.read_bytes())
                    before = log.read_bytes()
                    other = subprocess.run(
                        [sys.executable, "-B", str(driver)],
                        cwd=case,
                        check=False,
                        capture_output=True,
                        timeout=5,
                    )
                    self.assertEqual(other.returncode, 73)
                    self.assertEqual(log.read_bytes(), before)
                if mode not in ("timeout", "leader_exit"):
                    proc.send_signal(
                        signal.SIGTERM if mode == "sigterm" else signal.SIGINT
                    )
                    wait_for(lambda: (case / "term_seen").exists())
                    # Cancellation while TERM is resisted, including mixed repeat signals.
                    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGINT):
                        proc.send_signal(sig)
                    with (
                        (case / "lane.lock").open("a") as lock,
                        self.assertRaises(BlockingIOError),
                    ):
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                proc.wait(timeout=12)
                self.assertEqual(
                    proc.returncode,
                    0
                    if mode == "leader_exit"
                    else 124
                    if mode == "timeout"
                    else 143
                    if mode == "sigterm"
                    else 130,
                    (case / "driver.log").read_text(),
                )
                self.assertTrue(all(not live(pid) for pid in children))
                self.assertIn(b"EXIT ", log.read_bytes())
                before = log.read_bytes()
                retry = subprocess.run(
                    [sys.executable, "-B", str(driver)],
                    cwd=case,
                    check=False,
                    capture_output=True,
                    timeout=5,
                )
                self.assertNotEqual(retry.returncode, 0)
                self.assertEqual(log.read_bytes(), before)
                with (case / "lane.lock").open("a") as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=3)
                if not children:
                    for name in ("child_pid", "grandchild_pid"):
                        path = case / name
                        if path.exists() and path.read_text().strip().isdigit():
                            children.append(int(path.read_text()))
                if children and any(live(pid) for pid in children):
                    try:
                        os.killpg(children[0], signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    wait_for(lambda: all(not live(pid) for pid in children))

    def test_process_ownership_signals_timeout_descendants_and_log_contention(self):
        for mode in (
            "sigterm",
            "double_sigint",
            "timeout",
            "contention",
            "leader_exit",
        ):
            with self.subTest(mode=mode):
                self.run_process_case(mode)


if __name__ == "__main__":
    unittest.main(verbosity=2)
