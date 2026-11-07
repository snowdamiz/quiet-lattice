"""Execute the playthrough CLI guard. Adapted from the sealed review harness.

The sealed directory is not modified. This copy points REVIEW_TARGET and the
candidate symlink at the isolated checkout.
"""
from pathlib import Path
import json, os, subprocess, sys

scratch = Path("/tmp/space-playthrough-symlink-fix-20261107-t3-08e12f47")
harness = scratch / "harness"
root = Path("/Users/andreyyurlov/.t3/worktrees/space/t3-08e12f47")
node = "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node"
tsx = root / "node_modules/tsx/dist/cli.mjs"
target = root / "packages/tools/src/capture/playthrough-run.ts"
baseline = harness / "baseline.ts"
phase = sys.argv[1]
out = scratch / phase
out.mkdir(parents=True, exist_ok=True)

runtimes = {
    "node": [node],
    "tsx": [node, str(tsx)],
}

cases = [
    ("candidate-direct", target, [str(target), "leave"], False),
    ("baseline-symlink", baseline, [str(harness / "baseline-alias.ts"), "leave"], False),
    ("candidate-symlink", target, [str(harness / "entry-alias.ts"), "leave"], False),
    ("import-only", target, [str(harness / "import-check.mjs")], True),
]

records = []
for runtime, prefix in runtimes.items():
    for name, source, args, _import_only in cases:
        meta = out / f"{runtime}-{name}.meta.json"
        trace = out / f"{runtime}-{name}.trace"
        meta.unlink(missing_ok=True)
        trace.unlink(missing_ok=True)
        cmd = [*prefix, "--import", str(harness / "preload.mjs"), *args]
        env = dict(os.environ)
        env.update({
            "REVIEW_TARGET": str(source),
            "REVIEW_CASE": "{}",
            "REVIEW_META": str(meta),
            "REVIEW_TRACE": str(trace),
            "PATH": str(Path(node).parent) + os.pathsep + env.get("PATH", ""),
        })
        proc = subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True, timeout=20)
        meta_body = json.loads(meta.read_text()) if meta.exists() else None
        record = {
            "phase": phase,
            "runtime": runtime,
            "name": name,
            "cmd": cmd,
            "node": node,
            "tsx": str(tsx) if runtime == "tsx" else None,
            "exitCode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "meta": meta_body,
        }
        (out / f"{runtime}-{name}.json").write_text(json.dumps(record, indent=2) + "\n")
        records.append(record)
        print(f"{runtime:4} {name:20} exit={proc.returncode} stdout={proc.stdout!r} trace={(meta_body or {}).get('trace')} version={(meta_body or {}).get('version')} exec={(meta_body or {}).get('execPath')}")
        if proc.stderr:
            print("  stderr", proc.stderr[:500])

summary = {
    "phase": phase,
    "records": [
        {
            "runtime": r["runtime"],
            "name": r["name"],
            "exitCode": r["exitCode"],
            "stdout": r["stdout"],
            "trace": None if r["meta"] is None else r["meta"].get("trace"),
            "version": None if r["meta"] is None else r["meta"].get("version"),
            "execPath": None if r["meta"] is None else r["meta"].get("execPath"),
            "argv1": None if r["meta"] is None else (r["meta"].get("argv") or [None, None])[1],
            "loaded": None if r["meta"] is None else r["meta"].get("loaded"),
        }
        for r in records
    ],
}
(out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
# RED is the candidate symlink silently succeeding. Other controls must already pass.
failures = []
for row in summary["records"]:
    key = (row["runtime"], row["name"])
    if row["name"] == "candidate-symlink":
        if phase == "red":
            silent = row["exitCode"] == 0 and row["stdout"] == "" and row["trace"] == []
            if not silent:
                failures.append(("expected silent symlink miss", key, row))
        else:
            ok = row["exitCode"] == 0 and row["stdout"] == "[leave] (0s) leave ok\n" and row["trace"] and row["trace"][-4:] == ["close", "close:done", "stop", "stop:done"]
            if not ok:
                failures.append(("expected symlink execution", key, row))
    elif row["name"] == "import-only":
        ok = row["exitCode"] == 0 and row["stdout"] == "import is inert\n" and row["trace"] == [] and row["loaded"]
        if not ok:
            failures.append(("expected inert import", key, row))
    else:
        ok = row["exitCode"] == 0 and row["stdout"] == "[leave] (0s) leave ok\n" and row["trace"] and row["trace"][-4:] == ["close", "close:done", "stop", "stop:done"]
        if not ok:
            failures.append(("expected execution", key, row))
    if row["version"] != "v22.23.3" or row["execPath"] != node:
        failures.append(("unexpected runtime", key, row))
if failures:
    print("PROBE_FAIL")
    for item in failures:
        print(item[0], item[1])
    sys.exit(1)
print("PROBE_OK", phase)
