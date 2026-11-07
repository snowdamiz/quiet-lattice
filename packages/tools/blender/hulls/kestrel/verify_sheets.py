"""Compare retained CPU contact-sheet pixels with their individually hashed source frames."""
import hashlib,json
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'


def pixels(path):
    image=bpy.data.images.load(str(path),check_existing=False)
    width,height=image.size;values=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(values)
    bpy.data.images.remove(image)
    return values.reshape(height,width,4)


result=[]
for name in ('turntable-eight-angles','materials-three-states','states-and-liveries-nine'):
    meta=json.loads((OUT/(name+'.json')).read_text());actual=pixels(OUT/(name+'.png'));columns=meta['columns'];maximum=0.0
    for i,frame in enumerate(meta['inputs']):
        path=OUT/frame['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==frame['sha256']
        expected=pixels(path);height,width=expected.shape[:2];x=i%columns*width;y=actual.shape[0]-(i//columns+1)*height
        error=float(np.max(np.abs(actual[y:y+height,x:x+width,:3]-expected[:,:,:3])))
        maximum=max(maximum,error)
        assert error<1e-6,(name,frame['file'],'contact sheet changed source pixels',error)
    result.append({'sheet':name+'.png','sha256':hashlib.sha256((OUT/(name+'.png')).read_bytes()).hexdigest(),'frames':len(meta['inputs']),'maximumDecodedRGBError':maximum})
(OUT/'contact-sheet-verification.json').write_text(json.dumps({'status':'PASS','comparisons':result},indent=2)+'\n')
print(json.dumps(result))
