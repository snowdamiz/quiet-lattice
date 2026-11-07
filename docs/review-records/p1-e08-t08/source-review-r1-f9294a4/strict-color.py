import json
from pathlib import Path
r=json.loads((Path(__file__).resolve().parent/'decoded-result-direct.json').read_text())
bad=[{'file':f['stem'],'actual':f['formats']['COLOR_0'],'required':[[5126,False,'VEC4']]} for f in r['files'] if 'COLOR_0' in f['formats'] and f['formats']['COLOR_0']!=[[5126,False,'VEC4']]]
print(json.dumps({'exactFloatContract':'FAIL' if bad else 'PASS','violations':bad,'nonExactSampledChannels':r['nonExactMaskChannels']},indent=2))
raise SystemExit(1 if bad else 0)
