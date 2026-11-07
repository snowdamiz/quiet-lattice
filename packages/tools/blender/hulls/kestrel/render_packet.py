"""CPU-only bounded evidence packet, composed from the saved source and actual compressed export."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import bpy
import numpy as np

HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import preview
from asset_contract import VARIANTS,STATES
ROOT=HERE.parents[4];OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'


def budget(extra=0):
    paths=list(OUT.rglob('*.png'));decoded=0
    for p in paths:
        data=p.read_bytes()[:24];assert data[:8]==b'\x89PNG\r\n\x1a\n'
        w,h=struct.unpack_from('>II',data,16);decoded+=w*h*4
    size=sum(p.stat().st_size for p in paths)
    assert len(paths)+extra<=48 and decoded+extra*1200*900*4<=512*1024**2 and size<=512*1024**2,(len(paths),decoded,size)
    return {'images':len(paths),'encodedBytes':size,'decodedRGBABytes':decoded,'limits':{'images':48,'bytes':512*1024**2}}


def render(name,args):
    budget(1)
    path=OUT/(name+'.png');assert not path.exists(),('refusing to overwrite evidence',name)
    sys.argv=['preview.py','--',*args,'--name',name];preview.main();budget()


def sheet(name,inputs,columns):
    frames=[bpy.data.images.load(str(OUT/(s+'.png')),check_existing=False) for s in inputs]
    width,height=frames[0].size;assert all(list(i.size)==[width,height] for i in frames)
    rows=(len(frames)+columns-1)//columns
    data=np.ones((rows*height,columns*width,4),np.float32);data[:,:,:3]=.03
    for i,im in enumerate(frames):
        px=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(px);x=(i%columns)*width;y=(rows-1-i//columns)*height
        data[y:y+height,x:x+width]=px.reshape(height,width,4)
    im=bpy.data.images.new(name,columns*width,rows*height,alpha=False)
    im.colorspace_settings.name='sRGB';im.pixels.foreach_set(data.ravel());im.update();im.filepath_raw=str(OUT/(name+'.png'));im.file_format='PNG';im.save()
    (OUT/(name+'.json')).write_text(json.dumps({'type':'unaltered CPU-render contact sheet','order':'left to right, top to bottom','columns':columns,'inputs':[{'file':s+'.png','sha256':hashlib.sha256((OUT/(s+'.png')).read_bytes()).hexdigest()} for s in inputs],'sha256':hashlib.sha256((OUT/(name+'.png')).read_bytes()).hexdigest()},indent=2)+'\n')
    for f in frames:bpy.data.images.remove(f)
    bpy.data.images.remove(im);budget()


def main():
    p=argparse.ArgumentParser();p.add_argument('part',choices=['source','export'])
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    if a.part=='source':
        budget(16)
        turns=[]
        for angle in range(0,360,45):
            name=f'turntable-{angle:03d}';render(name,['--angle',str(angle)]);turns.append(name)
        sheet('turntable-eight-angles',turns,4)
        for view in ('cockpit','boarding','hardpoint'):
            render('fit-'+view,['--view',view,*(['--open'] if view in ('cockpit','boarding') else [])])
        render('cockpit-working',['--view','cockpit','--open','--variant','kestrel_working'])
        materials=[]
        for state in STATES:
            name='material-'+state;render(name,['--view','material','--variant',state]);materials.append(name)
        sheet('materials-three-states',materials,3)
    else:
        budget(16)
        names=[]
        for variant in VARIANTS:
            name='export-'+variant;render(name,['--export','--variant',variant]);names.append(name)
        sheet('states-and-liveries-nine',names,3)
        for variant in STATES:render('export-LOD2-'+variant,['--export','--variant',variant,'--lod','2'])
        render('fit-hardpoint-clear',['--view','hardpoint'])
        render('fit-pilot',['--view','pilot','--open'])
        render('export-pilot',['--export','--view','pilot','--open'])
    (OUT/('preview-budget-'+a.part+'.json')).write_text(json.dumps(budget(),indent=2)+'\n')


if __name__=='__main__':main()
