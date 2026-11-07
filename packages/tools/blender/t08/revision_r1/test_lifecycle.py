"""Real caller/stock-export/process boundaries; inert CPU dependencies, serial fixtures."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def group(pgid):
    lines = subprocess.check_output(
        ["ps", "-axo", "pid=,pgid=,stat="], text=True, timeout=3
    )
    return [line.strip() for line in lines.splitlines() if int(line.split()[1]) == pgid]


def until(predicate, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(0.02)
    raise TimeoutError("fixture barrier/termination not observed")


def jsonfile(path):
    return json.loads(path.read_text()) if path.is_file() else None


class Harness:
    def __init__(self, code, evidence, selected=None):
        self.code = code
        self.evidence = evidence
        evidence.mkdir(parents=True, exist_ok=False)
        self.scratch = Path(tempfile.mkdtemp(prefix="t08-life-", dir="/tmp"))
        self.rows = []
        self.processes = []
        self.groups = set()
        self.selected = selected
        self.complete = False
        (evidence / "scratch.json").write_text(
            json.dumps({"root": str(self.scratch)}) + "\n"
        )

    def prepare(self, name, case, setup=None, family="props"):
        root = self.scratch / name
        root.mkdir()
        here = root / "packages/tools/blender/t08"
        here.mkdir(parents=True)
        for f in ["run.py", "export_saved.py"]:
            shutil.copyfile(self.code / f, here / f)
        # Exact shared entry/core bytes. No edits to the publishing caller or stock flow.
        for f in [
            "export_props.py",
            "export_sites.py",
            "artlib/__init__.py",
            "artlib/export.py",
        ]:
            target = here.parent / f
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / "packages/tools/blender" / f, target)
            assert sha(target) == sha(ROOT / "packages/tools/blender" / f)
        stems = (
            ["cargo_pod", "loot_pod"]
            if family == "props"
            else ["outpost_0", "beacon_0"]
        )
        inventory = [{"family": family, "stem": s} for s in stems]
        (here / "inventory.json").write_text(json.dumps(inventory))
        for item in inventory:
            for base, ext, data in [
                ("assets/blend", "blend", b"SOURCE-BYTES-v1"),
                ("packages/client/public/models", "glb", b"CURRENT-GLB"),
            ]:
                p = root / base / family / (item["stem"] + "." + ext)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
        src = root / "assets/blend" / family / (stems[0] + ".blend")
        dst = root / "packages/client/public/models" / family / (stems[0] + ".glb")
        if setup:
            setup(src, dst)
        fixtures = root / "cpu_dependencies"
        fixtures.mkdir()
        shutil.copyfile(
            HERE / "fixture_sitecustomize.py", fixtures / "sitecustomize.py"
        )
        shutil.copyfile(HERE / "fixture_blender.py", root / "fixture_blender.py")
        env = dict(
            os.environ,
            PYTHONPATH=str(fixtures),
            PYTHONDONTWRITEBYTECODE="1",
            T08_FIXTURE_ROOT=str(root),
            T08_CASE=case,
            PYTHONUNBUFFERED="1",
        )
        if case == "deny":
            env["T08_DENY_KILL"] = "1"
        return root, here, src, dst, env

    def run(
        self, name, case="ok", setup=None, interrupt=None, batch=False, family="props"
    ):
        if self.selected and name != "happy" and name not in self.selected:
            return {"expectationMet": True, "skipped": True}
        root, here, src, dst, env = self.prepare(name, case, setup, family)
        command = [
            sys.executable,
            "-B",
            str(here / "export_saved.py"),
            "--label",
            "probe",
            "--only",
            "cargo_pod,loot_pod" if batch else src.stem,
        ]
        log = self.evidence / (name + ".log")
        row = {
            "case": name,
            "dependencyFixture": True,
            "scratch": str(root),
            "command": command,
            "codeSHA256": {f: sha(here / f) for f in ["run.py", "export_saved.py"]},
        }
        try:
            with log.open("x") as output:
                proc = subprocess.Popen(
                    command,
                    cwd=root,
                    env=env,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                self.processes.append(proc)
                row["supervisorPID"] = proc.pid
                if interrupt:
                    until(lambda: (root / "validation-entered").exists())
                    producer = int((root / "producer.pid").read_text())
                    self.groups.add(producer)
                    target = (
                        proc.pid
                        if case == "outer_term"
                        else int((root / "runner.pid").read_text())
                        if (root / "runner.pid").exists()
                        else proc.pid
                    )
                    os.kill(target, interrupt)
                row["exit"] = proc.wait(timeout=35)
            if (root / "producer.pid").exists():
                self.groups.add(int((root / "producer.pid").read_text()))
            attempts = sorted((here / "exports").glob("*"))
            bindings = [
                jsonfile(p / "binding.json") or jsonfile(p / "binding-failure.json")
                for p in attempts
            ]
            row["bindings"] = bindings
            receipts = sorted(here.rglob("result.json"))
            row["receipts"] = [jsonfile(p) for p in receipts]
            row["receiptHashesBeforeRelease"] = {str(p): sha(p) for p in receipts}
            row["currentAbsentBeforeRelease"] = not os.path.lexists(dst)
            row["remainingBeforeRelease"] = (
                group(int((root / "producer.pid").read_text()))
                if (root / "producer.pid").exists()
                else []
            )
            if interrupt:
                # Release only AFTER the supervising caller returned; no sleep-timed publication assertion.
                (root / "release").write_text("go")
                until(lambda: not group(int((root / "producer.pid").read_text())), 10)
            row["currentAbsentAfterRelease"] = not os.path.lexists(dst)
            row["receiptHashesAfterRelease"] = {str(p): sha(p) for p in receipts}
            previous = [
                p / "previous.glb" for p in attempts if (p / "previous.glb").is_file()
            ]
            row["previous"] = [
                {
                    "isSymlink": p.is_symlink(),
                    "nlink": p.stat().st_nlink,
                    "bytes": p.read_text(),
                }
                for p in previous
            ]
            if (root / "backing.glb").exists():
                (root / "backing.glb").write_bytes(b"MUTATED-BACKING")
                row["detachedHistory"] = all(
                    p.read_bytes() == b"CURRENT-GLB"
                    and not p.is_symlink()
                    and p.stat().st_nlink == 1
                    for p in previous
                ) and bool(previous)
            row["stockMove"] = jsonfile(root / "stock-move.json")
            moves = root / "stock-moves.jsonl"
            row["stockMoves"] = (
                [json.loads(line) for line in moves.read_text().splitlines()]
                if moves.exists()
                else []
            )
            binding = next(
                (b for b in bindings if b and b["source"].endswith(src.name)),
                None,
            )
            passed = bool(binding and binding["status"] == "PASS")
            absent = not os.path.lexists(dst)
            receipt = row["receipts"][-1] if row["receipts"] else None
            if case == "ok":
                ok = (
                    row["exit"] == 0
                    and passed
                    and not dst.is_symlink()
                    and row["previous"]
                    and all(
                        p["bytes"] == "CURRENT-GLB" and p["nlink"] == 1
                        for p in row["previous"]
                    )
                )
                if name in ["symlink", "relative_symlink", "hardlink"]:
                    ok = (
                        ok
                        and row["detachedHistory"]
                        and dst.read_bytes() != b"MUTATED-BACKING"
                    )
            else:
                ok = row["exit"] != 0 and binding is not None and not passed and absent
                if case == "rename_denied":
                    ok = (
                        row["exit"] != 0
                        and binding is not None
                        and not passed
                        and not absent
                        and row["stockMove"] is None
                    )
                    ok = ok and binding.get("canonicalAbsent") is False
                if case == "observation_failure":
                    ok = (
                        ok
                        and receipt is not None
                        and receipt["remainingGroup"] is None
                        and not receipt["terminal"]
                    )
                if interrupt:
                    ok = (
                        ok
                        and receipt is not None
                        and not receipt["pass"]
                        and row["receiptHashesBeforeRelease"]
                        == row["receiptHashesAfterRelease"]
                    )
                    if case == "deny":
                        ok = (
                            ok
                            and bool(row["remainingBeforeRelease"])
                            and row["stockMove"] is not None
                            and not Path(row["stockMove"]["destination"])
                            .resolve()
                            .is_relative_to(
                                (root / "packages/client/public/models").resolve()
                            )
                        )
                        substitutions = (root / "substitution.jsonl").read_bytes()
                        retry = subprocess.run(
                            command,
                            cwd=root,
                            env=env,
                            capture_output=True,
                            text=True,
                            timeout=10,
                        )
                        row["retry"] = {
                            "exit": retry.returncode,
                            "stdout": retry.stdout,
                            "stderr": retry.stderr,
                        }
                        ok = (
                            ok
                            and retry.returncode != 0
                            and substitutions
                            == (root / "substitution.jsonl").read_bytes()
                            and not os.path.lexists(dst)
                        )
                    else:
                        ok = ok and not row["remainingBeforeRelease"]
                if batch:
                    ok = ok and any(
                        b
                        and b["status"] == "PASS"
                        and b["source"].endswith("loot_pod.blend")
                        for b in bindings
                    )
                if case == "old_unreadable" and binding and "archives" in binding:
                    old = binding["archives"][0]
                    ok = (
                        ok
                        and old["sha256"] is None
                        and old["quarantineRetained"]
                        and bool(old["errors"])
                    )
            if binding and binding.get("privateOutput"):
                for move in row["stockMoves"]:
                    owner = next(
                        (
                            b
                            for b in bindings
                            if b
                            and Path(b["privateOutput"]).resolve()
                            == Path(move["destination"]).resolve()
                        ),
                        None,
                    )
                    ok = ok and owner is not None
                    if owner:
                        ok = ok and Path(move["source"]).resolve().is_relative_to(
                            Path(owner["producer"]["tmpdir"]).resolve()
                        )
            if case == "ok" and passed:
                dst.write_bytes(b"MUTATED-RUNTIME-AFTER-PASS")
                row["historyAfterRuntimeMutation"] = [p.read_text() for p in previous]
                ok = ok and all(
                    x == "CURRENT-GLB" for x in row["historyAfterRuntimeMutation"]
                )
            row["expectationMet"] = bool(ok)
            row["failureTail20"] = log.read_text().splitlines()[-20:] if not ok else []
        except Exception as error:
            row.update(
                expectationMet=False,
                harnessError=repr(error),
                failureTail20=log.read_text().splitlines()[-20:]
                if log.exists()
                else [],
            )
        self.rows.append(row)
        print(name, row["expectationMet"], flush=True)
        (self.evidence / (name + ".json")).write_text(json.dumps(row, indent=2) + "\n")
        return row

    def runner(
        self, name, sig=None, deny=False, lock=False, limit=False, late_signal=False
    ):
        if self.selected and name not in self.selected:
            return
        root, here, src, dst, env = self.prepare(
            name, "signal_during_result" if late_signal else "deny" if deny else "ok"
        )
        probe = root / "probe.py"
        probe.write_text(
            "import os,time\nfrom pathlib import Path\nr=Path(__file__).parent\n(r/'producer.pid').write_text(str(os.getpid()))\n(r/'ready').write_text('ready')\nend=time.monotonic()+30\nwhile not (r/'release').exists():\n if time.monotonic()>end: raise TimeoutError('barrier')\n time.sleep(.02)\n(r/'done').write_text('done')\n"
        )
        command = [
            sys.executable,
            "-B",
            str(here / "run.py"),
            "--label",
            name,
            "--wall",
            "1" if limit else "20",
            "--",
            sys.executable,
            "-B",
            str(probe),
        ]
        row = {"case": name, "command": command, "scratch": str(root)}
        try:
            with (self.evidence / (name + ".log")).open("x") as log:
                proc = subprocess.Popen(
                    command,
                    cwd=root,
                    env=env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                self.processes.append(proc)
                row["supervisorPID"] = proc.pid
                until(lambda: (root / "ready").exists())
                pgid = int((root / "producer.pid").read_text())
                self.groups.add(pgid)
                if lock:
                    first_log = next((here / "evidence").glob("*/command.log"))
                    before = first_log.read_bytes()
                    second = subprocess.run(
                        command,
                        cwd=root,
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    row["second"] = {
                        "exit": second.returncode,
                        "stdout": second.stdout,
                        "stderr": second.stderr,
                    }
                    row["firstLogUnchanged"] = before == first_log.read_bytes()
                if sig:
                    os.kill(proc.pid, sig)
                elif not limit:
                    (root / "release").write_text("go")
                row["exit"] = proc.wait(timeout=20)
            receipts = list((here / "evidence").glob("*/result.json")) + list(
                (here / "evidence").glob("*/result-failure.json")
            )
            body = jsonfile(receipts[0]) if receipts else None
            row["receipt"] = body
            row["remainingBeforeRelease"] = group(pgid)
            (root / "release").write_text("go")
            until(lambda: not group(pgid), 10)
            ok = body is not None and row["exit"] == body["exit"]
            if sig or limit or late_signal:
                ok = ok and not body["pass"]
                if late_signal:
                    ok = ok and row["exit"] == 143
                if deny:
                    ok = (
                        ok
                        and body["childExit"] is None
                        and not body["childReaped"]
                        and not body["terminal"]
                        and bool(body["errors"])
                        and bool(row["remainingBeforeRelease"])
                    )
                else:
                    ok = (
                        ok
                        and body["childReaped"]
                        and body["terminal"]
                        and row["remainingBeforeRelease"] == []
                    )
            else:
                ok = ok and body["pass"] and row["exit"] == 0
            if lock:
                ok = (
                    ok
                    and row["second"]["exit"] != 0
                    and row["firstLogUnchanged"]
                    and len(receipts) == 1
                )
            row["expectationMet"] = bool(ok)
        except Exception as error:
            row.update(expectationMet=False, harnessError=repr(error))
        row["failureTail20"] = (
            (self.evidence / (name + ".log")).read_text().splitlines()[-20:]
            if not row["expectationMet"]
            else []
        )
        self.rows.append(row)
        (self.evidence / (name + ".json")).write_text(json.dumps(row, indent=2) + "\n")
        print(name, row["expectationMet"], flush=True)

    def finish(self):
        for path in self.scratch.rglob("producer.pid"):
            self.groups.add(int(path.read_text()))
        for proc in self.processes:
            if group(proc.pid):
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=5)
            until(lambda: not group(proc.pid), 5)
        for pgid in self.groups:
            if group(pgid):
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            until(lambda: not group(pgid), 5)
        (self.evidence / "results.json").write_text(
            json.dumps(
                {
                    "cases": self.rows,
                    "allPassed": self.complete
                    and all(r["expectationMet"] for r in self.rows),
                    "ownedGroups": sorted(self.groups),
                    "remainingGroups": [],
                },
                indent=2,
            )
            + "\n"
        )


def link(src, dst, relative=False, hard=False):
    target = dst.parents[5] / "backing.glb"
    target.write_bytes(b"CURRENT-GLB")
    dst.unlink()
    if hard:
        os.link(target, dst)
    else:
        dst.symlink_to(os.path.relpath(target, dst.parent) if relative else target)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--code", type=Path, required=True)
    p.add_argument("--evidence", type=Path, required=True)
    p.add_argument("--cases")
    args = p.parse_args()
    h = Harness(
        args.code.resolve(),
        args.evidence.resolve(),
        set(args.cases.split(",")) if args.cases else None,
    )
    try:
        happy = h.run("happy")
        assert happy["expectationMet"], (
            "CPU dependency fixture must pass the unchanged happy path"
        )
        h.run("symlink", setup=link)
        h.run("relative_symlink", setup=lambda s, d: link(s, d, relative=True))
        h.run("hardlink", setup=lambda s, d: link(s, d, hard=True))
        h.run("old_unreadable", "old_unreadable", setup=lambda s, d: d.chmod(0))
        h.run("source_unreadable", "source_unreadable", setup=lambda s, d: s.chmod(0))
        h.run("source_change", "source_change")
        h.run("source_alias", "source_alias")
        h.run("source_unreadable_after", "source_unreadable_after")
        h.run("child_fail", "child_fail")
        h.run("stock_fail", "stock_fail")
        h.run("new_unreadable", "new_unreadable")
        h.run("batch_unreadable", "new_unreadable", batch=True)
        h.run("sigterm", "term", interrupt=signal.SIGTERM)
        h.run("sigint", "int", interrupt=signal.SIGINT)
        h.run("denied_cleanup_late_publish", "deny", interrupt=signal.SIGINT)
        h.run("outer_sigterm", "outer_term", interrupt=signal.SIGTERM)
        h.run("child_signal_exit", "signal_exit")
        h.run("leader_exit_with_cohort", "cohort")
        h.run(
            "broken_symlink",
            "broken_symlink",
            setup=lambda s, d: (d.unlink(), d.symlink_to("missing.glb")),
        )
        h.run(
            "fifo_current",
            "fifo_current",
            setup=lambda s, d: (d.unlink(), os.mkfifo(d)),
        )
        h.run(
            "directory_source",
            "directory_source",
            setup=lambda s, d: (s.unlink(), s.mkdir()),
        )
        h.run("readlink_error", "readlink_error", setup=link)
        h.run("rename_denied", "rename_denied")
        h.run("receipt_after_replace", "receipt_after_replace")
        h.run("final_source_change", "final_source_change")
        h.run("observation_failure", "observation_failure")
        h.run("signal_during_binding", "signal_during_binding")
        h.run("sites_happy", family="sites")
        h.runner("runner_happy")
        h.runner("runner_sigterm", sig=signal.SIGTERM)
        h.runner("runner_sigint", sig=signal.SIGINT)
        h.runner("runner_eperm", sig=signal.SIGINT, deny=True)
        h.runner("runner_wall", limit=True)
        h.runner("runner_lock", lock=True)
        h.runner("runner_signal_during_result", late_signal=True)
        h.complete = True
    finally:
        h.finish()
    return 0 if all(row["expectationMet"] for row in h.rows) else 1


if __name__ == "__main__":
    sys.exit(main())
