"""Fresh source + stock export + real loader checks, bound to immutable byte snapshots."""

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
from receipts import DEFAULT_EVIDENCE, ROOT, STEMS, Attempt, sha, write_json
from run_cpu import cpu_env


def consumer(attempt, manifest, exports):
    env = cpu_env()
    env.update(
        T05_SOURCE_MANIFEST=str(manifest),
        T05_EXPORT_ROOT=str(exports),
        T05_RUN_ID=attempt.id,
    )
    command = [
        "pnpm",
        "exec",
        "vitest",
        "run",
        "packages/client/test/floraAssets.test.js",
        "--maxWorkers=1",
        "--no-file-parallelism",
        "--reporter=json",
        "--outputFile=" + str(attempt.path / "consumer-tests.json"),
    ]
    with (attempt.path / "consumer.log").open("x") as log:
        result = subprocess.run(
            command,
            check=False,
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            timeout=180,
        )
    # This subprocess remains in the Blender runner's owned group, including its
    # workers, so timeout/cancellation of Blender also terminates every consumer.
    row = {
        "run_id": attempt.id,
        "command": command,
        "exit": result.returncode,
        "manifest_sha256": sha(manifest),
        "exports": {stem: sha(exports / (stem + ".glb")) for stem in STEMS},
    }
    write_json(attempt.path / "consumer.json", row)
    if result.returncode:
        raise RuntimeError(
            "actual loader geometry/mask/pair checks failed; see consumer.log"
        )
    tests = json.loads((attempt.path / "consumer-tests.json").read_text())
    if not tests["success"] or tests["numPassedTests"] < 130 or tests["numFailedTests"]:
        raise RuntimeError("consumer tests did not complete")


def validate(
    src_root,
    export_root,
    evidence,
    *,
    source_auditor=None,
    export_validator=None,
    consumer_check=consumer,
):
    # Imports are lazy so transaction/race tests can replace expensive boundaries,
    # while the normal entry point always runs the real source and stock validators.
    if source_auditor is None:
        from source_audit import audit_sources

        source_auditor = audit_sources
    if export_validator is None:
        from artlib import core, rules

        config = rules.load()
        export_validator = lambda path, source: core.validate_path(
            config, path, family="flora", source=source
        )
    with Attempt(evidence, "validate") as attempt:
        sources = [
            attempt.snapshot(Path(src_root) / (stem + ".blend"), "sources")
            for stem in STEMS
        ]
        exports = [
            attempt.snapshot(Path(export_root) / (stem + ".glb"), "exports")
            for stem in STEMS
        ]
        manifest = source_auditor(sources, attempt.path / "reports/sources")
        manifest["run_id"] = attempt.id
        for path in sources:
            if manifest["files"][path.name]["sha256"] != sha(path):
                raise RuntimeError("source audit hash mismatch")
        manifest_path = attempt.path / "source_manifest.json"
        write_json(manifest_path, manifest)
        reports = []
        for path, source in zip(exports, sources):
            report = export_validator(path, source)
            report.write(attempt.path / "reports/exports" / (path.name + ".json"), str)
            reports.append(
                {
                    "file": path.name,
                    "sha256": sha(path),
                    "source_sha256": sha(source),
                    "status": report.status,
                }
            )
        write_json(
            attempt.path / "export_manifest.json",
            {"run_id": attempt.id, "exports": reports},
        )
        # Always exercise pairing, even while stock material recognition is pending.
        consumer_check(attempt, manifest_path, exports[0].parent)
        attempt.assert_stable()
        stock_pass = all(row["status"] == "PASS" for row in reports)
        attempt.finish(
            "PASS" if stock_pass else "FAIL",
            content="PASS",
            stock="PASS" if stock_pass else "FAIL",
            error=None
            if stock_pass
            else "Stock export validator rejected assets; no whole qualification",
        )
        print(
            "VALIDATION",
            "PASS" if stock_pass else "FAIL",
            "CONTENT PASS",
            "RUN",
            attempt.id,
        )
        return 0 if stock_pass else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src-dir", type=Path, default=ROOT / "assets/blend/flora")
    parser.add_argument(
        "--export-dir", type=Path, default=ROOT / "packages/client/public/models/flora"
    )
    parser.add_argument(
        "--report-dir", type=Path, default=DEFAULT_EVIDENCE / "validation"
    )
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    return validate(args.src_dir, args.export_dir, args.report_dir)


if __name__ == "__main__":
    sys.exit(main())
