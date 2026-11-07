"""Collect the completed CPU evidence and the explicit parent-owned acceptance inventory."""
import hashlib
import json
import shutil
from pathlib import Path

from catalog import BEATS, ROOT, SOURCES, sha

scratch=ROOT/'.claude/pause/P1-E07-T14'
out=SOURCES/'evidence'
out.mkdir(exist_ok=True)
m=json.loads((SOURCES/'manifest.json').read_text())
audit=json.loads((scratch/'audit.json').read_text())
assert audit['status']=='PASS' and audit['assetCount']==59 and audit['nodeCount']==63
before=json.loads((scratch/'source-before-export.json').read_text())
assert all(sha(ROOT/p)==digest for p,digest in before.items()), 'export/validation/preview changed an editable source'
for branch in BEATS:
    for ext in ('blend','glb'):
        path=scratch/'validation'/f'effects__{branch}.{ext}.json'
        assert json.loads(path.read_text())['status']=='PASS'
shutil.copytree(scratch/'validation',out/'validation',dirs_exist_ok=True)
shutil.copytree(scratch/'previews',out/'previews',dirs_exist_ok=True)
preview_inventory=out/'previews/inventory.json'
preview_inventory.write_text(preview_inventory.read_text().replace('.claude/pause/P1-E07-T14/previews/','assets/blend/effects/evidence/previews/'))
for name in ('audit.json','spore-initial-fail.json','source-before-export.json'):
    shutil.copyfile(scratch/name,out/name)
# Retain the meaningful red/green command output without absolute temp render paths or hundreds of frame messages.
tails={name:'\n'.join((scratch/(name+'.log')).read_text().splitlines()[-20:]) for name in ('author','export-initial-fail','revise','refine','export','audit','validate','preview')}
(out/'command-tails.json').write_text(json.dumps(tails,indent=2)+'\n')
commands=[
 dict(command='pnpm install --offline --frozen-lockfile --ignore-scripts',exit=0,result='239 packages reused; zero downloads'),
 dict(command='python3 packages/tools/blender/effects/run.py author',exit=0,result='six saved source files; 59 assets'),
 dict(command='python3 packages/tools/blender/effects/run.py export',exit=1,result='initial Spore 5292 tris rejected; full red report retained'),
 dict(command='python3 packages/tools/blender/effects/run.py revise',exit=0,result='seven Spore caps retained; five gill ribs each; 4578 tris'),
 dict(command='python3 packages/tools/blender/effects/run.py refine',exit=0,result='sRGB encoding corrected; all four particle shape rows distinct; geometry preserved'),
 dict(command='python3 packages/tools/blender/effects/run.py export',exit=0,result='6/6 compressed GLBs; editable sources byte-identical before/after'),
 dict(command='python3 packages/tools/blender/effects/run.py audit',exit=0,result='118 source/export checks and six negative controls; 96 functional particle frames'),
 dict(command='python3 packages/tools/blender/effects/run.py validate',exit=0,result='12/12 source and export family validations'),
 dict(command='python3 packages/tools/blender/effects/run.py preview',exit=0,result='nine CPU composites; no retained per-frame PNGs'),
 dict(command='python3 -m py_compile packages/tools/blender/effects/*.py',exit=0,result='Python syntax'),
]
(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
inventory=dict(status='PENDING_PARENT_SLOT',independentCodeReview='pending; no nested reviewer started',blindVisualGrade='pending; CPU images are iteration evidence only',
    standardCases=['lush world noon','exotic world night','open space'],lods=[0],lod2='N/A: actual family effect class has exactly one LOD',
    stillViews=[dict(asset=a['id'],glb=a['glb'],root=a['root'],lod=a['lod'],material=a['material'],role=a['role'],
                    required=['three-light textured views','wireframe','alpha/depth overlap against light and dark geometry']) for a in m['assets']],
    motionViews=[dict(node=n['id'],assets=n['assets'],aspectRatios=['16:9','21:9'],fps=60) for n in m['nodes'] if n['assets']]+[
        dict(node='recall',assets=['recall_glyph_*','recall_dissolve','recall_flash','recall_particle'],aspectRatios=['16:9','21:9'],fps=60)],
    perf=['real draw calls and transparent overdraw with 24 remotes/capital target context','particle pooling/batching and 512-particle/64-VFX-draw integration caps','60 fps target is unmeasured'],
    playbackDependencies='Ability tasks and E06.T03 own animation/lifetime, billboarding, UV stepping, glyph batching, body dissolve mask, reveal/occlusion and hit feedback. No playback code is supplied here.')
(out/'gpu-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
report=dict(TASK='P1.E07.T14',STATUS='BLOCKED',statusBoundary='Authorized source unit complete and CPU-verified; full-task acceptance awaits parent code review and blind GPU visual grade.',
 SUMMARY='Six editable branch/Recall sources, 29 beat meshes, six UV carriers, 24 exact glyphs, six functional 4x4 alpha sheets plus six 1K filament textures. All 63 Tier I-II nodes mapped. No gameplay integration.',
 BASE=m['base'],branch='task/P1-E07-T14-effects',worktree=str(ROOT),
 FILES_CHANGED=['assets/blend/effects/**','packages/client/public/models/effects/*.glb','packages/client/public/particles/effects/*.png','packages/tools/blender/effects/**'],
 VERIFY='commands.json; validation/*.json; audit.json; source-before-export.json',
 DECISIONS=[
  'No named branch palettes in the cited design tables -> choose existing bible rows: Gravitic Ixari violet/lilac, Thermal Reaches oxide/red-orange, Resonance Chorus indigo/gold, Symbiotic Ulgani amber/spore green, Void Reaches gunmetal/patch yellow; only Recall uses monolith white-cyan.',
  'Pilot/Exo-suit Tier I-II -> nine passives each, palette references but no invented VFX. The audit text describing their actives does not override the actual design tables.',
  'Other stat, scanner/HUD, eligibility and passive ship modifiers -> explicit existing-feedback reasons; no arbitrary auras. Pull Many, Chain, Echo and Big Game reuse the base cues with capped instances.',
  'Shapes use explicit metre-space reference geometry. Spatial volumes normalize to unit radius/length and declare later server-driven placement/scaling; 2 km abilities use endpoint meshes rather than 2 km geometry.',
  'No numeric particle/draw budget in cited sources -> integration limits 64 particles and four draws per cast, 512 particles and 64 VFX draws scene-wide. The delivered assets have one mesh/material primitive each and 12-triangle carriers; no runtime enforcement or timing claim.',
  'Recall alphabet -> all 23 letters plus divider, canonical unrotated seven-node lattice, round caps, stroke width 0.08 of the 1 m lattice diameter. Arrange signs clockwise without rotating each sign. Merge up to six glyphs into one draw.',
  'Recall visual timing proposal -> glyph 0-.45 s, dissolve .30-.95 s, flash .95-1.07 s. No keyframe clips authored. These are presentation suggestions, not authoritative gameplay lifetimes.',
  'Effect-specific envelope suggestions, particle caps and silhouettes -> catalog.py and manifest.json; source meshes stay editable and export never imports authoring code.',
  'Actual effects class -> 12-4578 tris per asset, 1K textures, one LOD. Existing KTX2/meshopt/quantization contracts retained with BLEND straight alpha and stable material names. LOD2 review is inapplicable.',
  'Library -> append local REF grid/biped and derive local variants of LIB_EngineGlow/LIB_GlyphLight; shared library, family rules and exporter remain unchanged.',
  'No existing ability effect path slot -> no loader hook or unowned module edit. Consumer selects manifest-named roots through the current compressed GLTF loader.'
 ],
 OUT_OF_SCOPE_FOUND=inventory['playbackDependencies'],
 ARTIFACTS=['manifest.json','evidence/audit.json','evidence/validation','evidence/previews','evidence/gpu-inventory.json','evidence/hashes.json'],
 resourceBoundary='One Blender process at a time, -t 2, Cycles CPU; final export encoder wrapper also caps KTX to two threads. No GPU/browser/native capture/DB/server. Nine composites (4.79 MB), twelve texture PNGs; no per-frame PNGs retained.',
 limitations=['No independent code review or blind grade','No native/GPU/perf evidence','No ability or Recall playback implementation','No push, PR, merge or orchestration-document edits'])
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
hashes=dict(audit['sha256'])
hashes['assets/blend/effects/manifest.json']=sha(SOURCES/'manifest.json')
for p in sorted(out.rglob('*')):
    if p.is_file() and p.name!='hashes.json': hashes[str(p.relative_to(ROOT))]=sha(p)
(out/'hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')
print('PACKAGED',len(hashes),'artifact hashes;',len(inventory['stillViews']),'GPU asset records;',len(inventory['motionViews']),'motion records')
