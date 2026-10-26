"""Validation results: checks made of findings, printed for people and written as JSON for the grader and CI."""
import json
import os
from datetime import datetime, timezone

CHECKS = ("naming", "triangles", "lods", "materials", "scale")
TITLES = {
    "naming": "naming",
    "triangles": "triangle budget",
    "lods": "LODs",
    "materials": "materials",
    "scale": "scale references",
}
PRINT_LIMIT = 12


class Check:
    def __init__(self, cid):
        self.id = cid
        self.findings = []  # {"level": fail|warn|info, "subject": str, "message": str}
        self.passes = []  # short notes on what passed (shown when the check passes)
        self.skipped = None  # reason when the check does not apply

    def fail(self, subject, message):
        self.findings.append({"level": "fail", "subject": subject, "message": message})

    def warn(self, subject, message):
        self.findings.append({"level": "warn", "subject": subject, "message": message})

    def info(self, subject, message):
        self.findings.append({"level": "info", "subject": subject, "message": message})

    def ok(self, subject, message):
        self.passes.append({"subject": subject, "message": message})

    def skip(self, reason):
        self.skipped = reason

    @property
    def status(self):
        if any(f["level"] == "fail" for f in self.findings):
            return "FAIL"
        return "PASS"

    def to_json(self):
        out = {"id": self.id, "status": self.status, "findings": self.findings, "passed": self.passes}
        if self.skipped:
            out["notApplicable"] = self.skipped
        return out


class Report:
    def __init__(self, path, family, mode):
        self.path = path
        self.family = family
        self.mode = mode  # "source" (.blend) or "export" (.glb)
        self.cls = None
        self.checks = {c: Check(c) for c in CHECKS}
        self.assets = []
        self.error = None  # fatal problem (file missing, LFS pointer, import failed)

    def __getitem__(self, cid):
        return self.checks[cid]

    @property
    def status(self):
        if self.error:
            return "FAIL"
        return "FAIL" if any(c.status == "FAIL" for c in self.checks.values()) else "PASS"

    def failures(self):
        out = []
        for c in self.checks.values():
            out += [dict(f, check=c.id) for f in c.findings if f["level"] == "fail"]
        return out

    def to_json(self, rel):
        import bpy

        return {
            "tool": "packages/tools/blender/validate.py",
            "file": rel(self.path),
            "family": self.family,
            "mode": self.mode,
            "status": self.status,
            "error": self.error,
            "blender": bpy.app.version_string,
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "summary": {
                "checks": {c.id: c.status for c in self.checks.values()} if not self.error else {},
                "fail": sum(1 for c in self.checks.values() for f in c.findings if f["level"] == "fail"),
                "warn": sum(1 for c in self.checks.values() for f in c.findings if f["level"] == "warn"),
            },
            "assets": self.assets,
            "checks": [c.to_json() for c in self.checks.values()] if not self.error else [],
        }

    def write(self, path, rel):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_json(rel), f, indent=2)
            f.write("\n")

    def print(self, rel, verbose=False):
        kind = "source .blend" if self.mode == "source" else "export .glb"
        print(f"\nvalidate {rel(self.path)}  (family {self.family or '?'}, {kind})")
        if self.error:
            print(f"  FAIL  {self.error}")
            print("RESULT: FAIL")
            return
        for a in self.assets:
            for v in a["variants"]:
                lods = ", ".join(f"LOD{n} {t:,}" for n, t in sorted((int(k), t) for k, t in v["lodTris"].items()))
                dims = " x ".join(f"{d:.2f}" for d in v["dims"])
                print(f"  {a['asset']} / {v['id']} [{v['class']}]  tris {lods or '-'}  size {dims} m")
        for c in self.checks.values():
            fails = [f for f in c.findings if f["level"] == "fail"]
            warns = [f for f in c.findings if f["level"] == "warn"]
            head = f"  {c.status:4}  {TITLES[c.id]}"
            if c.skipped and not c.findings:
                print(f"{head}: n/a ({c.skipped})")
                continue
            print(head + (f"  ({len(fails)} failed, {len(warns)} warnings)" if fails or warns else ""))
            shown = fails + warns + ([f for f in c.findings if f["level"] == "info"] if verbose else [])
            for f in shown[:PRINT_LIMIT]:
                print(f"        {f['level']:4}  {f['subject']}: {f['message']}")
            if len(shown) > PRINT_LIMIT:
                print(f"        ... and {len(shown) - PRINT_LIMIT} more (see the JSON report)")
            if not fails and (verbose or not warns):
                for p in c.passes[: 3 if not verbose else None]:
                    print(f"        ok    {p['subject']}: {p['message']}")
                if not verbose and len(c.passes) > 3:
                    print(f"        ok    ... {len(c.passes) - 3} more")
        n_fail = sum(1 for c in self.checks.values() if c.status == "FAIL")
        print(f"RESULT: {self.status} ({len(self.checks) - n_fail} of {len(self.checks)} checks passed)")
