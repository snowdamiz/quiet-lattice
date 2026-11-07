"""Offline, scoped syntax/lint/format checks with unambiguous exit receipts."""

import ast
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
NODE = Path.home() / ".local/share/fnm/node-versions/v22.23.3/installation/bin/node"
RUFF = (
    Path.home() / ".cache/uv/archive-v0/ZbLJ3VthZ-DdA6kn/ruff-0.17.4.data/scripts/ruff"
)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
out = HERE / "evidence" / (stamp + "-scoped-checks")
out.mkdir()
py = sorted(HERE.glob("*.py"))
js = sorted(HERE.glob("*.mjs")) + [
    ROOT / "packages/client/test/t08-props-real-assets.test.js"
]
env = dict(os.environ, COREPACK_ENABLE_NETWORK="0", npm_config_offline="true")
commands = [
    [RUFF, "format", "--check", "--no-cache", *py],
    [RUFF, "check", "--no-cache", "--select", "E9,F", *py],
    [
        NODE,
        "node_modules/prettier/bin/prettier.cjs",
        "--ignore-path",
        "/dev/null",
        "--check",
        *js,
    ],
    [NODE, "node_modules/eslint/bin/eslint.js", *js],
    *[[NODE, "--check", path] for path in js],
    ["git", "diff", "--check"],
    [NODE, "--version"],
    [NODE, NODE.parent.parent / "lib/node_modules/corepack/dist/pnpm.js", "--version"],
]
rows = []
for i, command in enumerate(commands):
    command = list(map(str, command))
    result = subprocess.run(
        command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=120
    )
    log = out / f"{i:02}.log"
    log.write_text(result.stdout + result.stderr)
    rows.append(
        {
            "command": command,
            "exit": result.returncode,
            "log": str(log.relative_to(ROOT)),
        }
    )
    print(i, result.returncode, command[:3], flush=True)
for path in py:
    ast.parse(path.read_text(), filename=str(path))
rows.append({"command": ["ast.parse", *map(str, py)], "exit": 0})
(out / "checks.json").write_text(json.dumps(rows, indent=2) + "\n")
sys.exit(0 if all(row["exit"] == 0 for row in rows) else 1)
