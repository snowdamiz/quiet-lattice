"""Stock saved-source export, exact float mask promotion, stock validation of final bytes.

No author module, validator replacement, monkeypatch, or override. The source is immutable.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parent))
from artlib import core, rules
from artlib.export import main as stock_export


def main(kind,run):
    src=ROOT/'assets/blend/flora'/f'tree_{kind}_t04.blend'
    dst=ROOT/'packages/client/public/models/flora'/f'tree_{kind}_t04.glb'
    before=hashlib.sha256(src.read_bytes()).hexdigest()
    rc=stock_export('flora',['--only',src.stem,'--report-dir',str(run/'stock-reports')])
    if rc: return rc
    raw=run/'stock-ushort.glb'
    dst.rename(raw)
    candidate=run/dst.name
    cmd=[os.environ.get('ART_NODE','node'),str(ROOT/'node_modules/tsx/dist/cli.mjs'),str(HERE/'promote_masks.mjs'),str(raw),str(candidate),str(run/'precision.json')]
    subprocess.run(cmd,check=True)
    check=core.validate_path(rules.load(),candidate,family='flora',source=src)
    core.write_and_print(check,run/'final-stock-validation.json')
    assert hashlib.sha256(src.read_bytes()).hexdigest()==before,'source changed during export'
    if check.status!='PASS': return 1
    candidate.rename(dst)
    # Intermediate ushort bytes are not a candidate. The immutable receipt retains their hash.
    (run/'stock-ushort.sha256').write_text(hashlib.sha256(raw.read_bytes()).hexdigest()+'\n')
    raw.unlink()
    print('T04_FINAL',dst,hashlib.sha256(dst.read_bytes()).hexdigest())
    return 0


if __name__=='__main__': sys.exit(main(sys.argv[-2],Path(sys.argv[-1])))
