"""Prove packed-image buffers can be dropped and lazily read without changing a texel."""
import bpy,numpy as np,hashlib,json,os
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=str(Path('assets/blend/hulls/swift.blend').resolve()))
# Same generated/packed image path as the stock baker, plus an actual packed source mask.
test=bpy.data.images.new('release_fixture',512,512,alpha=False)
a=np.empty(512*512*4,np.float32);a[0::4]=np.linspace(0,1,512*512);a[1::4]=.31;a[2::4]=.17;a[3::4]=1;test.pixels.foreach_set(a);test.pack()
rows=[]
for img in [test,next(i for i in bpy.data.images if i.packed_file and i.name!='release_fixture')]:
 before=np.asarray(img.pixels[:],dtype=np.float32);shape=list(img.size);img.buffers_free();after=np.asarray(img.pixels[:],dtype=np.float32)
 ok=before.shape==after.shape and np.array_equal(before,after) and shape==list(img.size)
 rows.append({'image':img.name,'shape':shape,'beforeSha256':hashlib.sha256(before.tobytes()).hexdigest(),'afterSha256':hashlib.sha256(after.tobytes()).hexdigest(),'identical':ok})
out={'status':'PASS' if all(r['identical'] for r in rows) else 'FAIL','images':rows}
Path(os.environ['SWIFT_JOB'],'packed-buffer-proof.json').write_text(json.dumps(out,indent=2));print(out);__import__('sys').exit(0 if out['status']=='PASS' else 1)
