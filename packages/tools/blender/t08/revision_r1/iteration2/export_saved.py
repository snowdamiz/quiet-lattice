"""Saved-source publication owned by the supervisor, never by the stock producer.

Retire canonical names before content reads. Stock exporters receive an exclusive
attempt-private --out-dir, so even an unkillable child cannot publish canonical
bytes after failure. Promote only after verified cohort termination and validation.
"""

import argparse
from contextlib import nullcontext
import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time

import run

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def identity(info):
    return {
        "device": info.st_dev,
        "inode": info.st_ino,
        "mode": info.st_mode,
        "size": info.st_size,
        "mtimeNs": info.st_mtime_ns,
        "ctimeNs": info.st_ctime_ns,
    }


def read_regular(path, destination=None, follow=False, stop=None):
    """Nonblocking open rejects special files; independent archives never share an inode."""
    flags = os.O_RDONLY | os.O_NONBLOCK | (0 if follow else os.O_NOFOLLOW)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f"not a regular file: {path}")
        digest = hashlib.sha256()
        remaining = before.st_size
        deadline = time.monotonic() + 30
        stream = destination.open("xb") if destination else None
        try:
            while remaining:
                if stop:
                    stop.check()
                if time.monotonic() > deadline:
                    raise TimeoutError(f"bounded regular-file read: {path}")
                data = os.read(fd, min(1024 * 1024, remaining))
                if not data:
                    raise RuntimeError(f"file shortened while reading: {path}")
                remaining -= len(data)
                digest.update(data)
                if stream:
                    stream.write(data)
            if os.read(fd, 1):
                raise RuntimeError(f"file grew while reading: {path}")
            if identity(os.fstat(fd)) != identity(before):
                raise RuntimeError(f"file changed while reading: {path}")
            if stream:
                stream.flush()
                os.fsync(stream.fileno())
                if os.fstat(stream.fileno()).st_nlink != 1:
                    raise RuntimeError("archive is not independent")
            return {"sha256": digest.hexdigest(), "identity": identity(before)}
        finally:
            if stream:
                stream.close()
    finally:
        os.close(fd)


def quarantine(path, attempt, label):
    """Move the directory entry first. Reading/archiving can fail without leaving it live."""
    row = {"path": str(path), "invalidated": False, "sha256": None, "errors": []}
    try:
        info = path.lstat()
    except FileNotFoundError:
        return dict(row, existed=False, invalidated=True)
    except Exception as error:
        row["errors"].append(run.error_fact("lstat current entry", error))
        return row
    row.update(existed=True, original=identity(info))
    raw = attempt / (label + "-quarantine") / path.name
    try:
        raw.parent.mkdir(exist_ok=False)
        os.replace(path, raw)
        row.update(invalidated=True, quarantine=str(raw), quarantineRetained=True)
        # Read even the link text only AFTER retiring the name. Interpret relative
        # targets at the old parent, not at the quarantine directory.
        target = (
            os.path.abspath(path.parent / os.readlink(raw))
            if stat.S_ISLNK(info.st_mode)
            else None
        )
        archive = attempt / (label + ".glb")
        payload = read_regular(
            Path(target) if target else raw, archive, follow=target is not None
        )
        row.update(archive=str(archive), sha256=payload["sha256"], detachedRegular=True)
        raw.unlink()
        row["quarantineRetained"] = False
    except Exception as error:
        row["errors"].append(run.error_fact("quarantine/detach", error))
    return row


def binding_receipt(attempt, report):
    try:
        run.save_json(attempt / "binding.json", report)
        return True
    except Exception as error:
        report["errors"].append(run.error_fact("write binding", error))
        return False


def export_one(item, label, stop=None):
    family, stem = item["family"], item["stem"]
    assert family in ["props", "sites"] and stem.replace("_", "").isalnum()
    assert label and "/" not in label
    src = ROOT / "assets/blend" / family / (stem + ".blend")
    dst = ROOT / "packages/client/public/models" / family / (stem + ".glb")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    attempt = HERE / "exports" / (stamp + "-" + label + "-" + stem)
    attempt.mkdir(parents=True, exist_ok=False)
    private = attempt / "producer/models" / family / (stem + ".glb")
    report = {
        "source": str(src.relative_to(ROOT)),
        "output": str(dst.relative_to(ROOT)),
        "status": "FAILED",
        "exit": 1,
        "outputSHA256": None,
        "errors": [],
        "archives": [],
        "privateOutput": str(private),
    }
    committed = False
    lane_owned = False
    with run.Stop() if stop is None else nullcontext(stop) as stop:
        try:
            with run.lane():
                lane_owned = True
                try:
                    previous = quarantine(dst, attempt, "previous")
                    report["archives"].append(previous)
                    if not previous["invalidated"] or previous["errors"]:
                        raise RuntimeError(
                            "current entry retired incompletely; retained failure facts"
                        )
                    stop.check()
                    before = read_regular(src, stop=stop)
                    report.update(sourceBefore=before, sourceSHA256=before["sha256"])
                    command = [
                        "blender",
                        "-P",
                        f"packages/tools/blender/export_{family}.py",
                        "--",
                        "--src-root",
                        str(ROOT / "assets/blend"),
                        "--only",
                        stem,
                        "--out-dir",
                        str(attempt / "producer/models"),
                        "--report-dir",
                        str(attempt / "stock"),
                    ]
                    report["command"] = command
                    produced = run.execute(command, attempt / "producer/run", stop)
                    report["producerReceipt"] = produced["receiptPath"]
                    report["producer"] = produced
                    # Recheck even on a child failure; keep mutation distinct from its actual exit.
                    after = read_regular(src, stop=stop)
                    report["sourceAfter"] = after
                    report["sourceChanged"] = before != after
                    if not produced["pass"] or not produced["terminal"]:
                        raise RuntimeError(
                            "producer did not finish with a verified empty cohort"
                        )
                    if before != after:
                        raise RuntimeError("source changed during export")
                    report["stock"] = []
                    for ext in ["blend", "glb"]:
                        path = attempt / "stock" / f"{family}__{stem}.{ext}.json"
                        fact = read_regular(path, stop=stop)
                        raw = json.loads(path.read_text())
                        if raw["status"] != "PASS":
                            raise RuntimeError("stock report is not PASS")
                        report["stock"].append({"path": str(path), **fact})
                    # Detach from any producer-created hardlink before publication.
                    candidate = attempt / "promotion.glb"
                    payload = read_regular(private, candidate, stop=stop)
                    if read_regular(src, stop=stop) != before:
                        raise RuntimeError("source changed before promotion")
                    if os.path.lexists(dst):
                        raise RuntimeError(
                            "canonical name reappeared during private production"
                        )
                    stop.check()
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(
                        candidate, dst
                    )  # sole canonical publication in the whole task-local pipeline
                    if read_regular(src, stop=stop) != before:
                        raise RuntimeError("source changed before PASS")
                    stop.check()
                    report.update(status="PASS", exit=0, outputSHA256=payload["sha256"])
                    if not binding_receipt(attempt, report):
                        raise RuntimeError("PASS binding could not be committed")
                    committed = True
                except Exception as error:
                    report["errors"].append(run.error_fact("export transaction", error))
                finally:
                    if not committed:
                        report.update(
                            status="FAILED",
                            exit=128 + stop.signum if stop.signum else 1,
                            outputSHA256=None,
                        )
                        # A failed atomic write may have installed its destination
                        # before reporting an error. Never retain that PASS as current.
                        binding = attempt / "binding.json"
                        if os.path.lexists(binding):
                            try:
                                os.replace(
                                    binding, attempt / "uncommitted-binding.json"
                                )
                            except Exception as error:
                                report["errors"].append(
                                    run.error_fact("retire uncommitted binding", error)
                                )
                        # Removal is independent of both readability and producer cleanup success.
                        report["archives"].append(quarantine(dst, attempt, "rejected"))
                        produced = report.get("producer")
                        if produced and produced["terminal"]:
                            report["archives"].append(
                                quarantine(private, attempt, "failed-private")
                            )
                        elif produced:
                            report["privateOutputUnresolved"] = True
                        try:
                            dst.lstat()
                            report["canonicalAbsent"] = False
                        except FileNotFoundError:
                            report["canonicalAbsent"] = True
                        except Exception as error:
                            report["canonicalAbsent"] = None
                            report["errors"].append(
                                run.error_fact("observe canonical name", error)
                            )
                        if not binding_receipt(attempt, report):
                            try:
                                with (attempt / "binding-failure.json").open("x") as f:
                                    json.dump(report, f, indent=2)
                            except Exception as error:
                                print(
                                    json.dumps(
                                        run.error_fact("fallback binding", error)
                                    ),
                                    file=sys.stderr,
                                )
        except Exception as error:
            # Lane refusal must not mutate another transaction's canonical name.
            report["errors"].append(run.error_fact("acquire export lane", error))
            report["laneOwned"] = lane_owned
            binding_receipt(attempt, report)
    print(stem, report["status"], attempt.relative_to(ROOT), flush=True)
    return committed


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--only")
    p.add_argument("--label", required=True)
    args = p.parse_args()
    items = json.loads((HERE / "inventory.json").read_text())
    selected = set(args.only.split(",")) if args.only else {x["stem"] for x in items}
    assert selected and selected <= {x["stem"] for x in items}
    results = []
    with run.Stop() as stop:
        for item in items:
            if stop.signum:
                break
            if item["stem"] in selected:
                results.append(export_one(item, args.label, stop))
        return 128 + stop.signum if stop.signum else 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
