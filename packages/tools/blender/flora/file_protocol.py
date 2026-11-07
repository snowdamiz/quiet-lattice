"""Bind caller names to bytes; detach owned output names before archiving payloads."""

import hashlib
import os
import stat
from pathlib import Path


def absolute(path):
    # Do not collapse symlink/.. components: preserve the pathname the caller used.
    path = Path(path)
    return path if path.is_absolute() else Path.cwd() / path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_bound(path):
    path = absolute(path)
    resolved = path.resolve(strict=True)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK), "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f"not a regular payload: {path}")
        data = stream.read()
        after = os.fstat(stream.fileno())
    current = path.stat()

    def identity(info):
        return (
            info.st_dev,
            info.st_ino,
            info.st_size,
            info.st_mtime_ns,
            info.st_ctime_ns,
        )

    if (
        identity(before) != identity(after)
        or identity(after) != identity(current)
        or path.resolve(strict=True) != resolved
    ):
        raise RuntimeError(f"input changed during read: {path}")
    return {
        "path": str(path),
        "resolved_path": str(resolved),
        "sha256": digest(data),
        "bytes": len(data),
    }, data


def verify_bound(row):
    observed, _ = read_bound(row["path"])
    if any(observed[key] != row.get(key) for key in ("resolved_path", "sha256")):
        raise RuntimeError(f"input changed during attempt: {row['path']}")
    return observed


def error_fact(error):
    return {
        "type": type(error).__name__,
        "errno": getattr(error, "errno", None),
        "message": str(error),
    }


def archive_outputs(paths, destination):
    """Quarantine every owned name, then copy payloads into exclusive regular files.

    A failed read must not prevent removal of other runtime names. Unreadable raw
    regular entries remain in escrow, with their original permissions and errors.
    Aliases are recorded, never retained as the purported archived payload.
    """
    from receipts import sha, write_json

    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    escrow = destination / "quarantine"
    escrow.mkdir()
    records = []
    # No content reads in this phase, even for earlier readable entries.
    for requested in paths:
        path = absolute(requested)
        row = {"path": str(path), "errors": [], "invalidated": False}
        records.append(row)
        try:
            # Anchor the parent before moving a leaf alias (relative links included).
            parent = path.parent.resolve(strict=True)
            anchored = parent / path.name
            row["parent"] = str(parent)
            info = anchored.lstat()
            row["entry"] = {
                "mode": info.st_mode,
                "device": info.st_dev,
                "inode": info.st_ino,
                "links": info.st_nlink,
            }
            row["anchored"] = str(anchored)
            if stat.S_ISLNK(info.st_mode):
                row["link"] = os.readlink(anchored)
                try:
                    row["target"] = str(anchored.resolve(strict=False))
                except (OSError, RuntimeError) as error:
                    row["errors"].append(error_fact(error))
        except FileNotFoundError as error:
            if not os.path.lexists(path):
                row["absent"] = True
                row["invalidated"] = True
            else:
                row["errors"].append(error_fact(error))
        except (OSError, RuntimeError) as error:
            row["errors"].append(error_fact(error))
    # Metadata/target failures do not prevent attempting to remove an owned name.
    for row in records:
        if "anchored" not in row:
            continue
        held = escrow / Path(row["path"]).name
        try:
            Path(row["anchored"]).rename(held)
            row["invalidated"] = True
            row["quarantine"] = str(held.relative_to(destination))
        except OSError as error:
            row["errors"].append(error_fact(error))
    relocated = {
        row["anchored"]: destination / row["quarantine"]
        for row in records
        if "quarantine" in row and "link" not in row
    }
    # A read failure cannot stop the sweep above, or preservation of later entries.
    for row in records:
        if "quarantine" not in row:
            continue
        held = destination / row["quarantine"]
        target = destination / Path(row["path"]).name
        try:
            if "link" in row:
                if "target" not in row:
                    raise ValueError("prior alias target cannot be resolved")
                source = relocated.get(row["target"], Path(row["target"]))
            else:
                source = held
            bound, data = read_bound(source)
            with target.open("xb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            row["payload"] = {
                "file": target.name,
                "sha256": digest(data),
                "bytes": len(data),
            }
            if sha(target) != bound["sha256"]:
                raise RuntimeError(f"archive copy changed: {target}")
            verify_bound(bound)
            # Remove only the relocated entry, never its referent or another hardlink.
            row["detached"] = True
        except (OSError, RuntimeError, ValueError) as error:
            row["errors"].append(error_fact(error))
    for row in records:
        if "quarantine" not in row:
            continue
        held = destination / row["quarantine"]
        if row.get("detached") or held.is_symlink():
            try:
                held.unlink()
            except OSError as error:
                row["errors"].append(error_fact(error))
        row["quarantine_retained"] = os.path.lexists(held)
    write_json(destination.with_suffix(".json"), records)
    failures = [row for row in records if row["errors"] or not row["invalidated"]]
    if failures:
        raise RuntimeError(
            f"prior output preservation failed; see {destination.with_suffix('.json')}"
        )
    return records
