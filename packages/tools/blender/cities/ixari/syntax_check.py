"""Parse task Python files and retain the exact checked input digests."""
import ast
import hashlib
import json
from pathlib import Path
import sys

root=Path(__file__).resolve().parents[5]
paths=sorted(Path(__file__).parent.glob('*.py'))
inputs={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
for p in paths:ast.parse(p.read_text(),filename=str(p))
out=root/sys.argv[1]
with out.open('x') as f:json.dump(dict(status='PASS',inputs=inputs),f,indent=2);f.write('\n')
print('PASS:',len(paths),'Python task tools parse; exact hashes retained')
