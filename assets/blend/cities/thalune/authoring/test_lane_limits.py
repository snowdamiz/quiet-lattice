"""Exercise real deadline/RSS/log cutoffs and owned-child cleanup without Blender."""
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from run_lane import run

out = Path(sys.argv[1])
out.mkdir(exist_ok=False)
results = []
for name, code, seconds, options in (
    ("deadline", "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)']); time.sleep(20)", .5, {}),
    ("rss", "import time; data=bytearray(2000000); time.sleep(20)", 5, {"rss_limit_kib": 1}),
    ("output", "import time; print('x'*8192,flush=True); time.sleep(20)", 5, {"output_limit_bytes": 1024}),
):
    receipt = out / (name + ".json")
    result = run([sys.executable, "-c", code], receipt, seconds, **options)
    record = json.loads(receipt.read_text())
    passed = result == 124 and record["limitExceeded"] == ("wall" if name == "deadline" else name) and record["processTreeReapedBeforeUnlock"]
    results.append({"test": name, "returnedExit": result, "pass": passed})
try:
    run([sys.executable, "-c", "raise SystemExit(99)"], out / "deadline.json", 5)
    immutable = False
except FileExistsError:
    immutable = True
results.append({"test": "existing_receipt_rejected_before_launch", "pass": immutable})
(out / "tests.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results))
raise SystemExit(0 if all(r["pass"] for r in results) else 1)
