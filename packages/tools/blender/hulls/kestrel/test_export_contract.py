"""Negative controls mutate the actual compressed export, without publishing modified bytes."""
import copy
import json
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parent))
from asset_contract import ROOT,glb,inventory,read_inventory,sha

PATH=ROOT/'packages/client/public/models/hulls/kestrel.glb'


class CompressedAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original=sha(PATH);cls.doc,cls.binary=glb.read(PATH)
        print('Compressed GLB SHA256:',cls.original,flush=True)

    def setUp(self):self.doc=copy.deepcopy(self.doc);self.binary=bytearray(self.binary)

    def tearDown(self):self.assertEqual(sha(PATH),self.original)

    def test_complete_real_inventory(self):
        got=read_inventory(PATH)
        self.assertEqual(got['rawDocument'],self.doc)
        self.assertEqual(len(got['variants']),9)
        self.assertEqual(len(got['nodes']),len(self.doc['nodes']))
        for i,n in enumerate(self.doc['nodes']):
            expected=len(self.doc['meshes'][n['mesh']]['primitives']) if 'mesh' in n else 0
            self.assertEqual(len(got['nodes'][i]['primitives']),expected)

    def test_missing_LOD_rejected(self):
        next(n for n in self.doc['nodes'] if n.get('name')=='kestrel_LOD2')['name']='lost'
        with self.assertRaisesRegex(AssertionError,'missing or duplicate'):inventory(self.doc,self.binary)

    def test_missing_hardpoint_rejected(self):
        next(n for n in self.doc['nodes'] if n.get('name')=='HP_M_1')['name']='lost'
        with self.assertRaisesRegex(AssertionError,'hardpoint export'):inventory(self.doc,self.binary)

    def test_required_compression_rejected(self):
        self.doc['extensionsRequired'].remove('EXT_meshopt_compression')
        with self.assertRaisesRegex(AssertionError,'compression'):inventory(self.doc,self.binary)

    def test_1024_hero_map_rejected(self):
        image=self.doc['images'][0];view=self.doc['bufferViews'][image['bufferView']]
        struct.pack_into('<I',self.binary,view.get('byteOffset',0)+20,1024)
        with self.assertRaisesRegex(AssertionError,'4096'):inventory(self.doc,self.binary)

    def test_short_mip_chain_rejected(self):
        image=self.doc['images'][0];view=self.doc['bufferViews'][image['bufferView']]
        struct.pack_into('<I',self.binary,view.get('byteOffset',0)+40,1)
        with self.assertRaisesRegex(AssertionError,'mip chain'):inventory(self.doc,self.binary)

    def test_LOD2_cannot_lose_baked_normal(self):
        root=next(n for n in self.doc['nodes'] if n.get('name')=='kestrel_LOD2')
        pending=list(root['children']);target=None
        while pending:
            node=self.doc['nodes'][pending.pop()];pending+=node.get('children',[])
            if 'mesh' not in node:continue
            for primitive in self.doc['meshes'][node['mesh']]['primitives']:
                mi=primitive.get('material')
                if mi is not None and self.doc['materials'][mi]['name']=='Hull':target=primitive;break
            if target is not None:break
        self.assertIsNotNone(target)
        material=copy.deepcopy(self.doc['materials'][target['material']]);material.pop('normalTexture')
        target['material']=len(self.doc['materials']);self.doc['materials'].append(material)
        with self.assertRaisesRegex(AssertionError,'LOD0 atlas'):inventory(self.doc,self.binary)

    def test_extra_primitive_cannot_disappear_from_inventory(self):
        root=next(i for i,n in enumerate(self.doc['nodes']) if n.get('name')=='kestrel_LOD0')
        pending=[root];mesh=None
        while pending:
            n=self.doc['nodes'][pending.pop()]
            if 'mesh' in n and not n.get('name','').startswith('COL_'):mesh=self.doc['meshes'][n['mesh']];break
            pending+=n.get('children',[])
        self.assertIsNotNone(mesh)
        mesh['primitives'].append(copy.deepcopy(mesh['primitives'][0]))
        with self.assertRaisesRegex(AssertionError,'primitive target'):inventory(self.doc,self.binary)


if __name__=='__main__':unittest.main(verbosity=2)
