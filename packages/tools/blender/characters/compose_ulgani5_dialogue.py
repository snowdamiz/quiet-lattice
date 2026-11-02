"""Lossless native morph cells plus an offline 160px portrait-size comparison.

Uses only the current full-resolution CPU sheet. No Blender/render/GPU/source edit.
"""
from pathlib import Path
import datetime,hashlib,json,os
from PIL import Image,ImageOps
root=Path.cwd();base=root/'.claude/pause/characters-resume';folder=root/'assets/renders/characters/ulgani-review5';sheet=folder/'ulgani_blendshapes.png';key=folder/'ulgani_blendshapes.txt';out=folder/'dialogue';sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert not (base/'hold-ulgani5-cpu').exists()
assert sha(sheet)=='3ec1ac06c018167298b6073e55ae44ed5623ac1381e9f83ed4f601651c377563'
assert not out.exists();out.mkdir()
names=[line.split(': ',1)[1] for line in key.read_text().splitlines()];assert len(names)==28
im=Image.open(sheet).convert('RGBA');assert im.size==(2940,1840)
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':os.getpid(),'pgid':os.getpgrp(),'scope':'CPU-only pixel composition from existing full-resolution fresh fifth morph sheet;no render/source/GLB change','source_sha256':'06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b','export_sha256':'9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682','sheet':{'path':str(sheet.relative_to(root)),'sha256':sha(sheet),'size':list(im.size)},'key_sha256':sha(key),'cells':[],'artifacts':[],'limits':'Offline static 160x160 portrait fit with preserved aspect and black padding;not in-game dialogue UI/playback evidence or a visual fitness grade. Original full-resolution sheet and native cells retained.'}
cells=[]
for name in ('vis_MBP','vis_FV'):
 n=names.index(name);x=n%7*420;y=n//7*460;box=(x,y,x+420,y+460);cell=im.crop(box);p=out/f'ulgani_{name}_native.png';cell.save(p);assert Image.open(p).tobytes()==im.crop(box).tobytes();report['cells'].append({'name':name,'one_based_sheet_cell':n+1,'crop_box':box,'native_size':[420,460],'native_pixels_equal_sheet':True});cells.append(cell)
pair=Image.new('RGBA',(840,460));small=Image.new('RGBA',(320,160),(0,0,0,255))
for i,cell in enumerate(cells):
 pair.paste(cell,(i*420,0));fit=ImageOps.contain(cell,(160,160),method=Image.Resampling.LANCZOS);small.paste(fit,(i*160+(160-fit.width)//2,(160-fit.height)//2));report['cells'][i]['dialogue_fitted_size']=list(fit.size)
pair.save(out/'ulgani_vis_MBP_FV_native_pair.png');small.save(out/'ulgani_vis_MBP_FV_160_pair.png')
for p in sorted(out.glob('*.png')):
 with Image.open(p) as decoded:decoded.load();report['artifacts'].append({'path':str(p.relative_to(root)),'sha256':sha(p),'bytes':p.stat().st_size,'size':list(decoded.size),'complete_decode':True})
assert sha(sheet)==report['sheet']['sha256'];report['sheet_unchanged']=True;report['completed_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();p=root/'assets/renders/characters/validate/ulgani-review5-dialogue.json';assert not p.exists();p.write_text(json.dumps(report,indent=2)+'\n');print('ULGANI5_DIALOGUE_COMPOSED',report['completed_utc'],sha(p),flush=True)
