import json
import contextlib
from dataclasses import replace
import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import native_evidence as evidence


SCHEMA = "metal-gpu-intervals"
CORE = [("start", "start-time"), ("duration", "duration"), ("process", "process"), ("cmdbuffer-id", "metal-command-buffer-id")]


def export(path, rows, definitions="", columns=CORE, schema=SCHEMA):
    root = ET.Element("trace-query-result")
    node = ET.SubElement(root, "node", {"target-pid": "SINGLE"})
    declaration = ET.SubElement(node, "schema", {"name": schema})
    for mnemonic, kind in columns:
        column = ET.SubElement(declaration, "col")
        ET.SubElement(column, "mnemonic").text = mnemonic
        ET.SubElement(column, "engineering-type").text = kind
    if definitions:
        node.append(ET.fromstring("<definitions>" + definitions + "</definitions>"))
    for row in rows:
        node.append(ET.fromstring("<row>" + row + "</row>"))
    ET.ElementTree(root).write(path, encoding="utf-8")


def cells(owner='<process><pid>95679</pid></process>', buffer="17", start="10", duration="5"):
    return f'<start-time>{start}</start-time><duration>{duration}</duration>{owner}<metal-command-buffer-id>{buffer}</metal-command-buffer-id>'


def native(pid=95679, buffer="17", ordinal=0, start=10, duration=5):
    return evidence.NativeRow(ordinal, pid, start, duration, buffer, None, None, None, None, None)


class NativeEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "export.xml"

    def read(self):
        return evidence.read_owned(self.path, SCHEMA, 95679)

    def test_single_and_formatted_labels_do_not_establish_ownership(self):
        export(self.path, [cells('<process fmt="owned (95679)"><pid>483</pid></process>'), cells()])
        table = self.read()
        self.assertEqual((table.total_rows, table.excluded_rows, len(table.rows)), (2, 1, 1))
        self.assertEqual(table.rows[0].pid, 95679)

    def test_unrelated_fields_are_neither_resolved_nor_emitted(self):
        columns = CORE + [("event-label", "formatted-label")]
        export(self.path, [cells('<process><pid>483</pid></process>') + '<formatted-label ref="missing-unrelated-secret"/>', cells() + '<formatted-label fmt="owned label"/>'], columns=columns)
        table = self.read()
        self.assertEqual(len(table.rows), 1)
        self.assertEqual(table.invalid_rows, ())
        self.assertNotIn("unrelated-secret", repr(table))

    def test_actual_process_and_pid_reference_chains_resolve(self):
        definitions = '<process id="p" ref="p2"/><process id="p2"><pid ref="n"/></process><pid id="n">95679</pid>'
        export(self.path, [cells('<process ref="p"/>')], definitions)
        self.assertEqual(self.read().rows[0].pid, 95679)

    def test_numeric_and_buffer_references_resolve(self):
        definitions = '<start-time id="a">10</start-time><metal-command-buffer-id id="b">18446744073709551614</metal-command-buffer-id>'
        row = '<start-time ref="a"/><duration>5</duration><process><pid>95679</pid></process><metal-command-buffer-id ref="b"/>'
        export(self.path, [row], definitions)
        self.assertEqual(self.read().rows[0].buffer_id, "18446744073709551614")

    def test_normalized_relative_intervals_are_not_rescaled_as_mach_ticks(self):
        export(self.path, [cells(start="10", duration="5")])
        row = self.read().rows[0]
        self.assertEqual((row.start_ns, row.duration_ns), (10, 5))

    def test_missing_owned_buffer_id_is_retained_for_inconclusive_join(self):
        export(self.path, [cells().replace('<metal-command-buffer-id>17</metal-command-buffer-id>', '<sentinel/>')])
        table = self.read()
        self.assertEqual(len(table.rows), 1)
        self.assertIsNone(table.rows[0].buffer_id)
        self.assertEqual(evidence.join_buffers((), table.rows)[0]["status"], "missing-id")

    def test_missing_reference_retains_invalid_row_without_owner_fallback(self):
        export(self.path, [cells('<process ref="missing" fmt="95679"/>'), cells()])
        table = self.read()
        self.assertEqual(len(table.rows), 1)
        self.assertEqual(table.invalid_rows[0]["ordinal"], 0)
        self.assertIn("missing", table.invalid_rows[0]["failure"])

    def test_cyclic_reference_is_terminal_not_a_hang(self):
        export(self.path, [cells('<process ref="p"/>')], '<process id="p" ref="q"/><process id="q" ref="p"/>')
        self.assertIn("cyclic", self.read().invalid_rows[0]["failure"])

    def test_excessive_reference_chain_is_explicit(self):
        definitions = ''.join(f'<process id="p{i}" ref="p{i+1}"/>' for i in range(65)) + '<process id="p65"><pid>95679</pid></process>'
        export(self.path, [cells('<process ref="p0"/>')], definitions)
        self.assertIn("excessive", self.read().invalid_rows[0]["failure"])

    def test_duplicate_ids_cannot_silently_shadow_ownership(self):
        definitions = '<process id="p"><pid>483</pid></process><process id="p"><pid>95679</pid></process>'
        export(self.path, [cells('<process ref="p"/>')], definitions)
        with self.assertRaisesRegex(evidence.EvidenceError, "duplicate"):
            self.read()

    def test_references_are_document_scoped(self):
        export(self.path, [cells()], '<process id="shared"><pid>95679</pid></process>')
        self.read()
        export(self.path, [cells('<process ref="shared"/>')])
        self.assertIn("missing", self.read().invalid_rows[0]["failure"])

    def test_missing_owner_is_inconclusive_not_owned(self):
        export(self.path, [cells('<sentinel/>')])
        table = self.read()
        self.assertEqual(table.unresolved_owner_rows, 1)
        self.assertFalse(table.rows)

    def test_malformed_owned_values_are_retained_as_invalid(self):
        for row in [cells(start="-1"), cells(buffer=str(2**64)), cells('<process><pid>95679x</pid></process>'), cells('<process><pid>95679</pid><pid>483</pid></process>')]:
            with self.subTest(row=row):
                export(self.path, [row])
                self.assertTrue(self.read().invalid_rows)
                self.assertFalse(self.read().rows)

    def test_wrong_schema_or_column_type_fails_closed(self):
        for kwargs in [{"schema": "other"}, {"columns": [("start", "duration")] + CORE[1:]}, {"columns": [("start", "mach-absolute-time")] + CORE[1:]}, {"columns": CORE + [("start", "start-time")]}]:
            with self.subTest(kwargs=kwargs):
                export(self.path, [cells()], **kwargs)
                with self.assertRaises(evidence.EvidenceError):
                    self.read()

    def test_row_width_is_not_zip_truncated(self):
        export(self.path, [cells() + '<duration>extra</duration>'])
        self.assertIn("width", self.read().invalid_rows[0]["failure"])

    def test_entities_and_input_caps_fail_closed(self):
        self.path.write_text('<!DOCTYPE x [<!ENTITY a "value">]><trace-query-result/>')
        with self.assertRaisesRegex(evidence.EvidenceError, "entities"):
            self.read()
        export(self.path, [cells(), cells()])
        with patch.object(evidence, "MAX_ROWS", 1), self.assertRaisesRegex(evidence.EvidenceError, "row limit"):
            self.read()
        with patch.object(evidence, "MAX_BYTES", 1), self.assertRaisesRegex(evidence.EvidenceError, "byte limit"):
            self.read()
        export(self.path, [cells()], '<pid id="a">1</pid><pid id="b">2</pid>')
        with patch.object(evidence, "MAX_IDS", 1), self.assertRaisesRegex(evidence.EvidenceError, "id limit"):
            self.read()

    def test_supplied_review_utf16_entity_case_is_rejected(self):
        fixture = Path(__file__).resolve().parents[4] / "assets/renders/review/performance/p1-e14-t13/native-encoding-correction-01/review/entity-utf-16.xml"
        with self.assertRaisesRegex(evidence.EvidenceError, "UTF-8"):
            evidence.read_owned(fixture, SCHEMA, 95679)

    def test_encoded_entity_declarations_cannot_expand_into_ownership(self):
        export(self.path, [cells()])
        body = self.path.read_text().replace("<pid>95679</pid>", "<pid>&owned;</pid>")
        declaration = '<!DOCTYPE trace-query-result [<!ENTITY owned "95679">]>'
        for codec in ["utf-8", "utf-16", "utf-16-le", "utf-16-be", "utf-32", "utf-32-le", "utf-32-be"]:
            with self.subTest(codec=codec):
                self.path.write_bytes((declaration + body).encode(codec))
                with self.assertRaises(evidence.EvidenceError):
                    self.read()

    def test_plain_utf16_and_utf32_are_outside_supported_input_contract(self):
        export(self.path, [cells()])
        body = self.path.read_text()
        for codec in ["utf-16", "utf-16-le", "utf-16-be", "utf-32", "utf-32-le", "utf-32-be"]:
            with self.subTest(codec=codec):
                self.path.write_bytes(body.encode(codec))
                with self.assertRaises(evidence.EvidenceError):
                    self.read()

    def test_declared_encoding_must_be_utf8_even_for_ascii_bytes(self):
        export(self.path, [cells()])
        body = self.path.read_text()
        for name in ["UTF-16", "UTF-32", "ISO-8859-1", "ASCII", "UTF-7", "UTF8"]:
            with self.subTest(name=name):
                self.path.write_bytes((f'<?xml version="1.0" encoding="{name}"?>' + body).encode("utf-8"))
                with self.assertRaisesRegex(evidence.EvidenceError, "encoding declaration"):
                    self.read()

    def test_utf8_unicode_predefined_entities_and_optional_single_bom_pass(self):
        columns = CORE + [("event-label", "formatted-label")]
        export(self.path, [cells() + '<formatted-label fmt="Crème 🌌 &amp; Ω"/>'], columns=columns)
        body = self.path.read_text()
        for header in ["", '<?xml version="1.0" encoding="UTF-8"?>', "<?xml version='1.0' encoding='uTf-8'?>"]:
            for bom in [b"", b"\xef\xbb\xbf"]:
                with self.subTest(header=header, bom=bool(bom)):
                    raw = bom + (header + body).encode("utf-8")
                    self.path.write_bytes(raw)
                    table = self.read()
                    self.assertEqual(table.rows[0].label, "Crème 🌌 & Ω")
                    self.assertEqual(table.sha256, hashlib.sha256(raw).hexdigest())

    def test_nul_invalid_utf8_double_bom_and_malformed_xml_reject(self):
        export(self.path, [cells()])
        body = self.path.read_bytes()
        for raw in [b"\0" + body, body.replace(b"<pid>", b"<pid>\0"), b"\xff" + body, b"\xef\xbb\xbf\xef\xbb\xbf" + body]:
            with self.subTest(raw_kind=raw[:8]):
                self.path.write_bytes(raw)
                with self.assertRaises(evidence.EvidenceError):
                    self.read()
        self.path.write_bytes(b"<trace-query-result>")
        with self.assertRaises(ET.ParseError):
            self.read()

    def test_buffer_id_join_also_requires_actual_pid(self):
        joins = evidence.join_buffers((native(pid=483),), (native(),))
        self.assertEqual(joins[0]["status"], "unmatched")

    def test_duplicate_submissions_remain_ambiguous(self):
        joins = evidence.join_buffers((native(ordinal=1), native(ordinal=4)), (native(),))
        self.assertEqual(joins[0]["status"], "ambiguous")
        self.assertEqual(joins[0]["submission_ordinals"], [1, 4])

    def test_missing_buffer_id_is_distinct_from_unmatched(self):
        joins = evidence.join_buffers((native(),), (native(buffer=None), native(buffer="18"), native()))
        self.assertEqual([j["status"] for j in joins], ["missing-id", "unmatched", "matched"])

    def test_shared_lifetime_requires_matching_process_buffer_start_and_duration(self):
        encoding = replace(native(), kind="Encoding")
        variants = [replace(encoding, pid=483), replace(encoding, buffer_id="18"), replace(encoding, start_ns=11), replace(encoding, duration_ns=6)]
        for variant in variants:
            with self.subTest(variant=variant):
                self.assertEqual(evidence.join_lifecycles((variant,), (native(),))[0]["status"], "unmatched")
        self.assertEqual(evidence.join_lifecycles((encoding,), (native(),))[0]["status"], "matched")

    def test_duplicate_or_missing_encoding_relation_stays_inconclusive(self):
        encoding = replace(native(), kind="Encoding")
        self.assertEqual(evidence.join_lifecycles((encoding, replace(encoding, ordinal=3)), (native(),))[0]["status"], "ambiguous")
        self.assertEqual(evidence.join_lifecycles((), (native(buffer=None),))[0]["status"], "missing-id")

    def test_overlap_is_half_open_and_keeps_nested_intervals_separate(self):
        self.assertFalse(evidence.overlaps(native(start=0, duration=10), 10, 20))
        self.assertFalse(evidence.overlaps(native(start=20, duration=10), 10, 20))
        self.assertTrue(evidence.overlaps(native(start=10, duration=0), 10, 20))
        self.assertFalse(evidence.overlaps(native(start=20, duration=0), 10, 20))
        self.assertFalse(evidence.overlaps(native(), 10, 10))
        self.assertEqual(sum(evidence.overlaps(row, 10, 20) for row in [native(start=0, duration=30), native(start=11, duration=2)]), 2)
        with self.assertRaisesRegex(evidence.EvidenceError, "reversed"):
            evidence.overlaps(native(), 20, 10)

    def time_export(self, update="0", numerator="125", denominator="3", epoch="1793615875.881764889"):
        columns = [("update-time", "sample-time"), ("mabs-epoch", "mach-absolute-time"), ("mct-epoch", "mach-continuous-time"), ("timebase-info", "mach-timebase-info"), ("trace-start-time", "time-since-epoch")]
        row = f'<sample-time>{update}</sample-time><mach-absolute-time>100</mach-absolute-time><mach-continuous-time>200</mach-continuous-time><mach-timebase-info><mach-timebase-info-field>{numerator}</mach-timebase-info-field><mach-timebase-info-field>{denominator}</mach-timebase-info-field></mach-timebase-info><time-since-epoch>{epoch}</time-since-epoch>'
        export(self.path, [row], columns=columns, schema="time-info")

    def test_time_info_preserves_distinct_domains_and_exact_epoch(self):
        self.time_export()
        info = evidence.read_time_info(self.path)
        self.assertEqual(info["trace_epoch_ns"], 1793615875881764889)
        self.assertEqual(info["nanoseconds_per_tick"], "125/3")
        self.assertEqual((info["absolute_epoch_ticks"], info["continuous_epoch_ticks"]), (100, 200))
        self.assertFalse(info["calibrated_to_page"])

    def test_time_info_never_invents_missing_or_updated_mapping(self):
        for kwargs in [{"update": "1"}, {"denominator": "0"}, {"numerator": "0"}, {"epoch": "nan"}, {"epoch": "1.0000000001"}]:
            with self.subTest(kwargs=kwargs):
                self.time_export(**kwargs)
                with self.assertRaises(evidence.EvidenceError):
                    evidence.read_time_info(self.path)

    def test_approval_and_runtime_source_catalogs_have_distinct_coverage(self):
        approved = {str(i): str(i) for i in range(23)}
        captured = {str(i): str(i) for i in range(16)}
        pre = {"source_sha256": approved, "accepted_head": "head", "assets": [0] * 7, "baseline": {}}
        context = {"sources": captured, "sourceHead": "head", "sourceStatus": "fresh evidence"}
        self.assertEqual(len(evidence.frozen_bindings(pre, context)["source_sha256"]), 23)
        for replacement in [{**captured, "0": "changed"}, {**captured, "extra": "unknown"}, {k: v for k, v in captured.items() if k != "0"}]:
            with self.subTest(replacement=replacement):
                with self.assertRaises(evidence.EvidenceError):
                    evidence.frozen_bindings(pre, {**context, "sources": replacement})

    def test_cli_preserves_existing_report_before_reading_any_artifact(self):
        self.path.write_text("preserved")
        argv = ["native_evidence", "--artifact", "missing", "--pid", "95679", "--out", str(self.path)]
        with patch("sys.argv", argv), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as stopped:
                evidence.main()
        self.assertEqual(stopped.exception.code, 2)
        self.assertEqual(self.path.read_text(), "preserved")


class RetainedArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = Path(__file__).resolve().parents[4] / "assets/renders/review/performance/p1-e14-t13/native-off-off-thalune-02"
        cls.report = evidence.qualify(cls.artifact, 95679)

    def test_real_single_table_does_not_grant_unrelated_rows_ownership(self):
        tables = self.report["tables"]
        self.assertEqual([len(tables[s]["rows"]) for s in evidence.SCHEMAS], [101, 32, 150])
        self.assertEqual(tables[evidence.SCHEMAS[2]]["excluded_rows"], 11861)
        self.assertTrue(all(r["pid"] == 95679 for table in tables.values() for r in table["rows"]))
        self.assertNotIn("WindowServer", json.dumps(self.report))

    def test_real_buffer_gaps_remain_inconclusive(self):
        self.assertEqual(self.report["join_counts"], {"unmatched": 2, "matched": 148})
        self.assertEqual(len({j["buffer_id"] for j in self.report["buffer_joins"] if j["status"] == "unmatched"}), 1)
        self.assertTrue(all(not t["invalid_rows"] for t in self.report["tables"].values()))
        self.assertEqual(self.report["shared_lifecycle_counts"], {"matched": 32})

    def test_real_clock_and_window_classification_never_become_a_budget(self):
        self.assertFalse(self.report["time_info"]["calibrated_to_page"])
        self.assertEqual(self.report["time_info"]["nanoseconds_per_tick"], "125/3")
        self.assertEqual(self.report["candidate_windows"][0]["candidate_trace_ns"]["frameStarted"], 1005635111)
        self.assertIn("readback", self.report["candidate_windows"][0]["overlaps"])
        self.assertIn("PARTIAL/INCONCLUSIVE", self.report["qualification"])
        self.assertIn("FAILED", self.report["primary_control_status"])
        self.assertNotIn("exclusive_duration", self.report)

    def test_frozen_bindings_and_observation_limits_survive_qualification(self):
        provenance = self.report["frozen_provenance"]
        self.assertEqual(provenance["evidence_head"], "86f01934101768a3275eeae8a9833e8f31e00825")
        self.assertEqual(len(provenance["source_sha256"]), 23)
        self.assertEqual(len(provenance["capture_source_sha256"]), 16)
        self.assertEqual(len(provenance["assets"]), 7)
        self.assertTrue(self.report["observer_incomplete"])
        self.assertEqual(self.report["run_issues"]["time_mapping_rows"][0]["ZMESSAGE"], "Data stream: Time Mapping")
        self.assertIn("Unestablished", self.report["run_issues"]["meaning"])

    def test_actual_target_mismatch_is_rejected(self):
        with self.assertRaisesRegex(evidence.EvidenceError, "attached target"):
            evidence.qualify(self.artifact, 483)


if __name__ == "__main__":
    unittest.main()
