"""Lossless storage packing; preserve original filename, hash and byte length."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('--receipts',required=True)
a=ap.parse_args();root=Path(a.receipts);rows=[]
for p in sorted(root.glob('*.json')):
    if p.stat().st_size<128*1024:continue
    data=p.read_bytes();packed=gzip.compress(data,mtime=0);target=p.with_suffix('.json.gz')
    if target.exists():raise SystemExit(f'Refuse overwrite {target}')
    target.write_bytes(packed)
    assert gzip.decompress(target.read_bytes())==data
    rows.append(dict(original=p.name,stored=target.name,original_bytes=len(data),stored_bytes=len(packed),
                     original_sha256=hashlib.sha256(data).hexdigest(),stored_sha256=hashlib.sha256(packed).hexdigest()))
    p.unlink()
(root/'archive-manifest.json').write_text(json.dumps(dict(method='gzip, lossless; original bytes verified after compression',files=rows),indent=2)+'\n')
print(json.dumps(dict(files=len(rows),original_bytes=sum(x['original_bytes']for x in rows),stored_bytes=sum(x['stored_bytes']for x in rows))))
