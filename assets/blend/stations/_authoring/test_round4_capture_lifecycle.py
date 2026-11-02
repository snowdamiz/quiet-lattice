"""CPU-only lifecycle controls for the station capture controller. Every fixture is owned and bounded."""
import datetime
import errno
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
OUT = Path(os.environ["ROUND4_TEST_OUTPUT"])
OUT.mkdir(parents=True, exist_ok=False)
EVENTS = []


def ps_rows():
    rows = []
    for line in subprocess.check_output(["ps", "-axo", "pid=,ppid=,pgid=,stat=,command="], text=True, timeout=3).splitlines():
        p = line.strip().split(None, 4)
        if len(p) == 5:
            rows.append({"pid": int(p[0]), "ppid": int(p[1]), "pgid": int(p[2]), "stat": p[3], "command": p[4]})
    return rows


def eventually(predicate, seconds=4):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = predicate()
        if result:
            return result
        time.sleep(0.02)
    raise AssertionError("Bounded CPU fixture condition did not arrive")


class CaptureLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.children = []
        self.extra_ids = set()
        self.extra_info = {}
        self.record = {"test": self.id(), "started_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "children": []}

    def child(self, code, **kwargs):
        child = subprocess.Popen([sys.executable, "-c", code], start_new_session=True,
                                 stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)
        self.children.append(child)
        self.record["children"].append({"pid": child.pid, "pgid": child.pid})
        return child

    def tearDown(self):
        for child in self.children:
            if child.stdin is not None and not child.stdin.closed:
                child.stdin.close()
        if self.extra_info:
            from round4_capture_children import identity
            for pid, original in self.extra_info.items():
                current = identity(pid)
                if current is not None:
                    self.assertEqual(current["birth"], original["birth"])
                    self.assertEqual(current["pgid"], original["pgid"])
                    os.killpg(current["pgid"], signal.SIGKILL)
        for child in self.children:
            if child.poll() is None:
                try:
                    child.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    pass
            if child.poll() is None:
                # These direct Popen children remain unreaped, so their identities cannot have been reused.
                os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=3)
            for name in ("stdin", "stdout", "stderr"):
                pipe = getattr(child, name)
                if pipe is not None and not pipe.closed:
                    if name != "stdin":
                        self.record.setdefault("child_pipe_output", {})[f"{child.pid}_{name}"] = pipe.read().decode(errors="replace")
                    pipe.close()
        ids = {c.pid for c in self.children} | self.extra_ids
        eventually(lambda: not [r for r in ps_rows() if r["pid"] in ids or r["pgid"] in ids])
        self.record["all_fixture_pids_and_groups_absent"] = True
        self.record["exit_statuses"] = {str(c.pid): c.returncode for c in self.children}
        EVENTS.append(self.record)
        (OUT / "fixtures.json").write_text(json.dumps(EVENTS, indent=2) + "\n")

    def test_reap_watched_caffeinate_before_signalling(self):
        capture = self.child("import sys;sys.stdin.read(1)")
        watcher = subprocess.Popen(["caffeinate", "-i", "-w", str(capture.pid)], start_new_session=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(watcher)
        self.record["children"].append({"pid": watcher.pid, "pgid": watcher.pid, "role": "real watched caffeinate"})
        if os.environ.get("ROUND4_LEGACY_REPRO") != "1":
            from round4_capture_children import CaptureChildren
            owner = CaptureChildren({"capture": capture, "caffeinate": watcher}, self.record.setdefault("lifecycle", {}))
        capture.stdin.close()
        self.assertEqual(capture.wait(timeout=3), 0)
        row = eventually(lambda: next((r for r in ps_rows() if r["pid"] == watcher.pid and r["stat"].startswith("Z")), None))
        self.record["unreaped_watched_child"] = row
        if os.environ.get("ROUND4_LEGACY_REPRO") == "1":
            # The retained old controller performs this exact call before reaping caffeinate.
            frozen = HERE.parents[3] / "assets/renders/stations/round4/engine_runs/attempt01/standard-waystation-ws_fabricator/controller_source_at_failure.py"
            self.record["old_controller_sha256"] = hashlib.sha256(frozen.read_bytes()).hexdigest()
            self.assertEqual(self.record["old_controller_sha256"], "8b91ae9081bb73daa178ff6df967e1304515538118367ff110b9eb4f87976a37")
            self.record["legacy_signal_attempt"] = {"positive_owned_pgid": watcher.pid, "signal": "SIGTERM"}
            try:
                os.killpg(watcher.pid, signal.SIGTERM)
            except PermissionError as error:
                self.record["actual_error"] = {"errno": error.errno, "message": str(error)}
                raise
        else:
            result = owner.drain(2)
            self.assertTrue(result["drained"], result)
            self.assertEqual(result["exits"], {"capture": 0, "caffeinate": 0})
            self.assertFalse(result["signals"], result)

    def owner(self, children, **kwargs):
        from round4_capture_children import CaptureChildren
        state = self.record.setdefault("lifecycle", {})
        return CaptureChildren(children, state, **kwargs)

    def test_already_exited_unreaped_child(self):
        child = self.child("import sys;sys.stdin.read(1)")
        owner = self.owner({"capture": child})
        child.stdin.close()
        eventually(lambda: next((r for r in ps_rows() if r["pid"] == child.pid and r["stat"].startswith("Z")), None))
        result = owner.drain(1)
        self.assertTrue(result["clean"], result)
        self.assertEqual(result["exits"]["capture"], 0)
        self.assertFalse(result["signals"])

    def test_natural_exit_status(self):
        child = self.child("import sys;sys.stdin.read(1);sys.exit(7)")
        owner = self.owner({"capture": child})
        child.stdin.close()
        self.assertEqual(owner.watch(2, owner.refresh, interval=0.02), "completed")
        result = owner.drain(1)
        self.assertTrue(result["clean"], result)
        self.assertEqual(result["exits"]["capture"], 7)

    def test_real_exit_between_verification_and_signal(self):
        child = self.child("import sys;sys.stdin.read(1)")

        def exit_in_signal_gap(pgid, sig):
            child.stdin.close()
            eventually(lambda: next((r for r in ps_rows() if r["pid"] == child.pid and r["stat"].startswith("Z")), None))
            os.killpg(pgid, sig)  # Real macOS EPERM on this completed, unreaped direct child.

        owner = self.owner({"capture": child}, group_signal=exit_in_signal_gap)
        owner.signal_group(child.pid, signal.SIGTERM)
        self.assertTrue(any(r["kind"] == "signal_exit_race_group_drained" for r in owner.state["events"]))
        self.assertTrue(owner.drain(1)["clean"])
        self.assertEqual(child.returncode, 0)

    def test_resistant_parent_and_descendant_with_exited_child(self):
        ready = OUT / "resistant_descendant.json"
        code = f"""import json,os,signal,subprocess,sys,time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
p=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(20)'])
open({str(ready)!r},'w').write(json.dumps({{'pid':p.pid}}))
time.sleep(20)
"""
        resistant = self.child(code)
        exited = self.child("import sys;sys.stdin.read(1)")
        owner = self.owner({"capture": resistant, "completed": exited})
        eventually(ready.exists)
        descendant = json.loads(ready.read_text())["pid"]
        self.extra_ids.add(descendant)
        eventually(lambda: descendant in {r["pid"] for r in owner.refresh()})
        exited.stdin.close()
        eventually(lambda: next((r for r in ps_rows() if r["pid"] == exited.pid and r["stat"].startswith("Z")), None))
        result = owner.drain(2)
        self.assertTrue(result["clean"], result)
        self.assertEqual(result["exits"]["completed"], 0)
        self.assertEqual(result["exits"]["capture"], -signal.SIGKILL)
        self.assertTrue(any(s["signal"] == "SIGKILL" for s in result["signals"]))

    def test_group_error_does_not_abandon_other_owned_child(self):
        first = self.child("import sys;sys.stdin.read(1)")
        other = self.child("import sys;sys.stdin.read(1)")

        def fail_first_term(pgid, sig):
            if pgid == first.pid and sig == signal.SIGTERM:
                raise PermissionError(errno.EPERM, "live-group control fault")
            os.killpg(pgid, sig)

        owner = self.owner({"capture": first, "other": other}, group_signal=fail_first_term)
        result = owner.drain(1)
        self.assertTrue(result["drained"], result)
        self.assertFalse(result["clean"], result)
        self.assertTrue(result["errors"])
        self.assertEqual(result["exits"]["other"], -signal.SIGTERM)
        self.assertEqual(result["exits"]["capture"], -signal.SIGKILL)

    def test_unknown_invalid_and_reused_identities_refused(self):
        from round4_capture_children import UnsafeCaptureGroup
        child = self.child("import sys;sys.stdin.read(1)")
        outsider = self.child("import sys;sys.stdin.read(1)")
        attempts = []
        owner = self.owner({"capture": child}, group_signal=lambda *a: attempts.append(a))
        for pgid in (0, -child.pid, 3340, os.getpgrp(), outsider.pid):
            with self.assertRaises(UnsafeCaptureGroup):
                owner.signal_group(pgid, signal.SIGTERM)
        old = dict(owner.known[child.pid])
        owner.known[child.pid] = {**old, "birth": [0, 0]}
        with self.assertRaises(UnsafeCaptureGroup):
            owner.signal_group(child.pid, signal.SIGTERM)
        owner.known[child.pid] = old
        self.assertFalse(attempts)
        self.assertIsNone(outsider.poll())
        owner.group_signal = os.killpg
        self.assertTrue(owner.drain(1)["clean"])

    def test_unverified_group_member_refused(self):
        from round4_capture_children import UnsafeCaptureGroup
        child = self.child("import sys;sys.stdin.read(1)")
        outsider = self.child("import sys;sys.stdin.read(1)")
        owner = self.owner({"capture": child})
        def untrusted_snapshot():
            return [{**r, "pgid": child.pid} if r["pid"] == outsider.pid else r for r in ps_rows()]
        owner.snapshot = untrusted_snapshot
        with self.assertRaises(UnsafeCaptureGroup):
            owner.signal_group(child.pid, signal.SIGTERM)
        self.assertIsNone(child.poll())
        self.assertIsNone(outsider.poll())
        owner.snapshot = ps_rows
        self.assertTrue(owner.drain(1)["clean"])

    def test_observer_failure_drains_known_children_without_late_write(self):
        late = OUT / "observer_late_write"
        ready = OUT / "observer_ready"
        child = self.child(f"import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);open({str(ready)!r},'w').write('ready');time.sleep(1);open({str(late)!r},'w').write('late');time.sleep(20)")
        owner = self.owner({"capture": child})
        eventually(ready.exists)
        owner.refresh()
        def failed_observer():
            raise RuntimeError("injected observer failure")
        owner.snapshot = failed_observer
        self.assertEqual(owner.watch(1, owner.refresh, interval=0.02), "observer_failed")
        result = owner.drain(0.5)
        self.assertFalse(result["clean"])
        self.assertTrue(any("observer failure" in e for e in result["errors"]))
        self.assertIsNotNone(child.poll())
        time.sleep(1.05)
        self.assertFalse(late.exists())

    def test_timeout_drains_resistant_child_without_late_write(self):
        late = OUT / "timeout_late_write"
        ready = OUT / "timeout_ready"
        child = self.child(f"import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);open({str(ready)!r},'w').write('ready');time.sleep(1);open({str(late)!r},'w').write('late');time.sleep(20)")
        owner = self.owner({"capture": child})
        eventually(ready.exists)
        self.assertEqual(owner.watch(0.10, owner.refresh, interval=0.02), "timed_out")
        self.assertTrue(owner.drain(0.5)["clean"])
        time.sleep(1.05)
        self.assertFalse(late.exists())

    def test_status_persisted_before_injected_cleanup_failure(self):
        child = self.child("import sys;sys.stdin.read(1);sys.exit(9)")
        state = {}
        file = OUT / "exit_before_cleanup_failure.json"
        from round4_capture_children import CaptureChildren
        owner = CaptureChildren({"capture": child}, state, persist=lambda: file.write_text(json.dumps(state)))
        child.stdin.close()
        self.assertEqual(owner.watch(2, owner.refresh, interval=0.02), "completed")
        self.assertEqual(json.loads(file.read_text())["exits"]["capture"], 9)
        def failure():
            raise RuntimeError("injected cleanup failure")
        owner.snapshot = failure
        result = owner.drain(0.5)
        self.assertFalse(result["clean"])
        self.assertEqual(json.loads(file.read_text())["exits"]["capture"], 9)
        self.record["lifecycle"] = result

    def test_real_sandbox_permission_failure_fails_closed(self):
        from round4_capture_children import identity
        ready = OUT / "sandbox_ready.json"
        result_file = OUT / "sandbox_result.json"
        done_file = OUT / "sandbox_reaped.json"
        code = f"""import json,os,subprocess,sys
sys.path.insert(0,{str(HERE)!r})
from round4_capture_children import CaptureChildren,identity
p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(20)'],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
state={{}}
open({str(ready)!r},'w').write(json.dumps(identity(p.pid)))
def kernel_rows():
    current=identity(p.pid)
    return [{{**current,'stat':'Z' if current['status']==5 else 'S','command':'real private signal-denial fixture'}}] if current else []
owner=CaptureChildren({{'capture':p}},state,snapshot=kernel_rows)
owner.refresh()
sys.stdin.read(1)
result=owner.drain(0.35)
open({str(result_file)!r},'w').write(json.dumps(result))
sys.stdin.read(1)
exit_code=p.wait(timeout=3)
open({str(done_file)!r},'w').write(json.dumps({{'target_exit':exit_code}}))
"""
        supervisor = subprocess.Popen(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)(deny signal)", sys.executable, "-c", code],
                                      start_new_session=True, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.children.append(supervisor)
        self.record["children"].append({"pid": supervisor.pid, "pgid": supervisor.pid, "role": "real seatbelt signal denial"})
        eventually(ready.exists)
        target = json.loads(ready.read_text())
        self.extra_ids.add(target["pid"])
        self.extra_info[target["pid"]] = target
        self.assertEqual(identity(target["pid"])["birth"], target["birth"])
        self.assertEqual(target["ppid"], supervisor.pid)
        supervisor.stdin.write(b"a"); supervisor.stdin.flush()
        eventually(result_file.exists)
        result = json.loads(result_file.read_text())
        self.record["lifecycle"] = result
        self.assertFalse(result["drained"], result)
        self.assertFalse(result["clean"], result)
        self.assertTrue(any("PermissionError" in e for e in result["errors"]), result)
        # The unsandboxed fixture owner verifies the exact child identity before bounded cleanup.
        current = identity(target["pid"])
        self.assertEqual(current["birth"], target["birth"])
        self.assertEqual(current["pgid"], target["pid"])
        os.killpg(target["pgid"], signal.SIGKILL)
        supervisor.stdin.write(b"b"); supervisor.stdin.flush(); supervisor.stdin.close()
        self.assertEqual(supervisor.wait(timeout=3), 0)
        self.assertEqual(json.loads(done_file.read_text())["target_exit"], -signal.SIGKILL)

    def test_revoked_nine_stage_grant_cannot_launch_controller(self):
        from capture_round4_stage import BASE, GRANT_FILE
        self.assertFalse(GRANT_FILE.exists())
        before = set((BASE / "engine_runs").rglob("launch.json"))
        script = HERE / "capture_round4_stage.py"
        env = dict(os.environ, STATION_ROUND4_GPU_GRANT="parent-stations-round4-nine-stages-after-ulgani-release")
        child = subprocess.Popen([sys.executable, str(script), "standard-scrapyard-sy_rock"], env=env,
                                 start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        self.record["children"].append({"pid": child.pid, "pgid": child.pid, "role": "revoked grant refusal"})
        stdout, stderr = child.communicate(timeout=3)
        self.record["refusal_stderr"] = stderr.decode()
        self.assertEqual(child.returncode, 1)
        self.assertIn("previous nine-stage grant is revoked", stderr.decode())
        self.assertEqual(set((BASE / "engine_runs").rglob("launch.json")), before)

    def test_hard_capture_deadline_interrupts_stalled_observer(self):
        from capture_round4_stage import CaptureWindowExpired, capture_deadline
        previous = signal.getsignal(signal.SIGALRM)
        started = time.monotonic()
        with self.assertRaises(CaptureWindowExpired):
            with capture_deadline(0.05):
                time.sleep(5)
        self.assertLess(time.monotonic() - started, 1)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)


if __name__ == "__main__":
    unittest.main()
