"""Archive readable fixture evidence; retain unreadable inode facts and raw scratch."""

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
                    roots.add(Path(child).resolve())
                if key in [
                    "pid",
                    "pgid",
                    "supervisorPID",
                    "retryPID",
                    "firstProducer",
                ] and isinstance(child, int):
                    groups.add(child)
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    for path in HERE.glob("*/roots.json"):
        roots.update(Path(p).resolve() for p in json.loads(path.read_text())["roots"])
    for path in HERE.glob("*/scratch.json"):
        roots.add(Path(json.loads(path.read_text())["root"]).resolve())
    for path in HERE.glob("*/results.json"):
        result = json.loads(path.read_text())
        groups.update(result["ownedGroups"])
        collect(result)
        for row in result["cases"]:
            for part in ["first", "retry"] if "firstExit" in row else ["single"]:
                cmd = row["retryCommand"] if part == "retry" else row["command"]
                code = row.get("exit") if part == "single" else row[part + "Exit"]
                log = path.parent / (
                    row["case"] + ("" if part == "single" else "-" + part) + ".log"
                )
                commands.append(
                    {
                        "run": path.parent.name,
                        "case": row["case"],
                        "phase": part,
                        "command": cmd,
                        "exit": code,
                        "expectationMet": row["expectationMet"],
                        "log": str(log),
                        "failureTail20": log.read_text().splitlines()[-20:]
                        if log.exists() and (code != 0 or not row["expectationMet"])
                        else [],
                    }
                )
    # Failed early probes can have raw receipts even when no case row was committed.
    for root in list(roots):
        for path in root.rglob("result.json"):
            collect(json.loads(path.read_text()))
        for name in ["producer.pid", "runner.pid"]:
            groups.update(int(path.read_text()) for path in root.rglob(name))
    roots = {p for p in roots if not any(p != q and p.is_relative_to(q) for q in roots)}
    assert all(p.is_relative_to(Path("/private/tmp")) and p.exists() for p in roots)
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
    archive = HERE / "fixtures.tar.gz"
    with tarfile.open(archive, "x:gz", dereference=False) as tar:
        for root in sorted(roots):
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
                        data = path.read_bytes()
                        row["sha256"] = hashlib.sha256(data).hexdigest()
                        member = tarfile.TarInfo(
                            root.name + "/" + str(path.relative_to(root))
                        )
                        member.size = len(data)
                        member.mode = 0o644
                        tar.addfile(member, io.BytesIO(data))
                        row["archiveMember"] = member.name
                    except OSError as error:
                        row["readError"] = {
                            "type": type(error).__name__,
                            "errno": error.errno,
                            "message": str(error),
                        }
                rows.append(row)
    # Verify the archive independently without restoring or chmodding raw evidence.
    wanted = {r["archiveMember"]: r["sha256"] for r in rows if "archiveMember" in r}
    with tarfile.open(archive, "r:gz") as tar:
        assert len(tar.getmembers()) == len(wanted)
        for member in tar:
            assert member.isfile()
            assert (
                hashlib.sha256(tar.extractfile(member).read()).hexdigest()
                == wanted[member.name]
            )
    write(
        "fixtures-manifest.json",
        {
            "roots": [str(p) for p in sorted(roots)],
            "archive": archive.name,
            "archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "archiveVerified": True,
            "files": rows,
        },
    )
    write("actual-commands.json", commands)
    print(
        "SEALED",
        len(rows),
        "entries",
        len(wanted),
        "archive members",
        len(commands),
        "commands",
        len(groups),
        "absent groups",
    )


if __name__ == "__main__":
    main()
