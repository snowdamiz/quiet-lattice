"""Place the anchor's point light on the edited left glyph face, not in the empty cleft."""
import hashlib
import json
from pathlib import Path
import bpy

ROOT=Path(__file__).resolve().parents[5]
source=ROOT/'assets/blend/cities/ixari_anchor.blend'
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
bpy.context.preferences.filepaths.save_version=0
marker=bpy.data.objects['Light_Anchor_anchor_quavel']
marker.location=(-3.78,-2.45,22)
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
inventory=ROOT/'assets/blend/cities/ixari/inventory/anchor.json'
data=json.loads(inventory.read_text())
for entry in data:
    entry['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
    for point in entry['markers']:
        if point['name']==marker.name:point['position']=list(marker.location)
inventory.write_text(json.dumps(data,indent=2)+'\n')
