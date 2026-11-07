from pathlib import Path
import bpy,json
root=Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41');result={}
for species,prefix in [('thalune','TH'),('ixari','IX'),('ulgani','UL')]:
 bpy.ops.wm.open_mainfile(filepath=str(root/f'assets/blend/characters/{species}.blend'));bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
 rows=[]
 for name in [f'{prefix}_Body_head1_L0',f'{prefix}_Body_head1_L3']:
  obj=bpy.data.objects[name];me=obj.data
  faces={}
  for f in me.polygons:
   for i in f.vertices:faces.setdefault(i,[]).append(f.index)
  for v in me.vertices:
   gs=[(obj.vertex_groups[g.group].name,g.weight) for g in v.groups]
   if not gs or abs(sum(g[1] for g in gs)-1)>1e-4 or len([g for g in gs if g[1]>1e-6])>4:rows.append({'object':name,'vertex':v.index,'position':list(v.co),'groups':gs,'face_count':len(faces.get(v.index,[]))})
 result[species]=rows
 print(species,rows,flush=True)
Path('/tmp/characters-whole-review-sol-20261102/source-weights.json').write_text(json.dumps(result,indent=2))
