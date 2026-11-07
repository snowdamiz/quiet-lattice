"""Retain readable fixture bytes and exact unreadable inode facts without changing scratch."""

import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent


def write(name, value):
    with (HERE / name).open("x") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def main():
    roots, groups, commands = set(), set(), []

    def collect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "tmpdir" and isinstance(child, str):
                    path = Path(child)
                    assert path.parent == Path("/tmp") and path.name.startswith("t08-")
                    roots.add(path)
                if key in ["supervisorPID", "pgid"] and isinstance(child, int):
                    groups.add(child)
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    for result in sorted(HERE.glob("*/results.json")):
        data = json.loads(result.read_text())
        groups.update(data["ownedGroups"])
        collect(data)
        for row in data["cases"]:
            root = Path(row["scratch"]).parent
            assert root.parent == Path("/tmp") and root.name.startswith("t08-life-")
            roots.add(root)
            log = result.parent / (row["case"] + ".log")
            commands.append(
                {
                    "run": result.parent.name,
                    "case": row["case"],
                    "command": row["command"],
                    "cwd": row["scratch"],
                    "exit": row.get("exit"),
                    "expectationMet": row["expectationMet"],
                    "log": str(log.relative_to(HERE)),
                    "failureTail20": log.read_text().splitlines()[-20:]
                    if row.get("exit") != 0 or not row["expectationMet"]
                    else [],
                }
            )
    for root in roots:
        for name in ["producer.pid", "runner.pid"]:
            groups.update(int(path.read_text()) for path in root.rglob(name))
    observed = subprocess.check_output(
        ["ps", "-axo", "pid=,pgid=,stat=,command="], text=True, timeout=3
    )
    remaining = [
        line.strip() for line in observed.splitlines() if int(line.split()[1]) in groups
    ]
    write(
        "terminal-process-check.json",
        {"groups": sorted(groups), "remaining": remaining},
    )
    assert not remaining, remaining
    rows = []
    archive = HERE / "fixtures-evidence.tar.gz"
    with tarfile.open(archive, "x:gz", dereference=False) as tar:
        for root in sorted(roots):
            assert root.is_dir(), root
            for path in sorted(root.rglob("*")):
                info = path.lstat()
                row = {
                    "path": str(path),
                    "device": info.st_dev,
                    "inode": info.st_ino,
                    "mode": info.st_mode,
                    "size": info.st_size,
                    "mtimeNs": info.st_mtime_ns,
                    "sha256": None,
                }
                if stat.S_ISLNK(info.st_mode):
                    row["symlinkTarget"] = os.readlink(path)
                elif stat.S_ISREG(info.st_mode):
                    try:
                        with path.open("rb") as stream:
                            content = stream.read()
                        row["sha256"] = hashlib.sha256(content).hexdigest()
                        entry = tarfile.TarInfo(
                            root.name + "/" + str(path.relative_to(root))
                        )
                        entry.size = len(content)
                        entry.mode = 0o644
                        tar.addfile(entry, io.BytesIO(content))
                        row["archiveMember"] = entry.name
                    except OSError as error:
                        row["readError"] = {
                            "type": type(error).__name__,
                            "errno": error.errno,
                            "message": str(error),
                        }
                rows.append(row)
    write(
        "fixtures-manifest.json",
        {
            "roots": [str(p) for p in sorted(roots)],
            "archive": archive.name,
            "archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "files": rows,
            "unreadableInodesRemainAtRecordedPaths": True,
        },
    )
    write("commands-cases.json", commands)
    print(
        "SEALED",
        len(rows),
        "entries",
        len(commands),
        "commands",
        len(groups),
        "absent groups",
    )


if __name__ == "__main__":
    main()
