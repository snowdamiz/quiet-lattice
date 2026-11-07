"""Dependency-free perimeter bounds and semantic inventory accounting."""
from collections import Counter
from math import ceil, dist, isfinite


def perimeter(vertices, faces, nearest_distance, tolerance, spacing):
    """All boundary edges; distance to a closed set is 1-Lipschitz.

    Every point on each interval is within half its length of a sample.
    The resulting upper bound covers edges, not just selected arch centres.
    nearest_distance must be exact distance to world-space frame triangles.
    """
    if not (0 < spacing <= tolerance and isfinite(tolerance)):
        raise ValueError('Require finite tolerance >= positive spacing')
    edges = Counter(tuple(sorted((a, b))) for f in faces
                    for a, b in zip(f, f[1:] + f[:1]))
    boundary = [e for e, n in edges.items() if n == 1]
    if not boundary or any(n > 2 for n in edges.values()):
        raise ValueError('Missing perimeter or nonmanifold mesh')
    degree = Counter(v for e in boundary for v in e)
    if any(n != 2 for n in degree.values()):
        raise ValueError('Boundary must form closed loops')
    maximum = upper = length = 0.0
    samples = 0
    for ia, ib in boundary:
        a, b = vertices[ia], vertices[ib]
        edge_length = dist(a, b)
        n = max(1, ceil(edge_length / spacing))
        values = [nearest_distance(tuple(x+(y-x)*i/n for x,y in zip(a,b))) for i in range(n+1)]
        if any(d is None or not isfinite(d) or d < 0 for d in values):
            raise ValueError('Invalid nearest surface distance')
        maximum = max(maximum, max(values))
        upper = max(upper, max(values) + edge_length/(2*n))
        length += edge_length
        samples += len(values)
    return dict(status='WITHIN_CLEARANCE_BOUND' if upper <= tolerance else
                'EXCEEDS_CLEARANCE' if maximum > tolerance else 'UNRESOLVED_BOUND',
                perimeter_m=length, edges=len(boundary), samples=samples,
                sampled_max_m=maximum, conservative_max_m=upper, tolerance_m=tolerance)


def plate_count(inventory):
    """Only reviewed construction identities count; area never sets this gate."""
    plates = inventory.get('plates', [])
    ids = [p['id'] for p in plates]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate semantic plate')
    complete = bool(plates) and inventory.get('denominator_complete') is True
    complete &= all(p.get('construction_evidence') and p.get('source_faces') and
                    p.get('state') in ('present', 'removed') for p in plates)
    if not complete:
        return dict(status='UNQUALIFIED', reason='Semantic denominator or state mapping incomplete')
    removed = sum(p['state'] == 'removed' for p in plates)
    fraction = removed / len(plates)
    return dict(status='IN_COUNT_RANGE' if .15 <= fraction <= .30 else 'OUTSIDE_COUNT_RANGE',
                plates=len(plates), removed=removed, removed_fraction=fraction,
                frame_visibility='SEPARATE_UNQUALIFIED_GATE', lit_grade='NOT_MEASURED')


def classify_first_hit(hit, structural_faces):
    """Caller casts against ALL render meshes; identity is (object, polygon)."""
    if hit is None:
        return 'empty'
    return 'structural_member' if tuple(hit) in structural_faces else 'occluder_or_unknown'
