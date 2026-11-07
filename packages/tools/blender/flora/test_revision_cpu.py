"""Real-source/full-validator/production-loader negatives; run with run_cpu.py only."""

import argparse
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
from artlib import core, rules
from export_transaction import export_transaction
from receipts import ROOT, STEMS, consume_current, sha, write_json
from validate_exports import consumer, validate


def run(out):
    out.mkdir(parents=True, exist_ok=False)
    sources = ROOT / "assets/blend/flora"
    exports = ROOT / "packages/client/public/models/flora"
    originals = [sources / (stem + ".blend") for stem in STEMS] + [
        exports / (stem + ".glb") for stem in STEMS
    ]
    before = {str(p): sha(p) for p in originals}
    results = []
    write_json(out / "before.json", before)
    config = rules.load()
    # Actual matching pairs. Stock may remain FAIL pending the parent's reviewed
    # shared fix, but actual geometry/masks/consumer tests must all pass.
    evidence = out / "matching"
    code = validate(sources, exports, evidence)
    latest = json.loads((evidence / "latest.json").read_text())
    receipt = json.loads((evidence / latest["receipt"]).read_text())
    assert receipt["content"] == "PASS", receipt
    assert receipt["stock"] in ("PASS", "FAIL")
    results.append(
        {
            "case": "matching_pairs",
            "content": receipt["content"],
            "stock": receipt["stock"],
            "exit": code,
        }
    )
    if code:
        try:
            consume_current(evidence)
        except ValueError:
            pass
        else:
            raise AssertionError("Stock failure qualified as current PASS")
    else:
        consume_current(evidence)
    for index, stem in enumerate(STEMS):
        wrong = STEMS[(index + 1) % 3]
        fixture = out / ("pair-" + stem)
        fixture.mkdir()
        for name in STEMS:
            shutil.copyfile(exports / (name + ".glb"), fixture / (name + ".glb"))
        shutil.copyfile(exports / (wrong + ".glb"), fixture / (stem + ".glb"))
        evidence = fixture / "evidence"
        try:
            validate(sources, fixture, evidence)
        except RuntimeError as error:
            assert "actual loader" in str(error), str(error)
        else:
            raise AssertionError("Wrong real source/export pair accepted")
        latest = json.loads((evidence / "latest.json").read_text())
        folder = (evidence / latest["receipt"]).parent
        log = (folder / "consumer.log").read_text()
        tests = (folder / "consumer-tests.json").read_text()
        assert latest["status"] == "FAIL" and (
            "source/export pairing" in log or "source/export pairing" in tests
        )
        results.append(
            {
                "case": "wrong_pair",
                "source": stem,
                "wrong_export": wrong,
                "rejected_by": "actual loader file/name/geometry associations",
            }
        )
    for mode in ("source", "export"):
        fixture = out / ("race-" + mode)
        src = fixture / "sources"
        dst = fixture / "exports"
        src.mkdir(parents=True)
        dst.mkdir()
        for stem in STEMS:
            shutil.copyfile(sources / (stem + ".blend"), src / (stem + ".blend"))
            shutil.copyfile(exports / (stem + ".glb"), dst / (stem + ".glb"))

        def replace_after_consumer(
            attempt, manifest, snapshots, mode=mode, src=src, dst=dst
        ):
            consumer(attempt, manifest, snapshots)
            folder, ext = (src, ".blend") if mode == "source" else (dst, ".glb")
            shutil.copyfile(folder / (STEMS[1] + ext), folder / (STEMS[0] + ext))

        try:
            validate(
                src, dst, fixture / "evidence", consumer_check=replace_after_consumer
            )
        except RuntimeError as error:
            assert "input changed during attempt" in str(error), str(error)
        else:
            raise AssertionError("Actual input replacement race accepted")
        results.append({"case": mode + "_read_race", "rejected": True})
    for index, mode in enumerate(("missing", "pointer", "corrupt")):
        fixture = out / ("export-" + mode)
        src = fixture / "sources/flora"
        dst = fixture / "models/flora"
        src.mkdir(parents=True)
        dst.mkdir(parents=True)
        for stem in STEMS:
            shutil.copyfile(sources / (stem + ".blend"), src / (stem + ".blend"))
            shutil.copyfile(exports / (stem + ".glb"), dst / (stem + ".glb"))
        damaged = src / (STEMS[index] + ".blend")
        if mode == "missing":
            damaged.unlink()
        elif mode == "pointer":
            damaged.write_text(
                "version https://git-lfs.github.com/spec/v1\noid sha256:"
                + "0" * 64
                + "\nsize 123\n"
            )
        else:
            damaged.write_bytes(b"corrupt Blender source")

        def forbidden_export(*_):
            raise AssertionError("Exporter reached before full source preflight")

        evidence = fixture / "evidence"
        try:
            export_transaction(
                src.parent,
                dst.parent,
                evidence,
                forbidden_export,
                lambda path: core.validate_path(config, path, family="flora"),
            )
        except (RuntimeError, FileNotFoundError) as error:
            reason = str(error)
        else:
            raise AssertionError("Bad source accepted")
        assert not list(dst.glob("*.glb"))
        latest = json.loads((evidence / "latest.json").read_text())
        folder = (evidence / latest["receipt"]).parent
        assert latest["status"] == "FAIL"
        for stem in STEMS:
            assert (
                sha(folder / "prior-assets" / (stem + ".glb"))
                == before[str(exports / (stem + ".glb"))]
            )
        results.append(
            {
                "case": "export_" + mode,
                "source": damaged.name,
                "runtime_outputs": 0,
                "prior_assets_preserved": 3,
                "reason": reason,
            }
        )
    after = {str(p): sha(p) for p in originals}
    write_json(out / "after.json", after)
    assert before == after, "Original asset bytes changed"
    write_json(
        out / "results.json",
        {"regressions": "PASS", "stock": receipt["stock"], "cases": results},
    )
    print("REAL_REGRESSIONS_PASS", len(results), "STOCK", receipt["stock"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-dir", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    run(args.report_dir)
