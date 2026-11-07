"""P1.E07.T14 art direction and consumption contract; no gameplay implementation."""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SOURCES = ROOT / 'assets/blend/effects'
PUBLIC = ROOT / 'packages/client/public'
PALETTES = {
    'gravitic': {'owner': 'Ixari', 'primary': '#7A4FD0', 'light': '#B9A6FF', 'rhythm': 'paired compression crescents; inward cadence'},
    'thermal': {'owner': 'Free Reaches', 'primary': '#8E2F23', 'light': '#FF6A3D', 'rhythm': 'split tapered tongues; sharp attack and ember decay'},
    'resonance': {'owner': 'Chorus of the Count', 'primary': '#2B2A5C', 'light': '#E8C66A', 'rhythm': 'open concentric wave combs; measured repeating beats'},
    'symbiotic': {'owner': 'Ulgani', 'primary': '#D9962B', 'light': '#C7F06A', 'rhythm': 'bifurcating tendrils and gilled caps; unfurl and drift'},
    'void': {'owner': 'Free Reaches', 'primary': '#3A3D42', 'light': '#D8B23A', 'rhythm': 'offset severed planes with dark centres; abrupt absence'},
    'pilot': {'owner': 'Waystation Compact', 'primary': '#22406A', 'light': '#FFFFFF', 'rhythm': 'existing propulsion and shield feedback only; no Tier I-II active'},
    'exosuit': {'owner': 'Ulgani', 'primary': '#F2EAD3', 'light': '#59F2C1', 'rhythm': 'existing jetpack, scanner and mining feedback only; no Tier I-II active'},
    'recall': {'owner': 'Cartographers', 'primary': '#7FD8FF', 'light': '#D8F6FF', 'rhythm': 'upright exact signs, upward dissolution, single hard flash'},
}

# Each entry: silhouette, suggested visual envelope in seconds, particle cap, spatial placement.
# These envelopes describe art timing only. Server-authoritative lifetime wins at integration.
BEATS = {
 'gravitic': {
  'pull': ('three converging lens rails', .45, 12, 'unit beam along Blender +Y / glTF -Z; stretch to target, at most 25 m'),
  'tractor_beam': ('nested tractor jaws and helical cable', 3, 20, 'unit beam along -Z; stretch to target; range owned by ability'),
  'slam': ('six staggered pressure wedges', .7, 32, 'unit radius ground ring; scale radius 6-18 m'),
  'well': ('open latitude cage with compressed poles', 8, 32, 'unit radius sphere; scale radius 12 m'),
  'inertial_brake': ('opposing swept brake vanes', .6, 16, 'hull-centred unit radius; fit hull bounds; gust immunity is gameplay'),
 },
 'thermal': {
  'lance': ('braided tapered plasma spear', .25, 12, 'unit beam along -Z; stretch to target, at most 30 m'),
  'flare': ('five divergent flame tongues', .5, 32, 'unit length 60-degree cone along -Z; scale length 12 m'),
  'sear': ('four hooked branding tongues', 8, 16, 'target-centred; fit target bounds, no lore glyph'),
  'vent': ('broken low radial flame crown', .8, 32, 'unit radius ground wave; size from heat at playback'),
 },
 'resonance': {
  'pulse': ('three spaced wave combs', .9, 24, 'unit radius ground wave; scale radius 15 m'),
  'deep_sweep': ('descending broad scan fan', 1.2, 24, 'ship origin; aim cone toward world; scale from scanner'),
  'harmonic': ('interleaved tuning forks', 1.4, 16, 'target-centred; fit creature bounds within 30 m'),
  'shatter': ('radial prismatic pressure splinters', .4, 24, 'target-centred unit radius impact'),
  'veil': ('open offset interference curtains', 15, 12, 'body-centred 1.85 m envelope; sparse shimmer, never an opaque shell'),
  'jammer': ('crossed broken wave bars', .6, 16, 'target hull bounds; discrete pulse interruption, not a 2 km mesh'),
 },
 'symbiotic': {
  'bond': ('two interlocking root loops', 1.5, 16, 'target-centred unit radius; fit creature bounds'),
  'repair_drones': ('three gilled open chitin motes', 20, 12, 'ship-centred unit radius; fit hull bounds; motes are visual only'),
  'regrow': ('ascending bifurcated fronds', 6, 20, 'body-centred 1.85 m envelope'),
  'spore': ('low gilled cap canopy', 10, 32, 'unit radius volume; scale radius 8 m; preserve sparse interior'),
  'call': ('three forward root chevrons', .9, 20, 'aim point ground marker; unit radius; herd is a separate actor'),
 },
 'void': {
  'phase': ('split folded doorway scar', .35, 16, 'body-centred 1.85 m departure and arrival; no connecting 12 m trail'),
  'micro_jump': ('severed swept hull aperture', .3, 20, 'departure and arrival at hull bounds; never a 2 km mesh'),
  'drain': ('paired discontinuous siphon ribbons', 4, 20, 'unit beam along -Z; stretch between target and caster'),
  'rift': ('three offset inward spiral cuts', 3, 32, 'unit radius ground aperture; scale radius 10 m'),
  'eclipse': ('dark negative-space broken dome', 8, 24, 'unit radius dome; scale radius 10 m; occlusion shader belongs to playback'),
  'cloak': ('thin discontinuous hull seams', 20, 12, 'hull-centred unit radius; fit hull bounds; visibility owned by playback'),
  'blink_strike': ('crossing shear blades', .2, 12, 'target-centred unit radius impact, paired with Phase'),
 },
 'recall': {
  'dissolve': ('rising lattice fragments in a body envelope', .65, 48, '1.85 m tall body-centred scatter; body masking belongs to Recall'),
  'flash': ('six short radial rays with a faceted lens', .12, 12, 'unit radius; local hard flash, not a full-screen white card'),
 },
}

REUSE = {
 'gravitic.pull_many': ('gravitic_pull', 3, 'Same Pull cue on up to three targets; one shared particle batch.'),
 'thermal.chain': ('thermal_lance', 2, 'Second Lance link to the chained target; at most two links.'),
 'resonance.echo': ('resonance_pulse', 1, 'Replay Pulse after 2 seconds; do not overlap both envelopes.'),
 'symbiotic.big_game': ('symbiotic_bond', 1, 'Same Bond cue fitted to the heavy quadruped or flyer bounds.'),
}
NO_NEW = {
 'gravitic.mass_sense': 'Scanner reveal/outline belongs to scanner UI; no independent world-space cast.',
 'resonance.long_ear': 'Extends scanner range and map beacons; uses existing scanner presentation.',
 'resonance.choir': 'Shares the existing Pulse reveal/stun; no additional cast or aura.',
 'void.edge_sense': 'Hollow outline and Count HUD are separate UI tasks; no activation beat.',
 'thermal.focused_lasers': 'Damage/range upgrade to existing ship lasers; no new firing shape required.',
 'thermal.ablative_plating': 'Passive hazard multiplier despite ship type; no activation beat.',
 'symbiotic.symbiont_hull': 'Passive shield capacity/regen modifiers; existing shield feedback only.',
}

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def nodes():
    result = []
    for branch in PALETTES.keys() - {'recall'}:
        path = ROOT / 'packages/shared/src/data/skills' / f'{branch}.ts'
        # Bound each record at the next id so an omitted field cannot borrow from the next node.
        blocks = re.split(r"\bid: '([^']+)'", path.read_text())
        for ident, body in zip(blocks[1::2], blocks[2::2]):
            tier = re.search(r'\btier: ([12]),', body)
            if not tier:
                continue
            name = re.search(r"\bname: '([^']+)'", body).group(1)
            kind = re.search(r"\btype: '([^']+)'", body).group(1)
            key = f'{branch}.{ident}'
            row = dict(id=key, name=name, tier=int(tier[1]), type=kind, palette=branch)
            if ident in BEATS.get(branch, {}):
                row.update(disposition='asset', assets=[f'{branch}_{ident}'], meshInstances=2 if ident in ('phase','micro_jump') else 1)
            elif key in REUSE:
                asset, count, why = REUSE[key]
                row.update(disposition='reuse', assets=[asset], meshInstances=count, reason=why)
            else:
                why = NO_NEW.get(key, 'Always-on stat or eligibility modifier; existing movement/equipment feedback suffices, no separate visible beat.')
                if kind not in ('passive',) and key not in NO_NEW:
                    raise ValueError(f'Unmapped visible node: {key}')
                row.update(disposition='existing_feedback', assets=[], meshInstances=0, reason=why)
            result.append(row)
    return sorted(result, key=lambda r: r['id'])

def signs():
    text = (ROOT / 'packages/shared/src/art/glyphs.ts').read_text()
    return [(letter, re.findall(r"'([SR][0-5])'", strokes)) for letter, strokes in re.findall(r"letter: '([^']+)', strokes: \[([^\]]*)\]", text)]
