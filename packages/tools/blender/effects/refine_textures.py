"""Correct sRGB encoding and distinct particle rows without touching authored geometry."""
import json
import sys
from pathlib import Path
import bpy

sys.path.insert(0,str(Path(__file__).parent))
from author import textures
from catalog import BEATS, SOURCES

for branch in BEATS:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCES/f'{branch}.blend'),load_ui=False)
    surf,particles=textures(branch)
    for mat in bpy.data.materials:
        if not mat.get('library_source') or not mat.node_tree: continue
        for node in mat.node_tree.nodes:
            if node.type=='TEX_IMAGE':
                node.image=particles if mat['engine_name'].endswith('_Particle') else surf
    for im in list(bpy.data.images):
        if im.users==0: bpy.data.images.remove(im)
    surf.name=f'FX_{branch}_filament'
    particles.name=f'FX_{branch}_particles'
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCES/f'{branch}.blend'),compress=True)
m=json.loads((SOURCES/'manifest.json').read_text())
m['recall']['batching']='Merge at most six selected glyph meshes into one geometry/material draw (different signs cannot share ordinary instancing); dissolve one draw, flash one draw, particles one draw. Glyph+dissolve+particles then flash+particles; no all-stage overlap.'
(SOURCES/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
