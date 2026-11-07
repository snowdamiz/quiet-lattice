"""Read-only protection proof for the R2 ownership correction."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
REVIEW = Path("/private/tmp/t08-r2-source-25d38590-x6AaWJ")
SEAL = "5ce4d08dc41511a376cf54ee202f0789135826f19acd8f787c3e12c6aa6bfb0e"


def sha(path):
    h = hashlib.sha256()
    if path.is_symlink():
        h.update(os.readlink(path).encode())
    else:
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1048576), b""):
                h.update(block)
    return h.hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    before = json.loads((HERE / "protection-before.json").read_text())
    for row in before["files"]:
        path = ROOT / row["path"]
        info = path.lstat()
        assert sha(path) == row["sha256"], path
        assert (info.st_mode, info.st_size, info.st_mtime_ns) == (
            row["mode"],
            row["size"],
            row["mtimeNs"],
        ), path
    old = json.loads((HERE.parent / "revision_r1/protection-before.json").read_text())
    assert len(old["files"]) == 4951
    assert {r["path"] for r in old["files"]} <= {r["path"] for r in before["files"]}
    parent = set(
        git(
            "ls-tree", "-r", "--name-only", "afc0dacaaac45de27776e24ad35e42e3250d8f25"
        ).splitlines()
    )
    assert len(parent) == 4097 and parent <= {r["path"] for r in before["files"]}
    for row in before["externalInputs"]:
        assert sha(Path(row["source"])) == sha(ROOT / row["copy"]) == row["sha256"]
    assert sha(REVIEW / "SHA256SUMS.json") == SEAL
    reviewed = json.loads((REVIEW / "SHA256SUMS.json").read_text())
    for row in reviewed["files"]:
        path = REVIEW / row["path"]
        info = path.lstat()
        assert (info.st_mode, info.st_size, info.st_mtime_ns, info.st_ino) == (
            row["mode"],
            row["size"],
            row["mtimeNs"],
            row["inode"],
        ), path
        if row.get("sha256"):
            assert sha(path) == row["sha256"], path
        elif "symlinkTarget" in row:
            assert os.readlink(path) == row["symlinkTarget"]
        elif "readError" in row:
            try:
                path.read_bytes()
                raise AssertionError(f"unreadable inode became readable: {path}")
            except OSError as error:
                assert type(error).__name__ == row["readError"]["type"]
                assert error.errno == row["readError"]["errno"]
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
    images = delivery["allCPUImages"]
    assert len(images) == 44
    for row in images:
        assert sha(ROOT / row["path"]) == row["sha256"]
    assert len(list((ROOT / "assets/renders/props/t08").rglob("*.png"))) == 44
    assert not list(HERE.rglob("*.png"))
    paths = set(git("diff", "--name-only", before["head"]).splitlines())
    paths |= set(git("ls-files", "--others", "--exclude-standard").splitlines())
    assert all(
        p == "packages/tools/blender/t08/run.py"
        or p.startswith("packages/tools/blender/t08/revision_r2/")
        for p in paths
    )
    result = {
        "pass": True,
        "head": git("rev-parse", "HEAD"),
        "base": before["head"],
        "protectedTracked": len(before["files"]),
        "originalProtected": 4951,
        "originalParentPaths": len(parent),
        "assets": assets,
        "images": images,
        "reviewSeal": SEAL,
        "reviewEntriesExact": len(reviewed["files"]),
        "changedPaths": sorted(paths),
        "outsideOwnership": [],
        "artEvidence": "Exact existing bytes only; no art, codec or production-consumer rerun",
    }
    with args.out.open("x") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print(
        "PROTECTED_PASS",
        len(before["files"]),
        "ORIGINAL",
        4951,
        "PARENT",
        len(parent),
        "ASSETS",
        len(assets),
        "PNG",
        len(images),
    )


if __name__ == "__main__":
    main()
