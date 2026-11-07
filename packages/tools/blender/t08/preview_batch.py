"""Serial CPU contact sheets bound to the exact saved/decoded input bytes."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--label", required=True)
    p.add_argument("--mode", choices=["source", "export"], required=True)
    p.add_argument("--only")
    args = p.parse_args()
    inventory = json.loads((HERE / "inventory.json").read_text())
    if args.only:
        selected = set(args.only.split(","))
        assert selected <= {item["stem"] for item in inventory}
        inventory = [item for item in inventory if item["stem"] in selected]
    output = ROOT / "assets/renders/props/t08" / args.label
    output.mkdir(parents=True, exist_ok=False)
    bindings = []
    for item in inventory:
        family, stem = item["family"], item["stem"]
        path = (
            ROOT
            / (
                "assets/blend"
                if args.mode == "source"
                else "packages/client/public/models"
            )
            / family
            / (stem + (".blend" if args.mode == "source" else ".glb"))
        )
        variants = item["variants"] if args.mode == "source" else item["variants"][:1]
        for variant in variants:
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            image = output / (variant + ".png")
            command = [
                sys.executable,
                str(HERE / "run.py"),
                "--label",
                "preview-" + variant + "-" + args.label,
                "--wall",
                "600",
                "--",
                "blender",
                "-P",
                str(HERE / "preview.py"),
                "--",
                str(path),
                "--variant",
                variant,
                "--out",
                str(image),
            ]
            if args.mode == "export":
                command += ["--single", "--size", "640"]
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            (HERE / "evidence" / (args.label + "-" + variant + ".log")).write_text(
                result.stdout + result.stderr
            )
            assert result.returncode == 0, result.stdout[-3000:]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == before
            bindings.append(
                {
                    "input": str(path.relative_to(ROOT)),
                    "variant": variant,
                    "inputSHA256": before,
                    "image": str(image.relative_to(ROOT)),
                    "imageSHA256": hashlib.sha256(image.read_bytes()).hexdigest(),
                    "kind": "CPU inspection only; not native Review",
                    "exit": result.returncode,
                }
            )
            print(args.mode, variant, "PASS", flush=True)
            (HERE / "reports" / (args.label + "-bindings.json")).write_text(
                json.dumps(bindings, indent=2) + "\n"
            )
    count = list((ROOT / "assets/renders/props/t08").rglob("*.png"))
    assert len(count) <= 48
    assert sum(p.stat().st_size for p in count) <= 512 * 1024**2


if __name__ == "__main__":
    main()
