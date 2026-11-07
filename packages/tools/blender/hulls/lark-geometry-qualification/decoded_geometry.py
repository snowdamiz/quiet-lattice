"""Adapter helpers for decoded glTF data; matrices use glTF column-major order."""
def world_position(position, node_world, decode=None):
    def apply(m, p):
        q = [sum(m[c*4+r]*p[c] for c in range(4)) for r in range(4)]
        if q[3] == 0:
            raise ValueError('Invalid homogeneous position')
        return [v/q[3] for v in q[:3]]
    p = list(position)
    if decode is not None:
        p = apply(decode, p+[1])
    return apply(node_world, p+[1])


def normalized_component(value, component_type):
    if component_type == 5120: return max(-1, value/127)
    if component_type == 5121: return value/255
    if component_type == 5122: return max(-1, value/32767)
    if component_type == 5123: return value/65535
    raise ValueError('Unsupported normalized accessor component type')
