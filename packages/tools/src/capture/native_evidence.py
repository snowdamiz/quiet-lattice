"""Read retained xctrace exports; never launch a recorder or infer exclusive cost."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import xml.etree.ElementTree as ET


MAX_BYTES = 32 * 1024 * 1024
MAX_ROWS = 20_000
MAX_IDS = 200_000
MAX_REFS = 64
SCHEMAS = (
    "metal-application-intervals",
    "metal-application-command-buffer-submissions",
    "metal-gpu-intervals",
)


class EvidenceError(ValueError):
    """An input cannot support the requested relation."""


def unsigned(text: str | None) -> int:
    if text is None or re.fullmatch(r"0|[1-9][0-9]*", text) is None:
        raise EvidenceError("noncanonical unsigned integer")
    return int(text)


class Document:
    def __init__(self, path: Path):
        with path.open("rb") as source:
            raw = source.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise EvidenceError("XML byte limit exceeded")
        if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
            raise EvidenceError("XML declarations with entities are unsupported")
        self.sha256 = hashlib.sha256(raw).hexdigest()
        self.root = ET.fromstring(raw)
        self.ids = {}
        for element in self.root.iter():
            key = element.get("id")
            if key is not None:
                if key in self.ids:
                    raise EvidenceError("duplicate document-scoped XML id")
                self.ids[key] = element
                if len(self.ids) > MAX_IDS:
                    raise EvidenceError("XML id limit exceeded")

    def resolve(self, element: ET.Element) -> ET.Element:
        seen = set()
        while element.get("ref") is not None:
            key = element.get("ref")
            if key in seen or len(seen) >= MAX_REFS:
                raise EvidenceError("cyclic or excessive XML reference chain")
            seen.add(key)
            if key not in self.ids:
                raise EvidenceError("missing document-scoped XML reference")
            element = self.ids[key]
        return element

    def table(
        self, expected: str
    ) -> tuple[list[str], dict[str, str], list[ET.Element]]:
        schemas = list(self.root.iter("schema"))
        if (self.root.tag != "trace-query-result" or len(schemas) != 1
                or schemas[0].get("name") != expected):
            raise EvidenceError("unexpected export root or schema")
        names = [column.findtext("mnemonic") for column in schemas[0]]
        if any(not name for name in names) or len(set(names)) != len(names):
            raise EvidenceError("missing or duplicate column mnemonic")
        types = {
            name: column.findtext("engineering-type")
            for name, column in zip(names, schemas[0])
        }
        rows = list(self.root.iter("row"))
        if len(rows) > MAX_ROWS:
            raise EvidenceError("XML row limit exceeded")
        return names, types, rows


@dataclass(frozen=True)
class NativeRow:
    ordinal: int
    pid: int
    start_ns: int
    duration_ns: int
    buffer_id: str | None
    kind: str | None
    depth: int | None
    channel: str | None
    encoder_count: int | None
    label: str | None


@dataclass(frozen=True)
class OwnedTable:
    schema: str
    sha256: str
    total_rows: int
    excluded_rows: int
    unresolved_owner_rows: int
    invalid_rows: tuple[dict, ...]
    rows: tuple[NativeRow, ...]


def read_owned(path: Path, schema: str, pid: int) -> OwnedTable:
    if schema not in SCHEMAS or pid <= 1:
        raise EvidenceError("unsupported table or owned PID")
    doc = Document(path)
    names, types, rows = doc.table(schema)
    required = {
        "process": "process", "start": "start-time", "duration": "duration",
        "cmdbuffer-id": "metal-command-buffer-id",
    }
    if any(types.get(name) != kind for name, kind in required.items()):
        raise EvidenceError("required column engineering type mismatch")
    owned, invalid = [], []
    excluded = unresolved = 0
    for ordinal, row in enumerate(rows):
        try:
            if len(row) != len(names):
                raise EvidenceError("row width differs from schema")
            cells = dict(zip(names, row))
            owner = doc.resolve(cells["process"])
            if owner.tag == "sentinel":
                unresolved += 1
                continue
            if owner.tag != "process" or len(owner.findall("pid")) != 1:
                raise EvidenceError("actual process PID missing")
            owner_pid = doc.resolve(owner.find("pid"))
            if owner_pid.tag != "pid":
                raise EvidenceError("actual process PID type mismatch")
            actual_pid = unsigned(owner_pid.text)
            if actual_pid != pid:
                excluded += 1
                continue  # Do not resolve, inspect or emit unrelated event fields.

            def cell(name):
                element = cells.get(name)
                if element is None:
                    return None
                element = doc.resolve(element)
                return None if element.tag == "sentinel" else element

            def number(name, required=False):
                element = cell(name)
                if element is None:
                    if required:
                        raise EvidenceError("required numeric cell missing")
                    return None
                if element.tag != types[name]:
                    raise EvidenceError("numeric cell engineering type mismatch")
                return unsigned(element.text)

            def text(name):
                element = cell(name)
                if element is None:
                    return None
                if element.tag != types[name]:
                    raise EvidenceError("text cell engineering type mismatch")
                return element.text

            buffer_id = number("cmdbuffer-id")
            if buffer_id is not None and buffer_id >= 2**64:
                raise EvidenceError("command buffer id exceeds uint64")
            label = cell("event-label")
            owned.append(NativeRow(
                ordinal, actual_pid, number("start", True), number("duration", True),
                None if buffer_id is None else str(buffer_id),
                text("event-type") or text("state"), number("event-depth"),
                text("channel-name"), number("num-encoders"),
                None if label is None else label.get("fmt"),
            ))
        except EvidenceError as error:
            invalid.append({"ordinal": ordinal, "failure": str(error)})
    return OwnedTable(schema, doc.sha256, len(rows), excluded, unresolved, tuple(invalid), tuple(owned))


def join_buffers(
    submissions: tuple[NativeRow, ...], gpu: tuple[NativeRow, ...]
) -> list[dict]:
    by_key = defaultdict(list)
    for row in submissions:
        if row.buffer_id is not None:
            by_key[(row.pid, row.buffer_id)].append(row.ordinal)
    result = []
    for row in gpu:
        candidates = by_key.get((row.pid, row.buffer_id), []) if row.buffer_id is not None else []
        if row.buffer_id is None:
            status = "missing-id"
        elif not candidates:
            status = "unmatched"
        elif len(candidates) == 1:
            status = "matched"
        else:
            status = "ambiguous"
        result.append({
            "gpu_ordinal": row.ordinal, "pid": row.pid, "buffer_id": row.buffer_id,
            "status": status, "submission_ordinals": candidates,
        })
    return result


def join_lifecycles(
    encodings: tuple[NativeRow, ...], submissions: tuple[NativeRow, ...]
) -> list[dict]:
    result = []
    for row in submissions:
        matches = [
            other.ordinal for other in encodings
            if row.buffer_id is not None and other.kind == "Encoding"
            and (other.pid, other.buffer_id, other.start_ns, other.duration_ns)
            == (row.pid, row.buffer_id, row.start_ns, row.duration_ns)
        ]
        status = "missing-id" if row.buffer_id is None else "unmatched"
        if matches:
            status = "matched" if len(matches) == 1 else "ambiguous"
        result.append({
            "submission_ordinal": row.ordinal, "buffer_id": row.buffer_id,
            "status": status, "encoding_ordinals": matches,
        })
    return result


def read_time_info(path: Path) -> dict:
    doc = Document(path)
    names, types, rows = doc.table("time-info")
    expected = {
        "update-time": "sample-time", "mabs-epoch": "mach-absolute-time",
        "mct-epoch": "mach-continuous-time", "timebase-info": "mach-timebase-info",
        "trace-start-time": "time-since-epoch",
    }
    if types != expected or len(rows) != 1 or len(rows[0]) != len(names):
        raise EvidenceError("time-info requires the observed single-row schema")
    cells = {name: doc.resolve(element) for name, element in zip(names, rows[0])}
    if any(element.tag != expected[name] for name, element in cells.items()):
        raise EvidenceError("time-info cell engineering type mismatch")
    if unsigned(cells["update-time"].text) != 0:
        raise EvidenceError("nonzero time update needs a separately established mapping")
    fields = list(cells["timebase-info"])
    if len(fields) != 2 or any(doc.resolve(e).tag != "mach-timebase-info-field" for e in fields):
        raise EvidenceError("timebase fraction fields missing")
    numerator, denominator = [unsigned(doc.resolve(e).text) for e in fields]
    if not numerator or not denominator:
        raise EvidenceError("timebase fraction must be positive")
    epoch = cells["trace-start-time"].text
    if epoch is None or re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", epoch) is None:
        raise EvidenceError("trace epoch is not decimal seconds")
    epoch_ns = Fraction(epoch) * 1_000_000_000
    if epoch_ns.denominator != 1:
        raise EvidenceError("trace epoch has sub-nanosecond precision")
    return {
        "sha256": doc.sha256,
        "absolute_epoch_ticks": unsigned(cells["mabs-epoch"].text),
        "continuous_epoch_ticks": unsigned(cells["mct-epoch"].text),
        "nanoseconds_per_tick": str(Fraction(numerator, denominator)),
        "trace_epoch_ns": epoch_ns.numerator, "calibrated_to_page": False,
    }


def overlaps(row: NativeRow, start_ns: int, end_ns: int) -> bool:
    if end_ns < start_ns:
        raise EvidenceError("reversed candidate window")
    if start_ns == end_ns:
        return False
    if row.duration_ns == 0:
        return start_ns <= row.start_ns < end_ns
    return row.start_ns < end_ns and row.start_ns + row.duration_ns > start_ns


def frozen_bindings(preflight: dict, context: dict) -> dict:
    approved = preflight["source_sha256"]
    captured = context["sources"]
    if (context["sourceHead"] != preflight["accepted_head"]
            or len(approved) != 23 or len(captured) != 16
            or any(approved.get(path) != digest for path, digest in captured.items())
            or len(preflight["assets"]) != 7):
        raise EvidenceError("retained source/asset bindings differ")
    return {
        "evidence_head": preflight["accepted_head"],
        "source_sha256": approved, "capture_source_sha256": captured,
        "assets": preflight["assets"], "baseline": preflight["baseline"],
        "source_status_observed": context["sourceStatus"],
        "qualification": "Preflight binds all 23 approved source/test hashes; "
        "capture context binds 16 runtime files, all an exact matching subset. "
        "Current source/assets are checked separately, not implied by parsing",
    }


def qualify(artifact: Path, pid: int) -> dict:
    toc = Document(artifact / "native-toc.xml")
    targets = toc.root.findall("./run/info/target/process")
    if (len(targets) != 1 or targets[0].get("type") != "attached"
            or unsigned(targets[0].get("pid")) != pid):
        raise EvidenceError("owned PID differs from actual attached target")
    tables = {
        schema: read_owned(artifact / f"export-{schema}.xml", schema, pid)
        for schema in SCHEMAS
    }
    time_info = read_time_info(artifact / "export-time-info.xml")
    partial = json.loads((artifact / "controls-failed.json").read_text())["partial"]
    if (partial["failureKind"] != "stationary-output-mismatch"
            or len(partial["samples"]) != 2
            or any(s["mode"] != "off" or s["queries"] for s in partial["samples"])):
        raise EvidenceError("retained failed two-frame off/off protocol differs")
    preflight = json.loads((artifact / "runtime-preflight.json").read_text())
    context = json.loads((artifact / "context.json").read_text())
    native = json.loads((artifact / "native.json").read_text())
    provenance = frozen_bindings(preflight, context)
    if not native["controlFailure"] or not native["failure"]:
        raise EvidenceError("retained failed controls differ")
    issues = {
        "meaning": "Unestablished; numeric type and literal stream name alone "
        "are not severity or clock-validity proof"
    }
    issue_path = artifact / "native.trace/Trace1.run/RunIssues.storedata"
    try:
        with sqlite3.connect(issue_path.resolve().as_uri() + "?mode=ro", uri=True) as database:
            database.row_factory = sqlite3.Row
            issues["total_rows"] = database.execute("SELECT count(*) FROM ZISSUE").fetchone()[0]
            issues["time_mapping_rows"] = [dict(row) for row in database.execute(
                "SELECT ZCOUNT,ZRELATIVETIMESTAMP,ZSUBTYPE,ZTYPE,ZMESSAGE "
                "FROM ZISSUE WHERE ZMESSAGE = 'Data stream: Time Mapping' LIMIT 10"
            )]
    except sqlite3.Error as error:
        issues["read_failure"] = type(error).__name__
    windows = []
    for ordinal, sample in enumerate(partial["samples"], 1):
        bounds = {
            key: int((Fraction(str(partial["timeOriginMs"]))
                      + Fraction(str(sample[key]["monotonicMs"]))) * 1_000_000)
            - time_info["trace_epoch_ns"]
            for key in ["started", "frameStarted", "frameFinished",
                        "readbackStarted", "readbackFinished", "finished"]
        }
        spans = {
            "whole-control": ("started", "finished"),
            "pre-completion": ("started", "frameStarted"),
            "frame-submit": ("frameStarted", "frameFinished"),
            "readback": ("readbackStarted", "readbackFinished"),
            "post-readback-completion": ("readbackFinished", "finished"),
        }
        windows.append({
            "ordinal": ordinal, "candidate_trace_ns": bounds,
            "overlaps": {
                span: {
                    schema: [row.ordinal for row in table.rows
                             if overlaps(row, bounds[start], bounds[end])]
                    for schema, table in tables.items()
                }
                for span, (start, end) in spans.items()
            },
        })
    joins = join_buffers(tables[SCHEMAS[1]].rows, tables[SCHEMAS[2]].rows)
    lifecycles = join_lifecycles(tables[SCHEMAS[0]].rows, tables[SCHEMAS[1]].rows)
    return {
        "kind": "retained-native-evidence-qualification", "owned_pid": pid,
        "primary_control_status": "FAILED: stationary-output-mismatch with both queries off",
        "primary_failure": native["failure"],
        "frozen_provenance": provenance,
        "observer_incomplete": native["recorderObservation"]["incomplete"],
        "run_issues": issues,
        "toc_sha256": toc.sha256, "time_info": time_info,
        "tables": {schema: asdict(table) for schema, table in tables.items()},
        "buffer_joins": joins, "join_counts": dict(Counter(item["status"] for item in joins)),
        "shared_lifecycle_joins": lifecycles,
        "shared_lifecycle_counts": dict(Counter(item["status"] for item in lifecycles)),
        "candidate_windows": windows,
        "qualification": "PARTIAL/INCONCLUSIVE; native encoding/submission/GPU evidence exists,not a budget or exclusive-cost verdict",
        "clock_limit": "Epoch-based page overlap is a candidate only; floor quantization<1ns does not bound clock calibration/drift. No native marker ties a JS frame/readback to a native record. Absolute and continuous ticks are different domains; no Node/page mapping is assumed.",
        "interval_limit": "Creation,Encoding,CommandBufferSubmission and GPU Active records have different meanings. Installed Metal3 rules emit the same creation-to-commit span as Encoding and Submission; exact row joins retain that shared lifetime. Creation is not commit or GPU execution. Executing branch and frame/readback mapping remain unproven. Nested/channel/buffer intervals may overlap; no exclusive-duration sum is produced.",
        "coverage_limit": "Missing,invalid,ambiguous or unmatched references/IDs remain explicit. Same PID+buffer ID is a relation,not full frame/readback attribution. SINGLE is not isolation proof; excluded event contents are never emitted.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        parser.error("existing report must be preserved")
    result = qualify(args.artifact, args.pid)
    with args.out.open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({"qualification": result["qualification"], "join_counts": result["join_counts"], "report": str(args.out)}))


if __name__ == "__main__":
    main()
