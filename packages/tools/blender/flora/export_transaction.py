"""Transactional shell around the shared exporter, without Blender dependencies."""

from pathlib import Path

from file_protocol import archive_outputs
from receipts import STEMS, Attempt, sha


def export_transaction(src_root, out_root, evidence, invoke, source_check, extra=()):
    """Preserve prior output before discovery; only publish a complete successful batch."""
    with Attempt(evidence, "export") as attempt:
        outputs = [Path(out_root) / "flora" / (stem + ".glb") for stem in STEMS]
        try:
            archive_outputs(outputs, attempt.path / "prior-assets")
            for stem in STEMS:
                attempt.snapshot(
                    Path(src_root) / "flora" / (stem + ".blend"), "sources"
                )
            for stem in STEMS:
                source = attempt.path / "inputs/sources/flora" / (stem + ".blend")
                report = source_check(source)
                report.write(attempt.path / "preflight" / (source.name + ".json"), str)
                if report.status != "PASS":
                    raise RuntimeError(f"source preflight failed: {source.name}")
            args = [
                "--src-root",
                str(attempt.path / "inputs/sources"),
                "--out-dir",
                str(attempt.path / "staged"),
                "--report-dir",
                str(attempt.path / "reports"),
                "--only",
                ",".join(STEMS),
                *extra,
            ]
            code = invoke("flora", args)
            staged = [attempt.path / "staged/flora" / path.name for path in outputs]
            if code or not all(path.is_file() for path in staged):
                raise RuntimeError(f"export failed or incomplete (exit {code})")
            attempt.assert_stable()
            products = {path.name: sha(path) for path in staged}
            for source, target in zip(staged, outputs):
                target.parent.mkdir(parents=True, exist_ok=True)
                source.rename(target)
            attempt.finish(
                "PASS",
                exports=products,
                qualification="export only; run validate_exports.py",
            )
        except BaseException:
            archive_outputs(outputs, attempt.path / "failed-publication")
            raise
    return 0
