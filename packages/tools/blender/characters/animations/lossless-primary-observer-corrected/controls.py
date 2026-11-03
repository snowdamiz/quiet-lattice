"""In-process worker controls. subprocess.Popen is refused before importing tested worker."""
import hashlib,importlib.util,io,json,subprocess,sys
from pathlib import Path
from PIL import Image
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
calls=[]
def refuse(*a,**k):calls.append(str(a));raise AssertionError('Native launch refused by pure controls')
subprocess.Popen=refuse
s=importlib.util.spec_from_file_location('worker',HERE/'rgb-primary.py');w=importlib.util.module_from_spec(s);s.loader.exec_module(w)
controls=[]
def rejected(name,fn):
    try:fn()
    except (AssertionError,ValueError):controls.append({'control':name,'pass':True});return
    raise AssertionError(name+' was accepted')
im=Image.new('RGBA',(1920,1080),(2,4,8,254));png=io.BytesIO();im.save(png,format='PNG');rejected('nonopaque alpha before forwarding',lambda:w.pixels(png.getvalue()))
rejected('PNG byte ceiling',lambda:w.pixels(b'x'*(w.PNG_LIMIT+1)))
rejected('duplicate source ID',lambda:w.check_header({'workId':'same','mediaFrameOrdinal':1},1,{'same'}))
rejected('out of order source ordinal',lambda:w.check_header({'workId':'next','mediaFrameOrdinal':2},1,set()))
proof=json.loads(Path('/private/tmp/t02-lossless-rgb-sample-132-717fs7_b/pixel-proof.json').read_text());rows=proof['sourceFrames']
text=Path('/private/tmp/t02-lossless-rgb-sample-132-717fs7_b/framehash/native-output.log').read_text() if Path('/private/tmp/t02-lossless-rgb-sample-132-717fs7_b/framehash/native-output.log').exists() else (HERE.parent/'lossless-feasibility/decoded-framehash.txt').read_text()
w.parse_framehash(text,rows,'rgb');controls.append({'control':'actual previous 132-frame hash report accepted','pass':True})
lines=text.splitlines();data=[i for i,x in enumerate(lines) if x and not x.startswith('#')]
missing=lines.copy();missing.pop(data[1]);rejected('missing decoded frame',lambda:w.parse_framehash('\n'.join(missing),rows,'rgb'))
reordered=lines.copy();reordered[data[0]],reordered[data[1]]=reordered[data[1]],reordered[data[0]];rejected('reordered decoded frame',lambda:w.parse_framehash('\n'.join(reordered),rows,'rgb'))
changed=lines.copy();parts=changed[data[0]].split(',');parts[2]=' 7';changed[data[0]]=','.join(parts);rejected('bad decoded PTS',lambda:w.parse_framehash('\n'.join(changed),rows,'rgb'))
changed=lines.copy();changed[data[0]]=changed[data[0]][:-64]+'0'*64;rejected('altered decoded hash',lambda:w.parse_framehash('\n'.join(changed),rows,'rgb'))
probe=json.loads(Path('/private/tmp/t02-lossless-rgb-sample-132-717fs7_b/probe/native-output.log').read_text());w.check_probe(probe,132);probe['packets'][1]['pts']=77;rejected('bad container PTS',lambda:w.check_probe(probe,132))
assert not calls
(HERE/'pure-python-controls.json').write_text(json.dumps({'status':'PASS_IN_PROCESS_NATIVE_LAUNCH_REFUSED','nativeCalls':calls,'controls':controls},indent=2)+'\n')
print(json.dumps({'status':'PASS','controls':len(controls),'nativeCalls':0}))
