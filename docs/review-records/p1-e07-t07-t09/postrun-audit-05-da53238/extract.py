from pathlib import Path
import json,base64,hashlib,re,struct,zlib
A=Path(__file__).resolve().parent;c=json.loads((A/'audit-context.json').read_text());R=Path(c['run']);d=json.loads((R/'playwright.json').read_text());(A/'attachments').mkdir()
def specs(ss):
 for s in ss:
  yield from s.get('specs',[])
  yield from specs(s.get('suites',[]))
rows=[];attachments=[]
for s in specs(d['suites']):
 for t in s['tests']:
  for r in t['results']:
   rows.append({'spec':{k:v for k,v in s.items() if k!='tests'},'test':{k:v for k,v in t.items() if k!='results'},'result':{k:v for k,v in r.items() if k not in ['stdout','stderr','attachments']}})
   for i,a in enumerate(r['attachments']):
    x={k:v for k,v in a.items() if k!='body'};x['index']=i
    if 'body' in a:
     b=base64.b64decode(a['body'],validate=True);ext={'image/png':'.png','application/json':'.json','text/plain':'.log'}.get(a['contentType'],'.bin');p=A/'attachments'/(f'{i+1:02d}-'+re.sub('[^A-Za-z0-9_-]','_',a['name'])+ext);p.write_bytes(b)
     x.update(extractedPath=str(p),bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),originalEncoding='base64 inline body')
     if ext=='.png':
      assert b[:8]==b'\x89PNG\r\n\x1a\n';x['dimensions']=struct.unpack('>II',b[16:24]);pos=8;data=b''
      while pos<len(b):
       n=struct.unpack('>I',b[pos:pos+4])[0];typ=b[pos+4:pos+8];body=b[pos+8:pos+8+n];crc=struct.unpack('>I',b[pos+8+n:pos+12+n])[0];assert zlib.crc32(typ+body)&0xffffffff==crc
       if typ==b'IDAT':data+=body
       pos+=n+12
      assert pos==len(b) and typ==b'IEND';x.update(pngCrcValid=True,inflatedPixelStreamBytes=len(zlib.decompress(data)))
    else:x['pathExists']=Path(a['path']).exists() if a.get('path') else False
    attachments.append(x)
   (A/'browser-stderr-raw.txt').write_text(''.join(x.get('text','') for x in r.get('stderr',[])))
   (A/'test-error.txt').write_text(re.sub(r'\x1b\[[0-9;]*m','',r.get('error',{}).get('stack',''))+'\n')
summary={'sourceReport':str(R/'playwright.json'),'reportSha256':hashlib.sha256((R/'playwright.json').read_bytes()).hexdigest(),'stats':d['stats'],'topLevelErrors':d['errors'],'testResults':rows,'config':d['config'],'standalonePngPaths':[str(p) for p in R.rglob('*.png')],'attachments':attachments}
(A/'test-report-summary.json').write_text(json.dumps(summary,indent=2)+'\n');(A/'attachments.json').write_text(json.dumps(attachments,indent=2)+'\n')
raw=(R/'supervision/single-metal-test/stdout.txt').read_text();(A/'stdout-tail.txt').write_text(raw[-24000:])
e=json.loads(next((A/'attachments').glob('*symbiotic-evidence.json')).read_text())
print(json.dumps({'stats':d['stats'],'topLevelErrors':d['errors'],'results':rows,'attachments':[{k:v for k,v in x.items() if k not in ['sha256','originalEncoding']} for x in attachments],'evidenceKeys':list(e),'fixtureErrors':e.get('errors'),'beforeRelease':e.get('beforeRelease'),'release':e.get('release'),'retired':e.get('retired')},indent=2))
