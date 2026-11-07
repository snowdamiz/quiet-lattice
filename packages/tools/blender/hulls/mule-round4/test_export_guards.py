"""Fault injection at the real decoder/check wrapper boundaries, with retained bytes."""
import hashlib
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parent))
import export_saved as e
out=Path(os.environ['MULE_ATTEMPT'])
src=out/'scratch/invalid.glb'
src.write_bytes(b'glTF invalid retained decode candidate')
def fail(*args,**kwargs):raise ValueError('injected failure')
e.original_load=fail
try:e.preserving_load(src)
except ValueError:pass
else:raise AssertionError('decoder failure swallowed')
src.unlink()  # reproduce stock finally cleanup
retained=out/e.candidate['path']
assert retained.exists() and hashlib.sha256(retained.read_bytes()).hexdigest()==e.candidate['sha256']
e.original_checks=fail
try:e.checks(None,None,None,'export')
except ValueError:pass
else:raise AssertionError('validation failure swallowed')
failures=[json.loads(line) for line in (out/'export-failures.jsonl').read_text().splitlines()]
assert [f['phase'] for f in failures]==['decode','export-checks']
assert retained.read_bytes()==b'glTF invalid retained decode candidate'
(out/'guard-tests.json').write_text(json.dumps({'status':'PASS','decode_failure_retained':True,'validation_exception_retained':True,'failed_candidate_sha256':e.candidate['sha256']},indent=2))
print('PASS: decoder and validation exceptions preserve candidate and phase metadata',flush=True)
