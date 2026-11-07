"""Real export callers and live-producer retries; no native or codec execution."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
from types import ModuleType

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
T08 = HERE.parent


def retained_harness():
    spec = importlib.util.spec_from_file_location(
        "retained_harness", T08 / "revision_r1/test_lifecycle.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def exact_review(args):
    """Execute immutable reviewer code; rebind only its output/root configuration."""
    args.evidence.mkdir(parents=True, exist_ok=False)
    root = Path(tempfile.mkdtemp(prefix="t08r2-old-", dir="/tmp"))
    here = root / "packages/tools/blender/t08"
    (here / "revision_r1").mkdir(parents=True)
    for name in ["run.py", "export_saved.py"]:
        shutil.copyfile(args.code / name, here / name)
    for name in ["test_lifecycle.py", "fixture_sitecustomize.py", "fixture_blender.py"]:
        shutil.copyfile(T08 / "revision_r1" / name, here / "revision_r1" / name)
    with (here / "revision_r1/fixture_sitecustomize.py").open("a") as stream:
        stream.write("\n" + (HERE / "capacity_fixture.py").read_text())
    for name in [
        "export_props.py",
        "export_sites.py",
        "artlib/__init__.py",
        "artlib/export.py",
    ]:
        target = here.parent / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(T08.parent / name, target)
    out = Path(tempfile.mkdtemp(prefix="t08r2-review-", dir="/tmp"))
    config = ModuleType("commands")
    config.OUT, config.REPO, config.PY, config.ENV = (
        out,
        root,
        sys.executable,
        os.environ,
    )
    sys.modules["commands"] = config
    (args.evidence / "roots.json").write_text(
        json.dumps({"roots": [str(root), str(out)]})
    )
    script = HERE / "inputs/fence_probe.py"
    status = 1
    try:
        exec(
            compile(script.read_bytes(), str(script), "exec"), {"__name__": "__main__"}
        )
    except SystemExit as exit:
        status = exit.code
    finally:
        for path in (out / "fence-probe").glob("*"):
            if path.is_file():
                shutil.copyfile(path, args.evidence / path.name)
    return status


def claims(args):
    m = retained_harness()
    h = m.Harness(args.code, args.evidence)
    cases = [
        "writable_live",
        "unwritable_before_launch",
        "unwritable_after_launch",
        "pending_claim",
        "dangling_claim",
        "claim_fsync_error",
        "release_denied",
        "successful_release",
        "supervisor_killed",
    ]
    try:
        for name in cases:
            normal = name in ["release_denied", "successful_release"]
            root, here, src, dst, env = h.prepare(name, "ok" if normal else "deny")
            parent = here / "evidence"
            parent.mkdir(mode=0o555 if name == "unwritable_before_launch" else 0o755)
            claim = parent / ".lane-blocked.json"
            if name == "pending_claim":
                claim.with_name(claim.name + ".pending").write_bytes(b"incomplete")
            if name == "dangling_claim":
                claim.symlink_to("missing-owner")
            with (root / "cpu_dependencies/sitecustomize.py").open("a") as f:
                f.write("\n" + (HERE / "capacity_fixture.py").read_text())
                f.write(
                    "\nimport tempfile\n_old_temp=tempfile.mkdtemp\n"
                    "def private_temp(*a,**kw):\n"
                    " if kw.get('dir')=='/tmp': kw['dir']=str(root)\n"
                    " return _old_temp(*a,**kw)\n"
                    "tempfile.mkdtemp=private_temp\n"
                )
                if name == "claim_fsync_error":
                    f.write(
                        "\n_old_fsync=os.fsync\n"
                        "def claim_fsync(fd):\n"
                        " p=root/'packages/tools/blender/t08/evidence/.lane-blocked.json.pending'\n"
                        " if p.exists() and os.fstat(fd).st_ino==p.stat().st_ino:\n"
                        "  raise OSError(5,'controlled ownership-claim fsync failure')\n"
                        " return _old_fsync(fd)\n"
                        "os.fsync=claim_fsync\n"
                    )
                if name == "release_denied":
                    f.write(
                        "\n_old_unlink=os.unlink\n"
                        "def claim_unlink(p,*a,**kw):\n"
                        " if Path(p).name=='.lane-blocked.json':\n"
                        "  raise PermissionError(13,'controlled claim release denial')\n"
                        " return _old_unlink(p,*a,**kw)\n"
                        "os.unlink=claim_unlink\n"
                    )
            command = [
                sys.executable,
                "-B",
                str(here / "export_saved.py"),
                "--label",
                "first",
                "--only",
                "cargo_pod",
            ]
            row = {
                "case": name,
                "scratch": str(root),
                "command": command,
                "codeSHA256": {
                    n: m.sha(here / n) for n in ["run.py", "export_saved.py"]
                },
            }
            try:
                with (h.evidence / (name + "-first.log")).open("x") as log:
                    first = subprocess.Popen(
                        command,
                        cwd=root,
                        env=env,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                    h.processes.append(first)
                    row["supervisorPID"] = first.pid
                    m.until(
                        lambda: (
                            (root / "validation-entered").exists()
                            or first.poll() is not None
                        )
                    )
                    producer = (
                        int((root / "producer.pid").read_text())
                        if (root / "producer.pid").exists()
                        else None
                    )
                    row["firstProducer"] = producer
                    if producer:
                        h.groups.add(producer)
                    row["claimDuringProduction"] = os.path.lexists(claim)
                    if name == "unwritable_after_launch":
                        parent.chmod(0o555)
                    if producer and not normal:
                        os.kill(
                            first.pid,
                            signal.SIGKILL
                            if name == "supervisor_killed"
                            else signal.SIGTERM,
                        )
                    row["firstExit"] = first.wait(timeout=20)
                receipts = list(here.glob("exports/*/producer/run/result.json"))
                row["firstReceipts"] = [m.jsonfile(p) for p in receipts]
                row["firstReceiptHashes"] = {str(p): m.sha(p) for p in receipts}
                row["guardExists"] = os.path.lexists(claim)
                row["pendingExists"] = os.path.lexists(
                    claim.with_name(claim.name + ".pending")
                )
                row["firstAliveBeforeRetry"] = m.group(producer) if producer else []
                substitutions = root / "substitution.jsonl"
                prior = (
                    substitutions.read_text().splitlines()
                    if substitutions.exists()
                    else []
                )
                retry_env = dict(env, T08_CASE="ok")
                retry_env.pop("T08_DENY_KILL", None)
                retry_command = list(command)
                retry_command[4] = "second"
                row["retryCommand"] = retry_command
                with (h.evidence / (name + "-retry.log")).open("x") as log:
                    retry = subprocess.Popen(
                        retry_command,
                        cwd=root,
                        env=retry_env,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                    h.processes.append(retry)
                    row["retryPID"] = retry.pid
                    row["retryExit"] = retry.wait(timeout=20)
                current = (
                    substitutions.read_text().splitlines()
                    if substitutions.exists()
                    else []
                )
                row["launches"] = [len(prior), len(current)]
                row["firstAliveAfterRetry"] = m.group(producer) if producer else []
                row["bindings"] = [
                    m.jsonfile(p) for p in sorted(here.glob("exports/*/binding.json"))
                ]
                row["canonicalExistsAfterRetry"] = dst.exists()
                (root / "release").write_text("go")
                if producer:
                    m.until(lambda: not m.group(producer), 10)
                row["firstReceiptUnchanged"] = all(
                    m.sha(p) == row["firstReceiptHashes"][str(p)] for p in receipts
                )
                row["canonicalExistsAfterRelease"] = dst.exists()
                moves = root / "stock-moves.jsonl"
                row["stockMoves"] = (
                    [json.loads(line) for line in moves.read_text().splitlines()]
                    if moves.exists()
                    else []
                )
                private = all(
                    Path(x["destination"])
                    .resolve()
                    .is_relative_to((here / "exports").resolve())
                    for x in row["stockMoves"]
                )
                if name == "successful_release":
                    ok = (
                        row["firstExit"] == row["retryExit"] == 0
                        and row["launches"] == [1, 2]
                        and not os.path.lexists(claim)
                    )
                elif name in [
                    "writable_live",
                    "unwritable_after_launch",
                    "supervisor_killed",
                ]:
                    ok = (
                        row["firstExit"] != 0
                        and row["retryExit"] != 0
                        and row["launches"] == [1, 1]
                        and row["claimDuringProduction"]
                        and row["firstAliveBeforeRetry"]
                        and row["firstAliveAfterRetry"]
                        and row["guardExists"]
                        and not dst.exists()
                    )
                elif name == "release_denied":
                    ok = (
                        row["firstExit"] != 0
                        and row["retryExit"] != 0
                        and row["launches"] == [1, 1]
                        and row["guardExists"]
                        and row["firstReceipts"][0]["terminal"]
                        and not dst.exists()
                    )
                else:
                    ok = (
                        row["firstExit"] != 0
                        and row["retryExit"] != 0
                        and row["launches"] == [0, 0]
                    )
                    first_errors = json.dumps(row["bindings"][0])
                    expected = {
                        "unwritable_before_launch": ".lane-blocked.json.pending",
                        "pending_claim": ".lane-blocked.json.pending",
                        "dangling_claim": ".lane-blocked.json",
                        "claim_fsync_error": "controlled ownership-claim fsync failure",
                    }[name]
                    ok = (
                        ok
                        and expected in first_errors
                        and "CPU admission refused" not in first_errors
                    )
                row["expectationMet"] = bool(
                    ok and private and row["firstReceiptUnchanged"]
                )
            except Exception as error:
                row.update(expectationMet=False, harnessError=repr(error))
            h.rows.append(row)
            with (h.evidence / (name + ".json")).open("x") as f:
                json.dump(row, f, indent=2)
                f.write("\n")
            print(
                name,
                row["expectationMet"],
                "first",
                row.get("firstExit"),
                "retry",
                row.get("retryExit"),
                "launches",
                row.get("launches"),
                flush=True,
            )
        h.complete = True
    finally:
        h.finish()
    return 0 if all(row["expectationMet"] for row in h.rows) else 1


def prior_controls(args):
    m = retained_harness()

    class CPUHarness(m.Harness):
        def prepare(self, *pos, **kw):
            result = super().prepare(*pos, **kw)
            with (result[0] / "cpu_dependencies/sitecustomize.py").open("a") as stream:
                stream.write("\n" + (HERE / "capacity_fixture.py").read_text())
            return result

    m.Harness = CPUHarness
    sys.argv = [
        __file__,
        "--code",
        str(args.code),
        "--evidence",
        str(args.evidence),
        "--cases",
        "symlink,relative_symlink,hardlink,old_unreadable,new_unreadable,batch_unreadable,"
        "sigterm,denied_cleanup_late_publish,runner_sigterm,runner_eperm,sites_happy,"
        "leader_exit_with_cohort,source_alias,signal_during_binding,runner_signal_during_result",
    ]
    return m.main()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--code", type=Path, required=True)
    p.add_argument("--evidence", type=Path, required=True)
    p.add_argument("--original-review", action="store_true")
    p.add_argument("--prior-controls", action="store_true")
    args = p.parse_args()
    args.code, args.evidence = args.code.resolve(), args.evidence.resolve()
    if args.original_review:
        return exact_review(args)
    return prior_controls(args) if args.prior_controls else claims(args)


if __name__ == "__main__":
    sys.exit(main())
