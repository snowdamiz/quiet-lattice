"""Reuse only byte-identical PNG encodings from this lane's completed KTX stage.

All geometry, nodes and material definitions come from the fresh serialization.
This is a strict all-image cache: a mismatch fails rather than guessing or retrying.
"""
import hashlib, json
from pathlib import Path
from artlib import glb, ktx

def sha(data): return hashlib.sha256(data).hexdigest()

def compress(raw, target, evidence, job):
    cache = evidence / '48-split-compression'
    record = json.loads((cache / 'input-stage.json').read_text())
    encoded_pin = json.loads((cache / 'encoded-stage.json').read_text())
    root = evidence.parents[3]
    old_raw = root / record['rawPath']
    encoded = cache / 'encoded-stage.glb'
    receipt = json.loads((cache / 'receipt.json').read_text())
    assert receipt['exit'] == 0 and receipt['childGroupEmpty']
    assert sha(old_raw.read_bytes()) == record['rawSha256']
    assert sha(encoded.read_bytes()) == encoded_pin['sha256']
    old_js, old_data = glb.read(old_raw)
    encoded_js, encoded_data = glb.read(encoded)
    js, data = glb.read(raw)
    fresh_nodes = json.loads(json.dumps(js['nodes']))
    assert encoded_pin['summary']['deduplicated'] == encoded_pin['summary']['split'] == 0
    assert js['materials'] == old_js['materials'] == encoded_js['materials']
    assert js['textures'] == old_js['textures']
    assert ktx.image_slots(js) == ktx.image_slots(old_js) == ktx.image_slots(encoded_js)
    assert len(js['images']) == len(old_js['images']) == len(encoded_js['images']) == 59
    replace = {}; proofs = []
    image_views = {im['bufferView'] for im in js['images']}
    geometry_before = [sha(ktx._view_bytes(js, data, i)) for i in range(len(js['bufferViews'])) if i not in image_views]
    for i, im in enumerate(js['images']):
        original = ktx._image_bytes(old_js, old_data, i)
        current = ktx._image_bytes(js, data, i)
        assert current == original, f'image {i} differs: cache refused'
        assert encoded_js['images'][i]['mimeType'] == ktx.KTX2
        compressed = ktx._image_bytes(encoded_js, encoded_data, i)
        replace[im['bufferView']] = compressed
        im['mimeType'] = ktx.KTX2
        im.pop('uri', None)
        proofs.append({'image':i,'freshPngSha256':sha(current),'cachedPngSha256':sha(original),'ktx2Sha256':sha(compressed),'freshPngBytes':len(current),'ktx2Bytes':len(compressed)})
    for texture in js['textures']:
        image = texture.pop('source')
        texture.setdefault('extensions', {})[ktx.EXT] = {'source':image}
    ktx._set_extension(js, True)
    output = ktx._repack(js, data, replace)
    glb.write(target, js, output)
    new_js, new_data = glb.read(target)
    new_image_views = {im['bufferView'] for im in new_js['images']}
    geometry_after = [sha(ktx._view_bytes(new_js, new_data, i)) for i in range(len(new_js['bufferViews'])) if i not in new_image_views]
    assert geometry_before == geometry_after, 'cache changed non-image buffers'
    assert new_js['nodes'] == fresh_nodes, 'cache changed fresh hierarchy/transforms'
    proof = {'status':'PASS','cacheStageSha256':encoded_pin['sha256'],'freshSerializedSha256':sha(raw.read_bytes()),'nonImageBufferCount':len(geometry_before),'nonImageBuffersByteIdentical':True,'freshNodesUnchanged':True,'images':proofs}
    with (job / 'texture-cache-proof.json').open('x') as f: json.dump(proof, f, indent=2)
    print('Reused 59 KTX2 encodings after exact fresh PNG equality; all fresh geometry buffers unchanged', flush=True)
    return {**encoded_pin['summary'], 'cacheImages':59, 'cacheProof':'texture-cache-proof.json'}
