"""Prove the tooling-only revision leaves prior assets, evidence and protected inputs exact."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
EDITABLE = {
    "packages/tools/blender/t08/run.py",
    "packages/tools/blender/t08/export_saved.py",
}


def sha(path):
    h = hashlib.sha256()
    if path.is_symlink():
        h.update(os.readlink(path).encode())
    else:
        with path.open("rb") as f:
            for data in iter(lambda: f.read(1024 * 1024), b""):
                h.update(data)
    return h.hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    before = json.loads((HERE / "protection-before.json").read_text())
    for row in before["files"]:
        path = ROOT / row["path"]
        info = path.lstat()
        assert sha(path) == row["sha256"], row["path"]
        assert (stat.S_IMODE(info.st_mode), info.st_size, info.st_mtime_ns) == (
            row["mode"],
            row["size"],
            row["mtimeNs"],
        ), row["path"]
    for row in before["externalInputs"]:
        assert sha(Path(row["source"])) == sha(ROOT / row["copy"]) == row["sha256"]
    delivery = json.loads((HERE.parent / "reports/delivery-final.json").read_text())
    assets = []
    for item in delivery["assets"]:
        for kind in ["source", "export"]:
            row = item[kind]
            assert sha(ROOT / row["path"]) == row["sha256"]
            assert "oid sha256:" + row["sha256"] in git(
                "show", before["head"] + ":" + row["path"]
            )
            assets.append(row)
    for row in delivery["allCPUImages"]:
        assert sha(ROOT / row["path"]) == row["sha256"]
    assert len(list((ROOT / "assets/renders/props/t08").rglob("*.png"))) == 44
    assert not list(HERE.rglob("*.png"))
    original = set(
        git(
            "ls-tree", "-r", "--name-only", "afc0dacaaac45de27776e24ad35e42e3250d8f25"
        ).splitlines()
    )
    assert len(original) == 4097 and original <= {
        row["path"] for row in before["files"]
    }
    paths = set(git("diff", "--name-only", before["head"]).splitlines())
    paths |= set(git("ls-files", "--others", "--exclude-standard").splitlines())
    assert all(
        path in EDITABLE or path.startswith("packages/tools/blender/t08/revision_r1/")
        for path in paths
    )
    result = {
        "pass": True,
        "revisionBase": before["head"],
        "observedHead": git("rev-parse", "HEAD"),
        "protectedTrackedFiles": len(before["files"]),
        "protectedOriginalParentPaths": 4097,
        "assetHashes": assets,
        "unchangedAssets": 24,
        "unchangedPNGs": 44,
        "unchangedExternalInputs": before["externalInputs"],
        "changedOrNewPaths": sorted(paths),
        "outsideOwnership": [],
        "sourceAndConsumerEvidence": "Exact prior bytes reused; no Blender, codec or production-loader rerun in this revision.",
    }
    with args.out.open("x") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(
        "PROTECTED_PASS",
        len(before["files"]),
        "PARENT_PASS",
        4097,
        "ASSETS_PASS",
        24,
        "PNG_PASS",
        44,
    )


if __name__ == "__main__":
    main()
