import unittest
from qualification import perimeter, plate_count, classify_first_hit

class Controls(unittest.TestCase):
    def test_unknown_clearance_cannot_pass(self):
        r=perimeter([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[[0,1,2,3]],lambda p:0,None,.001)
        self.assertEqual(r['status'],'MEASURED_CLEARANCE_UNQUALIFIED')

    def test_world_transform_mismatch(self):
        square = [(0,0,0),(1,0,0),(1,1,0),(0,1,0)]
        faces = [[0,1,2,3]]
        nearest = lambda p: abs(p[2])
        self.assertEqual(perimeter(square,faces,nearest,.02,.01)['status'],'WITHIN_CLEARANCE_BOUND')
        transformed = [(x,y,z+.1) for x,y,z in square]
        self.assertEqual(perimeter(transformed,faces,nearest,.02,.01)['status'],'EXCEEDS_CLEARANCE')
        # inverse(glass.world)*frame.world subtracts pane translation.
        repaired_local = [(x,y,z-.1) for x,y,z in square]
        repaired_world = [(x,y,z+.1) for x,y,z in repaired_local]
        self.assertEqual(perimeter(repaired_world,faces,nearest,.02,.01)['status'],'WITHIN_CLEARANCE_BOUND')

    def test_between_arch_samples(self):
        r=perimeter([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[[0,1,2,3]],
                    lambda p: max(0,.1-abs(p[0]-.5)),.02,.01)
        self.assertEqual(r['status'],'EXCEEDS_CLEARANCE')

    def test_count_is_not_area(self):
        plates=[dict(id=str(i),construction_evidence='reviewed seam',source_faces=[i],
                     state='removed' if i<2 else 'present') for i in range(10)]
        binding=dict(source_sha256='source-fixture',glb_sha256='export-fixture',
                     source_topology={'Body':'source-topology-fixture'},decoded_topology={'n1/p0':'decoded-fixture'})
        inv=dict(plates=plates,denominator_complete=True,binding=binding,
                 denominator_review=dict(construction_evidence='synthetic reviewed complete fixture',outer_plate_ids=[p['id']for p in plates]),missing_area_fraction=.43)
        self.assertEqual(plate_count(inv,binding)['status'],'IN_COUNT_RANGE')
        self.assertEqual(plate_count(inv,{**binding,'glb_sha256':'changed'})['status'],'UNQUALIFIED')
        self.assertEqual(plate_count(inv)['status'],'UNQUALIFIED')
        self.assertEqual(plate_count(dict(plates=plates))['status'],'UNQUALIFIED')

    def test_other_occluder(self):
        self.assertEqual(classify_first_hit(('Seat',1),{('Rib',2)}),'occluder_or_unknown')
        self.assertEqual(classify_first_hit(('Rib',2),{('Rib',2)}),'structural_member')

class ExportControls(unittest.TestCase):
    def test_decode_and_nonuniform_world(self):
        from decoded_geometry import world_position, normalized_component
        world=[2,0,0,0, 0,3,0,0, 0,0,4,0, 5,6,7,1]
        decode=[.5,0,0,0, 0,.25,0,0, 0,0,.125,0, 1,2,3,1]
        self.assertEqual(world_position([2,4,8],world,decode),[9,15,23])
        self.assertNotEqual(world_position([2,4,8],world),[9,15,23])
        self.assertEqual(normalized_component(-128,5120),-1)

if __name__ == '__main__': unittest.main()
