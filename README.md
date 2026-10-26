# Next Horizon

*There is always another horizon.*

A No Man's Sky–style space exploration game built with three.js. Fly from a space
station down through the atmosphere of a procedurally generated planet, land, step out
in first person, mine resources, scan alien creatures, then fly back to orbit, trade at
the station and warp to another star system, or fly there yourself: the 70 systems sit at
their map positions, light years apart, and the whole trip is one continuous flight. There are
no loading screens anywhere in that loop.

**Gameplay video:** [docs/gameplay.mp4](docs/gameplay.mp4) (2 minutes, captured from the game's renderer at 1280×720,
HUD included). It is one continuous recording (a single dissolve trims the camera swinging back after the look at the
station): lift off a pad in the space station's busy hangar, fly out through the force field and glance back at the
station's ring, then boost for a planet 113 km in radius; dive into its atmosphere with the leading edges glowing
orange-hot, cut to the cockpit for a moment, drop through a gap in the cumulus in the morning light and land in a
woodland clearing beside an outpost; step out (the camera swings round the ship down to the pilot's eyes), walk up to
a herd of grazers and analyze one, run through the trees to mine a copper deposit (and a boulder, which completes the
first objective), scan to find the outpost, visit its terminal, walk back round to the ship and board, and climb out
past the clouds into space, ending on the ship leaving the planet's limb behind. The long walks, the boost, the cruise
and the empty sky are time-lapsed.

| | | |
|---|---|---|
| ![Inside the station hangar](docs/screenshots/opening.jpg) | ![Looking back at the station](docs/screenshots/station.jpg) | ![The half-lit planet](docs/screenshots/edge-of-space.jpg) |
| ![Re-entry](docs/screenshots/descent.jpg) | ![Cockpit](docs/screenshots/cockpit.jpg) | ![Landed in a woodland clearing](docs/screenshots/landing.jpg) |
| ![An alien grazer](docs/screenshots/creatures.jpg) | ![Mining a copper deposit](docs/screenshots/mining.jpg) | ![Outpost terminal](docs/screenshots/outpost.jpg) |
| ![Above the cloud deck](docs/screenshots/clouds.jpg) | ![Alien world](docs/screenshots/alien.jpg) | ![Leaving the planet behind](docs/screenshots/return.jpg) |

The HUD stays out of the way: a dot crosshair with heat and jetpack arcs on foot, a small reticle with speed and
altitude in the ship, and context prompts only when something can be done.

| | |
|---|---|
| ![HUD on foot](docs/screenshots/hud-foot.jpg) | ![HUD in flight](docs/screenshots/hud-ship.jpg) |

**Features video:** [docs/showcase.mp4](docs/showcase.mp4) (1 minute, same capture, one shot per feature joined by
dissolves). It covers:

- A storm world: in over a city through rain, with lightning striking the hills and the ship, and the superstorm
  warning.
- A city from the air, then on foot in its plaza: walk up to one of its people, a one-eyed Velven elder with a
  staff, and greet it.
- A flight between alien spires.
- An inferno world's lava plains, with the shields already gone and the hull burning down.
- The pulse drive pulling away from a planet, then 5.7 light years to the next star (time-lapsed) and the arrival.
- The galaxy map, zooming out from the local stars to the edge of space.

| | | |
|---|---|---|
| ![Lightning over a storm-world city](docs/screenshots/storm-city.jpg) | ![Greeting a Velven elder](docs/screenshots/citizens.jpg) | ![Between the spires](docs/screenshots/spires.jpg) |
| ![An inferno world's lava plains](docs/screenshots/inferno.jpg) | ![Leaving for the next star](docs/screenshots/departure.jpg) | |

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5173 and click **Begin Exploration** (or **Continue** if you have
a save). Click the game view to capture the mouse; press `Esc` to release it.

Production build: `npm run build` → `dist/`.

## Controls

| Starship | | On foot | |
|---|---|---|---|
| Mouse | Steer (pitch / yaw) | WASD | Move |
| W / S | Throttle up / down (it stays where you leave it; S held at zero fires the retros) | Shift | Sprint |
| A / D | Roll; strafe while hovering | Space | Jump, hold for jetpack |
| Space / C | Thrusters up / down (Space takes off when landed) | LMB | Mining beam |
| Shift | Boost | C | Scanner pulse |
| J | Pulse drive (in space) | E | Interact / analyze creature / trade |
| E | Land (low altitude) | F | Board ship |
| F | Exit ship when landed | | |
| LMB | Ship lasers (mine asteroids) | | |
| V | Chase / far chase / cockpit view | | |
| B (hold) | Look back past the ship | | |
| Wheel | Camera zoom | | |

`M` system & galaxy map · `H` controls · `` ` `` debug stats · `Esc` release mouse.

## Features

- **Two flight models, blended by the air**: in space the throttle holds a speed along the nose and
  the thrusters trim sideways drift away only so hard, so a fast turn slides. In an atmosphere the
  throttle is thrust and drag sets the top speed (higher as the air thins), gravity pulls, the wings
  lift and turn the ship with its nose once it is moving, and climbing costs speed while diving gains
  it. Below flying speed twelve manoeuvring thrusters take over: four VTOL jets under the fuselage and
  engine pods carry the weight, so the ship hovers, holds its position with the throttle closed,
  strafes on A / D, climbs and sinks on Space / C, and sets down on its gear wherever you lower it
  onto dry ground. Side, nose and dorsal jets fire for strafing and turning, in space too, each with a
  glowing throat and an exhaust cone that grows with its thrust.
- **A compass whose north is the edge of space**: a small ball at the top of the HUD, fixed to the
  galaxy, turns as you turn. Its equator is the galactic plane, its amber meridian and diamond mark the
  nearest way out of the universe, and the middle of its face is where you are looking, so facing the
  edge puts the diamond under the wings. Under it: your heading and inclination in the galaxy, and the
  distance to the edge.
- **Seamless planets** 80–125 km in radius, so a few kilometres up the horizon lies flat in the haze:
  cube-sphere quadtree LOD terrain (down to ~0.6 m vertex spacing) generated in Web Workers, with skirts, no-hole LOD swaps and horizon culling. The same
  deterministic height function drives rendering, collision, flora placement and landing.
- **Floating origin + frames of reference**: the camera always sits at the origin and every
  entity lives in the local, rotating frame of the nearest body (station, moon or planet),
  so you can land on a spinning, orbiting planet with millimetre precision while the
  system spans more than 60,000 km.
- **Atmospheres in post**: per-pixel Rayleigh/Mie scattering reconstructed from the
  logarithmic depth buffer, in a shell about a quarter of the planet's radius deep with a steep
  density falloff: a crisp limb from orbit, a sky that darkens gradually through navy to black
  on a climb, and aerial haze that melts the horizon a few kilometres out. With an approximate
  multiple-scattering term, sunsets and a day/night cycle from planetary rotation.
- **One universe, flyable end to end**: the systems of the galaxy map are where the map puts them,
  at full scale (a light year is 9.46×10¹⁵ m), with the spiral galaxy, its neighbours, the nearby
  nebulae and the edge of space round them. Out past a system's planets the pulse drive becomes an
  interstellar cruise whose top speed grows with the open space ahead (to about a million times light
  speed midway), so the nearest stars are some 30 minutes' flight away. Set a course on the galaxy map and
  steer by the star's marker. World coordinates stay exact anywhere: inside a system they are metres
  from its star; between the stars the origin rides along with the ship. The system you leave goes
  dormant (hidden, not updated); the next is built a planet or station section at a time, a few
  milliseconds a frame, while you approach, its shaders compiled in the background, then swapped in
  as you cross into it.
- **The sky is the real universe seen from where you are**: the galaxy's band from inside it (warmest
  toward the core, split by dark dust), its stars and disc from outside it, the other galaxies, the
  nebulae and the edge of space: from home a faint opalescent wall on one side of the sky, brighter and
  more detailed the closer you get to it. It is drawn into a cubemap from your exact position and redrawn
  (a face a frame, double-buffered) only once you have moved far enough for the nearest of it to shift.
  The cluster's stars and the field stars round them are drawn live, lit by their true distance, so
  they wheel past and brighten as you fly among them. The sun is a crisp disc with a tight corona and a fine starburst.
- **Per-pixel terrain shading**: ground colour is worked out in the fragment shader from
  height, slope, moisture, temperature and multi-scale noise, with saturation-capped
  palettes, snow caps, damp shorelines, rock on steep ground and triplanar detail.
- **Volumetric clouds** ray-marched through tiling 3D noise with eroded, billowing rims,
  two-lobe phase lighting, multiple-scattering octaves and sky occlusion, so the billows shade
  themselves and the bellies go grey (coarse-then-fine steps that shrink near the camera, so
  flying through a cloud is smooth fog, blue-noise jitter, mip-filtered noise). The nearby deck is marched at half resolution, accumulated over
  frames (reprojected in the planet's own frame, clamped to the current neighbourhood) and upsampled
  with depth-aware weights: smooth cloud edges and sharp terrain edges at a quarter of the cost. Seen from far above they hand over to a single shaded layer,
  and they cast shadows on the ground and sea. Thin, streaky cirrus drifts high above the deck, so the
  sky is never bare even where the cumulus has a gap. **Oceans** and **lava seas** are rendered
  analytically with waves, foam, depth tint and sun glint.
- **Fourteen planet archetypes**: lush, exotic, desert, frozen, toxic, volcanic, barren and gas
  giant; dead worlds (dried-up sea basins, petrified forests, nothing alive) and irradiated husks;
  and hostile worlds: infernos, storm worlds, corrosive worlds and crushing deeps. Ringed gas giants,
  moons, craters, terraces, dunes and glowing lava fissures.
- **Landforms**: each world has a character of its own: sheer-walled mesas with banded strata,
  canyonlands (fjords where they cut below the sea), great rifts, forests of stone pinnacles, long
  escarpments, giant volcanoes with lava calderas, or towering alpine ranges.
- **Hostile skies**: below a hostile world's hazard ceiling the ship takes damage that grows toward
  the ground (shield first, then a new hull gauge): searing heat that sets the hull glowing,
  crushing pressure (gas giants' depths too), acid, radiation, cryogenic cold, or superstorms with
  gales and lightning strikes (jagged, branching bolts you can see fall from the cloud deck, with the
  thunder arriving later the further off they hit). From orbit, a hostile world's haze keeps some
  of the tint it has from below. A warning shows before it bites; the hull holds out longer with
  Thermal Plating, a Pressure Hull or Hazard Coating from the shop, and a lost ship is rebuilt at the
  station at a price. On foot, protection lasts seconds there.
- **Cities**: some worlds are home to a civilisation with an architecture of its own (spires, domes,
  ziggurats, organic towers or crystal shards, in its own colours): vast cities on levelled plains,
  paved streets and plazas, hundreds of buildings with windows lit at night, a landmark tower, a
  trade post, air traffic, and from orbit their lights. Their people are a species unique to the
  world (body plan, head, arms, colours, dress, voice and language), walking the streets around you;
  greet them for a word in their tongue.
- **Flora** modeled in Blender: a library of trees, palms, conifers, alien bulbs and spirals,
  mushrooms, coral, cacti, bushes, ferns, grass, boulders, crystals, resource plants and ore
  deposits (78 meshes with baked occlusion). Colour-region masks let every planet recolour
  them from its own palette, and each world gets one landmark: groves of giant alien growths
  that read from far off. Each tree kind (two different models apiece) keeps to its own stretches of land, rocks gather in
  outcrops and resource plants grow in patches rather than an even sprinkle. Plants are scattered per cell in workers, instanced with two
  LODs, with wind sway and night-time bioluminescence. Tree crowns and shrubs are shingled with
  small leaves that shade with the crown's own normal, so they read as leafy volumes with ruffled
  outlines rather than smooth blobs, and a shrub you walk into fades out instead of filling the view.
  Trees lean a little at random, palms most of all, so a grove of one model does not stand to attention. Beyond ~400 m, forests and shrubs carry on
  to the horizon as point sprites placed on the terrain vertices from the same forest-cover
  field, so they line up with the real trees nearby.
- **Alien fauna** modeled in Blender: lantern-necked and hammer-headed grazers, shell-backed
  rams, big-mouthed brutes, one-eyed puffballs, pincer scuttlers, frilled bipeds, dragon-moths
  and more, two designs per body plan, rigged with per-vertex limb weights and animated in the
  vertex shader (diagonal-pair walk cycles with planted feet, head nods, tail sway, idle
  grazing). Each species gets its own patterned hide and size. They wander, graze, flock and
  flee; analyze new species for rewards.
- **Weather**: rain, snowstorms, ash with embers, spore clouds, dust storms.
- **Points of interest** on every planet: Blender-modeled outposts with habitat domes,
  terminals and landing pads, ancient monoliths with lore, smoking starship wrecks and signal
  beacons. Sites are planned with the planet and the terrain is levelled under each one, so
  buildings sit flat on the ground. Find them with the scanner, then claim units, salvage and
  warp cells.
- **Pirate raids** in open space round the planets: dogfight with ship lasers, salvage loot from wrecks, or get
  towed home.
- **Cockpit view**: a modeled cockpit with live instrument screens (speed and altitude,
  radar, shields), and a flight stick and throttle that move with your input.
- **Minimal HUD**: gauges live on the crosshair and reticle, vitals appear only when they
  drop, and the location line and objective fade back once read.
- Cinematic post: bloom, ACES tonemapping, depth-occluded lens flare, chromatic aberration
  during pulse travel, vignette and film grain.
- **Space station** with a rotating ring, NPC traffic, an auto-docking hangar dressed with
  rows of shipping containers, crates, fuel tanks, catwalks, pipe runs, painted bay markings and warm
  pools of light on the floor, a walkable trade
  deck, a trade terminal and an outfitting shop.
- **Starship** modeled in Blender (central hull and canopy, twin engine nacelles, landing gear, about 62k
  triangles), as is the first-person **multitool** with its gloved hand. A chase camera that swings
  into turns, keeps the horizon steadier than the ship, buffets at speed, pulls in clear of
  walls and parked ships and looks back on demand. Getting into or out of the seat, out of the ship
  or back aboard, the camera glides along an arc in one continuous move, over the hull and down
  through the canopy glass between its frame bars; a plasma sheath with flame streaks peeling off the hull when diving into an
  atmosphere, with the hull's leading faces glowing orange-hot, and a soft contact shadow once
  landed. You can walk right up to the landed ship but not into it. Arcade flight with flight assist, terrain avoidance,
  auto landing and takeoff, landing gear, exhaust trails, pulse drive with supercruise-style
  slowdown near bodies, and asteroid mining lasers.
- **Survival & economy**: life support, hazard protection, jetpack, mining heat, resources,
  units, upgrades, warp cells and hyperdrive jumps between 70 procedurally generated
  star systems.
- **Sound and music**: recorded effects and ambiences, all openly licensed (see Credits).
  - Loops follow the game: the engine hum and the roar under thrust, air rushing past by speed and
    density, the VTOL jets, the pulse drive, the jetpack and the mining beam, plus wind, gales, rain,
    the station's hangar and deep space.
  - Effects come in several takes, picked at random and slightly detuned: footsteps per surface, RCS
    puffs, lasers, impacts, thunder near and far.
  - Music is five ambient tracks by Scott Buckley: one for the title screen, two for space and two
    for planets, with long quiet stretches between them.
  - Creatures' calls stay synthesized per species, and any sound without a recording falls back to
    the synthesizer.
- Adaptive resolution and autosave to localStorage.

## Project layout

```
src/
  Game.js               orchestration, frames, lighting, interactions
  core/                 renderer + post chain, input
  render/               atmosphere/ocean/cloud pass, sky, terrain & panel materials, weather
  terrain/              planet recipes, height sampler, quadtree LOD, chunk worker
  universe/             bodies, star, planets, solar system, station, asteroids, galaxy
  entities/             ship, player, multitool, NPC traffic
  gameplay/             flora, fauna, points of interest, model library, inventory, save
  ui/                   HUD, menus, map, styles
  audio/                sample bank, music player, synthesized fallbacks
blender/                build scripts for the ship, multitool, flora, creatures and structures
public/models/          exported .glb models
public/audio/           sounds and music (manifest.json maps them to the game's sounds; CREDITS.md)
```

### Rebuilding the models

Every model is generated by a Python script run in headless Blender, for example:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -P blender/build_ship.py -- "$PWD/public/models/ship.glb"
```

The other scripts work the same way: `build_multitool.py`, `build_flora.py`,
`build_creatures.py` and `build_structures.py` write `multitool.glb`, `flora.glb`,
`creatures.glb` and `structures.glb`. If a library fails to load, the game falls back to its
procedural models.

### Recording

In dev builds `window.dev` has helpers for scripted captures: `dev.boot()` starts a silent
new game, `dev.record()` stops the frame loop and renders fixed 1280×720 frames on
`dev.tick()`, posting them as JPEGs to a local frame server on port 5199, and
`dev.key / mouse / shipAim / footAim` drive the game with synthetic input. The DOM HUD is drawn into each
frame (`src/dev/hudCapture.js` rasterises a copy of it with its animations held at the recording's clock),
and `(await import('/src/dev/take.js')).install()` adds the autopilot helpers the gameplay video was scripted
with (walking round obstacles, the gliding descent, the landing). `(await import('/src/dev/showcase.js')).install()`
adds the features video's helpers on `window.show`: jump to a world, set the hour for a spot, place the ship with a
heading and speed, find rugged ground, caption a shot, cruise headless toward a star, and record while the terrain
workers keep up.

### Dev scenarios

Append a hash to the URL to jump straight into a situation, for example `#foot`, `#fly`,
`#land`, `#station`, `#dock` or `#space`. `#fly:3` targets planet index 3.

**Teleporter (F2, dev builds):** every system, planet and moon, with a live 3D preview of the planet
(drag to turn, scroll to zoom); go there hovering above it in the ship, standing on the ground, or into
one of its cities.

**Playthrough check:** the core loop played through the game's own controls (synthetic keys and mouse,
no teleports). In the browser console:

```js
const pt = (await import('/src/dev/playthrough.js')).playthrough();
for (const step of ['leave', 'descend', 'land', 'disembark', 'mine', 'analyze', 'board', 'climb', 'dock']) console.log(await pt[step]());
```

## Credits

**Music:** "Hymn to the Dawn", "The Spaces Between", "Machina", "Golden Hour" and "Solace" by
Scott Buckley ([www.scottbuckley.com.au](https://www.scottbuckley.com.au)), released under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

**Sound effects** under CC BY 3.0 / 4.0, by:
- AntumDeluge
- Berklee College of Music synthesis students (via OLPC, posted by bart)
- Gregor Quendel
- InspectorJ (www.jshaw.co.uk)
- JC Sounds
- Jerimee
- Lamoot / Blender Foundation (Yo Frankie!)
- Little Robot Sound Factory (www.littlerobotsoundfactory.com)
- Matucha
- Work With Sounds (workwithsounds.eu): La Fonderie, Museum of Municipal Engineering, Technical Museum
  of Slovenia, Torsten Nilsson, Werstas
- congusbongus (after Eelke)
- dklon
- mikhog (after Michel Baradari)
- qubodup

The rest are CC0 or public domain, from Kenney, OpenGameArt contributors, NASA and others. Every
file's source, author, license and the edits made to it are listed in
[public/audio/CREDITS.md](public/audio/CREDITS.md). The same credits are on the title screen,
under Credits.
