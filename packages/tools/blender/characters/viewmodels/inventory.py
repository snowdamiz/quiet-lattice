"""Record exact final assets and CPU evidence while proving accepted T01 preservation."""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess

ROOT=Path(__file__).resolve().parents[5]
BASE='45c172a102f1944ff00be0b6e5006eef13fd793b'
OUT=ROOT/'assets/renders/characters/viewmodels'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
accepted={}
assets={}
for person in ('thalune','ixari','ulgani'):
    for name in (f'assets/blend/characters/{person}.blend',f'packages/client/public/models/characters/{person}.glb'):
        pointer=git('show',BASE+':'+name)
        expected=pointer.split('oid sha256:')[1].splitlines()[0]
        actual=sha(ROOT/name);assert actual==expected,(name,actual,expected)
        accepted[name]={'sha256':actual,'bytes':(ROOT/name).stat().st_size}
    paths={'source':ROOT/f'assets/blend/characters/viewmodels/fp_{person}.blend','export':ROOT/f'packages/client/public/models/characters/viewmodels/fp_{person}.glb'}
    rig=json.loads((OUT/f'validation/{person}-rig.json').read_text())
    assert rig['status']=='PASS' and rig['source_sha256']==sha(paths['source'])
    for ext in ('blend','glb'):
        report=json.loads((OUT/f'validation/characters__fp_{person}.{ext}.json').read_text())
        assert report['status']=='PASS' and report['summary']['fail']==0
    assets[person]={'files':{key:{'path':str(path.relative_to(ROOT)),'sha256':sha(path),'bytes':path.stat().st_size} for key,path in paths.items()},'triangles':rig['triangles'],'bones':rig['bones'],'packed_2k_images':rig['packed_2k_images'],'axes_profile':rig['axes_profile']}
changed=git('diff',BASE,'--name-only','--','assets/renders/characters').splitlines()
assert all(name.startswith('assets/renders/characters/viewmodels/') for name in changed),changed
previews=sorted((OUT/'cpu').glob('*.png'))
assert len(previews)==6 and sum(p.stat().st_size for p in previews)<=512*1024**2
for path in previews:
    person=path.stem.split('-')[0]
    source=ROOT/assets[person]['files']['source']['path']
    assert path.stat().st_mtime>=source.stat().st_mtime,(path,'predates source')
report={'task':'P1.E05.T03','status':'CPU_CANDIDATE_REVIEW_PENDING','base':BASE,'branch':git('branch','--show-current'),'recorded_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'accepted_body_files_unchanged':accepted,'accepted_review_packets_changed':[],'assets':assets,'cpu_previews':[{'path':str(p.relative_to(ROOT)),'sha256':sha(p),'bytes':p.stat().st_size} for p in previews],'retained_preview_bytes':sum(p.stat().st_size for p in previews),'cpu_only':True,'gpu_review_and_blind_grade':'NOT RUN - parent slot required','full_smoke':'NOT RUN - parent owns active GPU lane','body_animation_state_machine':'T04 - outside this task'}
(OUT/'inventory.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'assets':assets,'retained_preview_bytes':report['retained_preview_bytes']},indent=2))
