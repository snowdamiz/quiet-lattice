"""A real temporary file disappearing between enumerate and stat must not cancel a healthy job."""
import importlib.util,tempfile,json,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('lane',Path(__file__).with_name('lane.py'));lane=importlib.util.module_from_spec(spec);spec.loader.exec_module(lane)
job=Path(os.environ['SWIFT_JOB'])
with tempfile.TemporaryDirectory(dir=job/'scratch') as tmp:
 p=Path(tmp);gone=p/'gone.png';kept=p/'kept.txt';gone.write_bytes(b'a'*1024);kept.write_bytes(b'kept')
 snapshot=list(p.iterdir());gone.unlink()
 old_failed=False
 try:sum(x.stat().st_size for x in snapshot)
 except FileNotFoundError:old_failed=True
 result=list(lane.existing_sizes(snapshot));assert old_failed and result==[(kept,4)]
 out={'status':'PASS','oldSnapshotStatRaisedFileNotFound':old_failed,'currentCountedBytes':sum(size for path,size in result),'survivingFiles':len(result)}
(job/'monitor-test.json').write_text(json.dumps(out,indent=2));print(out)
