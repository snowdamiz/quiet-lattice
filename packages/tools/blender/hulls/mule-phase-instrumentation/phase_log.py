"""Mule channel observations; disk visibility is not publication acknowledgement."""

import json
import os
import time
import uuid
from contextvars import ContextVar
from contextlib import contextmanager

_FRAME = ContextVar("mule_bake_frame", default=None)
_IDENTITY = ("material", "variant", "channel", "resolution", "object_count", "triangle_count")
_TERMINAL = ("success", "error", "interrupt")


class PhaseError(Exception):
    pass


@contextmanager
def _closing(fd):
    """A second close failure must not replace the original write/sync failure."""
    try:
        yield fd
    except BaseException:
        try:
            os.close(fd)
        except BaseException:
            pass
        raise
    else:
        os.close(fd)


class _Frame:
    def __init__(self, material, variant, object_count, triangle_count):
        self.material = material
        self.variant = variant
        self.object_count = object_count
        self.triangle_count = triangle_count


def variant_from_label(label, variant_ids):
    if not isinstance(label, str) or label == "":
        raise PhaseError("bake label is empty")
    matches = [vid for vid in variant_ids if label == vid or label.startswith(vid + "_")]
    if not matches:
        raise PhaseError("bake label has no known variant")
    return max(matches, key=len)


def require_identity(identity):
    if not isinstance(identity, dict):
        raise PhaseError("phase identity is not a dict")
    missing = [key for key in _IDENTITY if key not in identity]
    if missing:
        raise PhaseError("phase identity is missing fields")
    for key in ("material", "variant", "channel"):
        value = identity[key]
        if not isinstance(value, str) or value == "":
            raise PhaseError("phase identity has an empty name")
    for key in ("resolution", "object_count", "triangle_count"):
        value = identity[key]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise PhaseError("phase identity has a bad count")
    if identity["resolution"] < 1:
        raise PhaseError("phase resolution is below 1")


def require_resources(resources):
    if not isinstance(resources, dict):
        raise PhaseError("phase resources are not a dict")
    try:
        json.dumps(resources)
    except (TypeError, ValueError) as exc:
        raise PhaseError("phase resources are not JSON") from exc


class PhaseLog:
    def __init__(self, path, clock=None):
        self.path = os.fspath(path)
        self._clock = clock or time.monotonic
        self._open = {}
        self._acknowledged = set()
        self._dir_synced = False
        parent = os.path.dirname(self.path)
        if parent:
            os.makedirs(parent, exist_ok=True)

    def start(self, identity, resources):
        require_identity(identity)
        require_resources(resources)
        phase_id = uuid.uuid4().hex
        record = {key: identity[key] for key in _IDENTITY}
        record.update(
            event="start",
            phase_id=phase_id,
            monotonic_s=self._clock(),
            resources=resources,
        )
        self._append(record)
        self._open[phase_id] = record
        return phase_id

    def finish(self, phase_id, outcome, error=None):
        start = self._open.get(phase_id)
        if start is None:
            raise PhaseError("no open phase")
        if outcome not in _TERMINAL:
            raise PhaseError("unknown phase outcome")
        if outcome == "success":
            if error is not None:
                raise PhaseError("success record cannot carry an error")
        elif not isinstance(error, str) or error == "":
            raise PhaseError("terminal record needs error text")
        record = {key: start[key] for key in _IDENTITY}
        record.update(
            event=outcome,
            phase_id=phase_id,
            monotonic_s=self._clock(),
            resources=start["resources"],
        )
        if error is not None:
            record["error"] = error
        self._append(record)
        self._acknowledged.add(phase_id)
        del self._open[phase_id]

    def invoke(self, identity, resources, fn):
        phase_id = self.start(identity, resources)
        try:
            result = fn()
        except BaseException as exc:
            outcome = "interrupt" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "error"
            try:
                self.finish(phase_id, outcome, error=repr(exc))
            except BaseException:
                pass
            raise
        self.finish(phase_id, "success")
        return result

    def phases(self):
        phases, _truncated = load(self.path)
        for phase in phases:
            if phase["phase_id"] in self._acknowledged:
                phase["publication"] = "acknowledged"
                phase["status"] = phase["observed_outcome"]
        return phases

    def _append(self, record):
        line = json.dumps(record, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        with _closing(os.open(self.path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o644)) as fd:
            written = os.write(fd, line)
            if written != len(line):
                raise PhaseError("short phase-log write")
            os.fsync(fd)
        if not self._dir_synced:
            with _closing(os.open(os.path.dirname(self.path) or ".", os.O_RDONLY)) as dir_fd:
                os.fsync(dir_fd)
            self._dir_synced = True


def load(path):
    """Read observations, never infer that the writer acknowledged publication.

    Even a complete terminal line can precede a failed fsync/close. All disk-only
    phases therefore remain unfinished; observed_outcome describes execution.
    Only the original live writer's phases() can report acknowledged terminals.
    Neither view qualifies the whole export.
    """
    path = os.fspath(path)
    if not os.path.exists(path):
        return [], None
    with open(path, "rb") as handle:
        raw = handle.read()
    if not raw:
        return [], None
    truncated = None
    if not raw.endswith(b"\n"):
        head, sep, tail = raw.rpartition(b"\n")
        truncated = tail
        if not sep:
            return [], truncated
        raw = head + b"\n"
    phases = []
    open_by_id = {}
    for line in raw.splitlines():
        if line == b"":
            raise PhaseError("blank phase-log line")
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise PhaseError("phase log has a corrupt line") from exc
        for key in ("event", "phase_id", "monotonic_s", "resources", *_IDENTITY):
            if key not in record:
                raise PhaseError("phase log record is missing fields")
        phase_id = record["phase_id"]
        event = record["event"]
        if not isinstance(phase_id, str) or phase_id == "":
            raise PhaseError("phase log record has no id")
        if event == "start":
            if phase_id in open_by_id or any(item["phase_id"] == phase_id for item in phases):
                raise PhaseError("phase log repeats a start")
            open_by_id[phase_id] = record
            continue
        if event not in _TERMINAL:
            raise PhaseError("phase log has an unknown event")
        start = open_by_id.pop(phase_id, None)
        if start is None:
            raise PhaseError("phase log has a terminal record without a start")
        phases.append(_closed(start, record))
    for record in open_by_id.values():
        phases.append(_closed(record, None))
    phases.sort(key=lambda item: item["started_monotonic_s"])
    return phases, truncated


def _closed(start, terminal):
    phase = {key: start[key] for key in _IDENTITY}
    phase.update(
        phase_id=start["phase_id"],
        resources=start["resources"],
        started_monotonic_s=start["monotonic_s"],
        ended_monotonic_s=None if terminal is None else terminal["monotonic_s"],
        error=None if terminal is None else terminal.get("error"),
        observed_outcome=None if terminal is None else terminal["event"],
        publication="unconfirmed",
        status="unfinished",
    )
    return phase


def install(bake_module, phase_log, *, resources_of, counts_of, variant_ids):
    ids = tuple(variant_ids)
    for vid in ids:
        if not isinstance(vid, str) or vid == "":
            raise PhaseError("variant id is empty")
    original_material = bake_module.bake_material
    original_channels = bake_module._bake_channels

    def bake_material(mat, objects, res, ao=False, label=None, occluders=None, log=print):
        variant = variant_from_label(label or mat.name, ids)
        counted = counts_of(objects)
        if (
            not isinstance(counted, tuple)
            or len(counted) != 2
            or isinstance(counted[0], bool)
            or isinstance(counted[1], bool)
            or not isinstance(counted[0], int)
            or not isinstance(counted[1], int)
            or counted[0] < 0
            or counted[1] < 0
        ):
            raise PhaseError("mesh counts are not two whole numbers")
        frame = _Frame(mat.name, variant, counted[0], counted[1])
        token = _FRAME.set(frame)
        try:
            return original_material(
                mat, objects, res, ao=ao, label=label, occluders=occluders, log=log
            )
        finally:
            _FRAME.reset(token)

    def bake_channels(info, nt, out, surface, todo, res, label):
        frame = _FRAME.get()
        if frame is None:
            raise PhaseError("channel bake has no frame")
        images = {}
        for channel in todo:
            identity = {
                "material": frame.material,
                "variant": frame.variant,
                "channel": channel,
                "resolution": res,
                "object_count": frame.object_count,
                "triangle_count": frame.triangle_count,
            }
            require_identity(identity)

            def one(channel=channel):
                return original_channels(info, nt, out, surface, [channel], res, label)

            images.update(phase_log.invoke(identity, resources_of(), one))
        return images

    bake_module.bake_material = bake_material
    bake_module._bake_channels = bake_channels

    def uninstall():
        bake_module.bake_material = original_material
        bake_module._bake_channels = original_channels

    return uninstall
