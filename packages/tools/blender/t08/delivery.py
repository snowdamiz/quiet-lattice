"""Bind final CPU evidence to current asset bytes and preserve every run outcome."""

import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path):
    return str(path.relative_to(ROOT))


def write(name, data):
    with (HERE / "reports" / name).open("x") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


inventory = read(HERE / "inventory.json")
base = read(HERE / "base.json")
assert git("rev-parse", "HEAD") == base["base"]
assert git("branch", "--show-current") == base["branch"]
assert sha(ROOT / "assets/blend/_library.blend") == base["librarySHA256"]
assert sha(ROOT / "pnpm-lock.yaml") == base["lockSHA256"]
source = read(HERE / "reports/source-clearance-final.json")
export = read(HERE / "reports/export-clearance-final.json")
assert source["pass"] and export["pass"]
assets = []
owned_assets = set()
for item, src, dst in zip(inventory, source["files"], export["files"], strict=True):
    family, stem = item["family"], item["stem"]
    for row in [src, dst]:
        assert sha(ROOT / row["file"]) == row["sha256"]
        assert row["sourceSHA256"] == src["sha256"]
        owned_assets.add(row["file"])
    assert len(src["variants"]) == len(item["variants"])
    stocks = []
    for ext in ["blend", "glb"]:
        report = HERE / "reports/stock-final-r2" / f"{family}__{stem}.{ext}.json"
        raw = read(report)
        assert raw["status"] == "PASS"
        stocks.append(
            {"file": rel(report), "sha256": sha(report), "status": raw["status"]}
        )
    bindings = [
        p
        for p in sorted((HERE / "exports").glob("*/binding.json"))
        if read(p).get("outputSHA256") == dst["sha256"]
        and read(p).get("sourceSHA256") == src["sha256"]
        and read(p)["status"] == "PASS"
    ]
    assert bindings
    assets.append(
        {
            **item,
            "source": {
                "path": src["file"],
                "sha256": src["sha256"],
                "bytes": (ROOT / src["file"]).stat().st_size,
            },
            "export": {
                "path": dst["file"],
                "sha256": dst["sha256"],
                "bytes": (ROOT / dst["file"]).stat().st_size,
            },
            "stock": stocks,
            "exportBinding": rel(bindings[-1]),
            "variantsMeasured": raw["assets"][0]["variants"],
        }
    )

preview = {}
for label in ["source-final", "source-clearance-final", "export-final"]:
    for row in read(HERE / "reports" / (label + "-bindings.json")):
        preview[("export" if label == "export-final" else "source", row["variant"])] = (
            row
        )
assert len(preview) == 33
for row in preview.values():
    assert sha(ROOT / row["input"]) == row["inputSHA256"]
    assert sha(ROOT / row["image"]) == row["imageSHA256"]
renders = ROOT / "assets/renders/props/t08"
images = sorted(renders.rglob("*.png"))
control_images = sorted(HERE.rglob("*.png"))
payload = sum(p.stat().st_size for p in renders.rglob("*") if p.is_file())
assert len(images) + len(control_images) <= 48 and payload <= 512 * 1024**2
image_rows = [
    {"path": rel(p), "sha256": sha(p), "bytes": p.stat().st_size} for p in images
]

commands = []
for path in sorted((HERE / "evidence").glob("*/result.json")):
    row = read(path)
    log = path.parent / "command.log"
    assert sha(log) == row["logSHA256"]
    assert row.get("remainingGroup") == [], path
    commands.append(
        {
            "receipt": rel(path),
            **row,
            "failureTail20": log.read_text().splitlines()[-20:]
            if not row["pass"]
            else [],
        }
    )
scoped = sorted((HERE / "evidence").glob("*/checks.json"))
assert scoped and all(row["exit"] == 0 for row in read(scoped[-1]))
for p in scoped:
    for row in read(p):
        commands.append(
            {
                "receipt": rel(p),
                **row,
                "failureTail20": (ROOT / row["log"]).read_text().splitlines()[-20:]
                if row["exit"]
                else [],
            }
        )
controls = read(HERE / "controls/final-r2/results.json")
assert controls["pass"] and len(controls["controls"]) == 8
consumer = [p for p in (HERE / "evidence").glob("*consumer-final-r2/result.json")]
assert len(consumer) == 1 and read(consumer[0])["pass"]
assert "15 passed (15)" in (consumer[0].parent / "command.log").read_text()


def owned(path):
    return (
        path in owned_assets
        or path == "packages/client/test/t08-props-real-assets.test.js"
        or path.startswith(("packages/tools/blender/t08/", "assets/renders/props/t08/"))
    )


changed = git("diff", "--name-only", base["base"]).splitlines()
untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
assert all(owned(p) for p in changed + untracked)
protected = [
    "assets/blend/_library.blend",
    "pnpm-lock.yaml",
    "docs/IMPLEMENTATION_PLAN.md",
    "docs/DECISIONS.md",
    "packages/tools/blender/families.json",
    "packages/tools/blender/export_props.py",
    "packages/tools/blender/export_sites.py",
    "packages/tools/blender/validate.py",
    "packages/client/src/dev/review.js",
    "packages/client/src/gameplay/Structures.js",
    "packages/client/src/gameplay/modelLibrary.js",
    "packages/client/src/universe/Planet.js",
    "packages/shared/src/world/ground.ts",
    "blender/build_structures.py",
]
proof = [
    {
        "path": p,
        "baseBlob": git("rev-parse", f"{base['base']}:{p}"),
        "indexBlob": git("rev-parse", f":{p}"),
        "workingSHA256": sha(ROOT / p),
    }
    for p in protected
]
assert all(p["baseBlob"] == p["indexBlob"] for p in proof)

density = {}
for mode, report in [("source", source), ("export", export)]:
    density[mode] = {}
    for cls in ["prop", "building"]:
        rows = [
            lod["density"]
            for f in report["files"]
            for v in f["variants"]
            if v["class"] == cls
            for lod in v["lods"].values()
        ]
        density[mode][cls] = {
            "targetPxM": rows[0]["targetPxM"],
            "lodCount": len(rows),
            "weightedMeanRangePxM": [
                min(r["weightedMeanPxM"] for r in rows),
                max(r["weightedMeanPxM"] for r in rows),
            ],
            "worstAreaBelow97PercentTarget": max(
                r["areaBelow97PercentTarget"] for r in rows
            ),
            "minTrianglePxM": min(r["minPxM"] for r in rows),
            "maxTrianglePxM": max(r["maxPxM"] for r in rows),
            "zeroUVTriangles": sum(r["zeroUVTriangles"] for r in rows),
            "zeroWorldTriangles": sum(r["zeroWorldTriangles"] for r in rows),
        }
write("commands-final.json", commands)
write(
    "protected-final.json",
    {
        "base": base,
        "changedTracked": changed,
        "outsideOwnership": [],
        "protected": proof,
    },
)
write(
    "delivery-final.json",
    {
        "status": "PASS: authorized CPU unit only; independent review/native capture/blind grade pending",
        "base": base,
        "assets": assets,
        "variants": 21,
        "savedLODs": 84,
        "stockFilesPassed": 24,
        "consumerTestsPassed": 15,
        "malformedControlsPassed": 8,
        "density": density,
        "currentPreviews": list(preview.values()),
        "allCPUImages": image_rows,
        "imageCount": len(images),
        "ownedCPUImageCountIncludingControlTextures": len(images) + len(control_images),
        "renderTreeBytesIncludingHistory": payload,
        "resourceRuns": len([r for r in commands if "admission" in r]),
        "historicalFailedRuns": len([r for r in commands if r.get("pass") is False]),
        "protectedProof": "packages/tools/blender/t08/reports/protected-final.json",
        "commandsAndFailureTails": "packages/tools/blender/t08/reports/commands-final.json",
        "futureNativeInventory": "packages/tools/blender/t08/reports/future-native-inventory.json",
    },
)
print("DELIVERY_MANIFEST_PASS", len(assets), len(images), payload)
