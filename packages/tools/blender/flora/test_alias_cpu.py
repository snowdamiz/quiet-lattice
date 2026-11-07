"""Actual six-asset stock/loader alias substitution controls; CPU runner only."""

import argparse
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
from receipts import ROOT, STEMS, consume_current, sha, write_json
from validate_exports import consumer, validate


def run(out):
    out.mkdir(parents=True, exist_ok=False)
    originals = {
        "sources": ROOT / "assets/blend/flora",
        "exports": ROOT / "packages/client/public/models/flora",
    }
    before = {
        str(folder / (stem + ext)): sha(folder / (stem + ext))
        for category, folder in originals.items()
        for stem in STEMS
        for ext in ([".blend"] if category == "sources" else [".glb"])
    }
    results = []
    for category in ("sources", "exports"):
        for shape in ("leaf", "ancestor"):
            case = out / (category + "-" + shape)
            case.mkdir()
            for name, original in originals.items():
                folder = case / (name + "-backing")
                folder.mkdir()
                ext = ".blend" if name == "sources" else ".glb"
                for stem in STEMS:
                    shutil.copyfile(original / (stem + ext), folder / (stem + ext))
                alias = case / name
                if shape == "ancestor":
                    alias.symlink_to(folder)
                else:
                    alias.mkdir()
                    for p in folder.iterdir():
                        (alias / p.name).symlink_to(p)
            ext = ".blend" if category == "sources" else ".glb"
            requested = case / category / (STEMS[0] + ext)
            original_hash = sha(requested)
            if shape == "leaf":
                link = requested
                replacement = case / (category + "-backing") / (STEMS[1] + ext)
                original_target = case / (category + "-backing") / (STEMS[0] + ext)
            else:
                link = case / category
                replacement = case / (category + "-replacement")
                shutil.copytree(case / (category + "-backing"), replacement)
                # Identical bytes at a different canonical target must also reject.
                original_target = case / (category + "-backing")

            def retarget(target, link=link):
                new = link.with_name(link.name + ".new")
                new.symlink_to(target)
                new.replace(link)

            evidence = case / "closed"
            assert validate(case / "sources", case / "exports", evidence) == 0
            receipt = consume_current(evidence)
            assert any(row["path"] == str(requested) for row in receipt["inputs"])
            retarget(replacement)
            try:
                consume_current(evidence)
            except ValueError as error:
                results.append(
                    {
                        "case": category + "_" + shape + "_after_seal",
                        "rejected": str(error),
                        "before": original_hash,
                        "after": sha(requested),
                    }
                )
            else:
                raise AssertionError("retargeted caller accepted by receipt consumer")
            retarget(original_target)
            evidence = case / "during"

            def after_real_consumer(
                attempt, manifest, exports, replacement=replacement
            ):
                consumer(attempt, manifest, exports)
                retarget(replacement)

            try:
                validate(
                    case / "sources",
                    case / "exports",
                    evidence,
                    consumer_check=after_real_consumer,
                )
            except RuntimeError as error:
                assert "input changed" in str(error), str(error)
                results.append(
                    {
                        "case": category + "_" + shape + "_before_seal",
                        "rejected": str(error),
                        "before": original_hash,
                        "after": sha(requested),
                    }
                )
            else:
                raise AssertionError("retargeted caller sealed as PASS")
            assert (
                json.loads((evidence / "latest.json").read_text())["status"] == "FAIL"
            )
            try:
                consume_current(evidence)
            except ValueError:
                pass
            else:
                raise AssertionError("failed current receipt consumed")
    after = {path: sha(path) for path in before}
    assert after == before
    write_json(
        out / "results.json", {"cases": results, "before": before, "after": after}
    )
    print("ACTUAL_ALIAS_CONTROLS_PASS", len(results))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-dir", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    run(args.report_dir)
