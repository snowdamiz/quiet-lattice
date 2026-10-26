"""Validates art against DESIGN 19.2-19.4: naming, triangle budget by class, LOD count, material set, scale references.

Run (normally through `pnpm art:validate`, which finds Blender and resolves families and --changed):
  Blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/validate.py -- \
      [--family F] [--class C] [--report out.json | --report-dir DIR] [--verbose] [--quiet] FILE...
FILE is a source .blend (assets/blend/<family>/*.blend) or an exported .glb. The family comes from the path
(assets/blend/<family>/, public/models/<family>/, or the demo files in families.json "legacy") unless --family is given.
Prints a summary per file and writes a JSON report (default packages/tools/blender/reports/<family>__<file>.json).
Exit code: 0 when every file passes, 1 when any check fails, 2 on bad arguments.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from artlib import core, rules as R  # noqa: E402


def parse(argv):
    p = argparse.ArgumentParser(prog="validate.py", description=__doc__.split("\n")[0])
    p.add_argument("files", nargs="*")
    p.add_argument("--family")
    p.add_argument("--class", dest="cls")
    p.add_argument("--report", help="JSON report path (one file only)")
    p.add_argument("--report-dir", help="directory for JSON reports")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--quiet", action="store_true")
    return p.parse_args(argv)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parse(argv)
    rules = R.load()
    if not args.files:
        print("validate.py: no files given")
        return 2
    if args.report and len(args.files) > 1:
        print("validate.py: --report takes one file; use --report-dir for several")
        return 2
    if args.family and args.family not in rules["families"]:
        print(f"validate.py: unknown family {args.family} ({', '.join(R.family_names(rules))})")
        return 2
    failed = []
    for f in args.files:
        report = core.validate_path(rules, f, family=args.family, cls=args.cls)
        out = args.report or core.report_path(report.family, f, args.report_dir)
        core.write_and_print(report, out, verbose=args.verbose, quiet=args.quiet)
        if report.status != "PASS":
            failed.append(f)
    print(f"\n{len(args.files) - len(failed)} of {len(args.files)} file(s) passed validation")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
