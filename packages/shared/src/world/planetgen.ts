// Planet recipes + deterministic terrain sampler. Used by the chunk workers and the main thread (collision, flora
// placement), and by the server, which never streams terrain: every machine regenerates it from the seeds, with the
// deterministic math of ../math/det.ts, so it comes out the same on every engine.
import { acos, cos, pow, sin } from '../math/det.ts';
import { Simplex3, smoothstep, lerp, clamp } from './noise.ts';
import { Random } from './rng.ts';
import type { CapitalSpec } from './cities.ts';

/** A linear RGB colour (sRGB hex colours are converted on the way in). */
export type Rgb = [number, number, number];
/** Anything a function can write three or four numbers into: a plain array or a typed array. */
export type NumArray = number[] | Float32Array | Float64Array;

// ---------- color helpers (no three.js, so the workers stay light) ----------
function hexToRgb(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
function rgbToHsl([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]: Rgb): Rgb {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}
function shiftColor(hex: number, dh: number, ds = 0, dl = 0, maxL = 0.8, maxS = 1): Rgb {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl[0] = (hsl[0] + dh + 1) % 1;
  // saturation cap keeps ground palettes earthy instead of neon
  hsl[1] = clamp(hsl[1] + ds, 0, maxS);
  // cap lightness so snow / sand do not blow out under strong sunlight
  hsl[2] = clamp(hsl[2] + dl, 0, maxL);
  return hslToRgb(hsl).map(srgbToLinear) as Rgb;
}
export function linearToHex([r, g, b]: Rgb): number {
  const f = (c: number) => Math.round(clamp(c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055, 0, 1) * 255);
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

// ---------- planet archetypes ----------
export type ColorKey = 'deep' | 'floor' | 'beach' | 'low1' | 'low2' | 'dry' | 'high' | 'rock1' | 'rock2' | 'snow';
export type HazardKind = 'radiation' | 'heat' | 'storm' | 'acid' | 'pressure' | 'cryo';
/** A ship hazard: damage per second below `ceiling` metres, rising toward the ground (by `curve`, if set). */
export interface Hazard {
  kind: HazardKind;
  label: string;
  ceiling: number;
  dps: number;
  curve?: number;
}

/** The air of a mild world (the Ulgani's toxic home, DESIGN 5.1): breathable below the mist line, caustic above it, and
 * never a hazard to a ship. */
export interface Mist {
  /** the mist line, metres above sea level */
  line: number;
  /** how far above the line the air turns fully caustic (m) */
  band: number;
  /** the on-foot hazard rate in fully caustic air, on the scale of a world's harshness (a toxic world's: 1.2) */
  rate: number;
}

/** What a mild world's air does at `altitude` metres above sea level: no hazard at or below the mist line, rising
 * smoothly to `mist.rate` across its band; never a ship hazard. Pure, for the client and the server alike. */
export function mistHazard(mist: Mist, altitude: number): { foot: number; ship: null } {
  return { foot: mist.rate * smoothstep(mist.line, mist.line + mist.band, altitude), ship: null };
}
export type TreeKind = 'round' | 'conifer' | 'palm' | 'mushroom' | 'spiral' | 'coral' | 'blob' | 'cactus' | 'crystal';

/** What every world of one kind has in common. Colours are sRGB hex; they get hue-jittered per seed and converted to linear. */
export interface Archetype {
  label: string;
  /** typical fraction of the surface under the sea (0: never a sea) */
  ocean: number;
  colors: Record<ColorKey, number>;
  water: { shallow: number; deep: number; emissive: number };
  /** rayleigh coefficients (relative); null: no air */
  sky: Rgb | null;
  atmo: number;
  clouds: number;
  hueJitter: number;
  flora: number;
  floraColors: number[];
  trunk: number;
  treeKinds: TreeKind[];
  snowLine: number;
  weather: string[];
  sunTint?: Rgb;
  skyTint?: Rgb;
  overcast?: boolean;
  lava?: boolean;
  craters?: boolean;
  dryBasins?: boolean;
  lifeless?: boolean;
  hazard?: Hazard;
}

const ARCHETYPES = {
  lush: {
    label: 'Lush',
    ocean: 0.55,
    // prettier-ignore
    colors: {
      deep: 0x0b2b4a, floor: 0x3b6f6a, beach: 0xd8c48f, low1: 0x5e843f, low2: 0x3a6433, dry: 0x8f8a50,
      high: 0x6b7f3c, rock1: 0x6e665c, rock2: 0x4d4741, snow: 0xf2f6fa,
    },
    water: { shallow: 0x247f88, deep: 0x06304f, emissive: 0 },
    sky: [5.5, 13.0, 22.4], // rayleigh coefficients (relative)
    atmo: 1.0,
    clouds: 0.5,
    hueJitter: 0.05,
    flora: 1.0,
    floraColors: [0x3f8c3e, 0x78a646, 0x2d7a46, 0xd8e05a, 0xe0603f],
    trunk: 0x5a3f2c,
    // earthlike woods (the smooth balloon and gourd trees belong to the alien worlds)
    treeKinds: ['round', 'conifer', 'palm'],
    snowLine: 1.35,
    weather: ['Mild', 'Pleasant', 'Balmy', 'Light Rain'],
  },
  alien: {
    label: 'Exotic',
    ocean: 0.45,
    // prettier-ignore
    colors: {
      deep: 0x1c1440, floor: 0x4a3a6a, beach: 0xb8a0a8, low1: 0x8a4a8a, low2: 0x5a3a7a, dry: 0xa0687a,
      high: 0x6a5a7a, rock1: 0x5a5060, rock2: 0x3a3442, snow: 0xe4e0ec,
    },
    water: { shallow: 0x2a7088, deep: 0x0a1838, emissive: 0 },
    sky: [8.5, 6.5, 16.0],
    atmo: 0.95,
    clouds: 0.45,
    hueJitter: 0.25,
    flora: 1.1,
    floraColors: [0xff4fd0, 0x4fe0ff, 0xb05aff, 0xffe04f, 0x5aff8f],
    trunk: 0x3a2a5a,
    treeKinds: ['mushroom', 'spiral', 'coral', 'blob'],
    snowLine: 0.85,
    weather: ['Humid', 'Spore Storms', 'Electric Mist', 'Calm'],
  },
  desert: {
    label: 'Desert',
    ocean: 0.12,
    // prettier-ignore
    colors: {
      deep: 0x123448, floor: 0x8a6a40, beach: 0xe8c890, low1: 0xd8a060, low2: 0xc07a40, dry: 0xe0b878,
      high: 0xa05a32, rock1: 0x8a4a2a, rock2: 0x5a3020, snow: 0xf0e0c8,
    },
    water: { shallow: 0x40b0a0, deep: 0x0a3040, emissive: 0 },
    sky: [6.0, 9.0, 16.0],
    atmo: 0.75,
    clouds: 0.15,
    hueJitter: 0.04,
    flora: 0.25,
    floraColors: [0x8aa040, 0xd0b040, 0xc05a3a, 0x60a070],
    trunk: 0x6a4a2a,
    treeKinds: ['cactus', 'palm', 'spiral'],
    snowLine: 2.0,
    weather: ['Scorching', 'Dust Storms', 'Arid', 'Searing Winds'],
    sunTint: [1.0, 0.86, 0.7],
  },
  frozen: {
    label: 'Frozen',
    ocean: 0.35,
    // prettier-ignore
    colors: {
      deep: 0x1a3a5a, floor: 0x6a8aa8, beach: 0xd8e4f0, low1: 0xe8f0f8, low2: 0xc8d8e8, dry: 0xb0c4d8,
      high: 0xf4f8ff, rock1: 0x5a6878, rock2: 0x3a4450, snow: 0xffffff,
    },
    water: { shallow: 0x9ad8f0, deep: 0x1a4a70, emissive: 0 },
    sky: [4.0, 10.0, 26.0],
    atmo: 0.9,
    clouds: 0.6,
    hueJitter: 0.03,
    flora: 0.3,
    floraColors: [0x7ad0f0, 0xa0f0ff, 0xd0d8ff, 0x60a0c0],
    trunk: 0x4a5a6a,
    treeKinds: ['conifer', 'crystal', 'spiral'],
    snowLine: -0.2,
    weather: ['Freezing', 'Blizzards', 'Icy Winds', 'Frost'],
  },
  toxic: {
    label: 'Toxic',
    ocean: 0.4,
    // prettier-ignore
    colors: {
      deep: 0x1a3010, floor: 0x5a7a20, beach: 0xb8c060, low1: 0x8ab030, low2: 0x5a8a20, dry: 0xc0c040,
      high: 0x6a7a30, rock1: 0x4a4a30, rock2: 0x30301a, snow: 0xe0f0a0,
    },
    water: { shallow: 0x90e020, deep: 0x204a08, emissive: 0.15 },
    sky: [10.0, 16.0, 5.0],
    atmo: 1.2,
    clouds: 0.55,
    hueJitter: 0.06,
    flora: 0.8,
    floraColors: [0xc0ff40, 0xffa020, 0x60ff80, 0xff4060],
    trunk: 0x4a3a1a,
    treeKinds: ['mushroom', 'blob', 'coral'],
    snowLine: 1.5,
    weather: ['Acid Rain', 'Caustic Fog', 'Toxic Clouds', 'Noxious'],
  },
  volcanic: {
    label: 'Volcanic',
    ocean: 0.3,
    // prettier-ignore
    colors: {
      deep: 0x200800, floor: 0x3a1a10, beach: 0x2a2220, low1: 0x3a3230, low2: 0x2a2020, dry: 0x4a3a30,
      high: 0x5a4a40, rock1: 0x2a2424, rock2: 0x161212, snow: 0x8a7a70,
    },
    water: { shallow: 0xffa020, deep: 0xc02000, emissive: 1.0 }, // lava seas
    sky: [16.0, 9.0, 6.0],
    atmo: 0.9,
    clouds: 0.25,
    hueJitter: 0.02,
    flora: 0.12,
    floraColors: [0xff6020, 0xffc040, 0x802010],
    trunk: 0x201010,
    treeKinds: ['crystal', 'cactus'],
    snowLine: 2.0,
    weather: ['Firestorms', 'Ash Fall', 'Superheated', 'Volatile'],
    lava: true,
  },
  barren: {
    label: 'Barren',
    ocean: 0,
    // prettier-ignore
    colors: {
      deep: 0x303030, floor: 0x404040, beach: 0x8a8580, low1: 0x8a8580, low2: 0x6a6560, dry: 0x9a9088,
      high: 0xa8a098, rock1: 0x5a5550, rock2: 0x3a3836, snow: 0xc8c4c0,
    },
    water: { shallow: 0x000000, deep: 0x000000, emissive: 0 },
    sky: null,
    atmo: 0,
    clouds: 0,
    hueJitter: 0.08,
    flora: 0.0,
    floraColors: [0x9a9088],
    trunk: 0x404040,
    treeKinds: ['crystal'],
    snowLine: 3.0,
    weather: ['Airless', 'Vacuum', 'Silent'],
    craters: true,
  },
  // a world that once lived: dried-up sea basins, petrified forests, a thin dusty sky, nothing alive
  dead: {
    label: 'Dead',
    ocean: 0,
    // prettier-ignore
    colors: {
      deep: 0x3a3632, floor: 0x5a544c, beach: 0xb4ab9a, low1: 0x6e665a, low2: 0x524c44, dry: 0x8c8274,
      high: 0x7a7266, rock1: 0x4a4440, rock2: 0x2e2a28, snow: 0xd6d2c8,
    },
    water: { shallow: 0x000000, deep: 0x000000, emissive: 0 },
    sky: [9.0, 8.4, 7.4],
    atmo: 0.35,
    clouds: 0.04,
    hueJitter: 0.04,
    flora: 0.22,
    floraColors: [0x6a645c, 0x8a8278, 0x4a4640, 0x5c5248],
    trunk: 0x3a3632,
    treeKinds: ['conifer', 'spiral'],
    snowLine: 2.2,
    weather: ['Dust Devils', 'Ashen Winds', 'Lifeless', 'Still'],
    dryBasins: true,
    lifeless: true,
  },
  // dead and still burning with it: glowing growths of crystal, a sickly sky, radiation everywhere
  irradiated: {
    label: 'Irradiated',
    ocean: 0,
    // prettier-ignore
    colors: {
      deep: 0x2a2a14, floor: 0x3a3a1a, beach: 0x8a8a4a, low1: 0x6a6a3a, low2: 0x4c4a2a, dry: 0x8a8448,
      high: 0x7a7448, rock1: 0x4a4630, rock2: 0x2a281a, snow: 0xc8d070,
    },
    water: { shallow: 0x000000, deep: 0x000000, emissive: 0 },
    sky: [7.0, 10.5, 3.0],
    atmo: 0.45,
    clouds: 0.08,
    hueJitter: 0.05,
    flora: 0.16,
    floraColors: [0xa0ff40, 0x60ff80, 0xd8ff60],
    trunk: 0x2a3a1a,
    treeKinds: ['crystal'],
    snowLine: 2.5,
    weather: ['Radiation Storms', 'Gamma Flux', 'Irradiated'],
    craters: true,
    dryBasins: true,
    lifeless: true,
    hazard: { kind: 'radiation', label: 'Lethal radiation', ceiling: 6000, dps: 2.2 },
  },
  // a runaway greenhouse: a thick, glowing orange sky over lava lakes; ships cook on the way down
  inferno: {
    label: 'Inferno',
    ocean: 0.2,
    // prettier-ignore
    colors: {
      deep: 0x2a0c04, floor: 0x4a1c0c, beach: 0x3a2418, low1: 0x6a3a22, low2: 0x4a2a1a, dry: 0x8a5a32,
      high: 0x5a3a28, rock1: 0x3a2218, rock2: 0x221410, snow: 0x9a6a40,
    },
    water: { shallow: 0xffb030, deep: 0xd03000, emissive: 1.0 },
    sky: [24.0, 9.5, 2.6],
    atmo: 2.4,
    clouds: 0.85,
    hueJitter: 0.03,
    flora: 0,
    floraColors: [0x3a2a1a],
    trunk: 0x201010,
    treeKinds: ['crystal'],
    snowLine: 9.0,
    weather: ['Hellish', 'Searing Clouds', 'Molten Rain', 'Crushing Heat'],
    sunTint: [1.0, 0.75, 0.45],
    skyTint: [1.0, 0.72, 0.5],
    lava: true,
    lifeless: true,
    hazard: { kind: 'heat', label: 'Extreme heat', ceiling: 14000, dps: 9 },
  },
  // never-ending hypercanes: black cloud decks, lightning, winds that throw a ship about
  storm: {
    label: 'Storm',
    ocean: 0.5,
    // prettier-ignore
    colors: {
      deep: 0x0a1a2a, floor: 0x2a3a40, beach: 0x8a8a7a, low1: 0x3a5a4a, low2: 0x2a4a3e, dry: 0x6a6a52,
      high: 0x4a5a4a, rock1: 0x4a4a4a, rock2: 0x2e3030, snow: 0xdde4ea,
    },
    water: { shallow: 0x2a5a6a, deep: 0x082030, emissive: 0 },
    sky: [9.0, 10.5, 12.5],
    atmo: 2.0,
    clouds: 0.95,
    sunTint: [0.55, 0.6, 0.7],
    // the light that reaches the air under the storm deck: a dim, steely gloom
    skyTint: [0.32, 0.36, 0.44],
    overcast: true,
    hueJitter: 0.05,
    flora: 0.5,
    floraColors: [0x2a6a4a, 0x4a7a3a, 0x6a6a3a],
    trunk: 0x3a2e24,
    treeKinds: ['conifer', 'round'],
    snowLine: 1.4,
    weather: ['Hypercanes', 'Lightning Storms', 'Gale Force', 'Tempest'],
    hazard: { kind: 'storm', label: 'Superstorm', ceiling: 9000, dps: 2.5 },
  },
  // seas and rain of acid: hulls corrode below the cloud deck
  corrosive: {
    label: 'Corrosive',
    ocean: 0.45,
    // prettier-ignore
    colors: {
      deep: 0x203008, floor: 0x4a5a10, beach: 0xb0b040, low1: 0x7a8a20, low2: 0x5a6a18, dry: 0xa0a030,
      high: 0x6a6a28, rock1: 0x4a4a28, rock2: 0x2a2a18, snow: 0xd0e060,
    },
    water: { shallow: 0xc0f020, deep: 0x3a6a08, emissive: 0.35 },
    sky: [12.0, 16.0, 4.0],
    atmo: 1.6,
    clouds: 0.75,
    hueJitter: 0.05,
    flora: 0.2,
    floraColors: [0xe0ff40, 0xa0c020, 0xffd040],
    trunk: 0x3a3a10,
    treeKinds: ['mushroom', 'blob'],
    snowLine: 1.6,
    weather: ['Acid Storms', 'Corrosive Fog', 'Caustic Downpour'],
    lifeless: true,
    hazard: { kind: 'acid', label: 'Corrosive atmosphere', ceiling: 7000, dps: 4.5 },
  },
  // an ocean of air: a deep violet murk that grows denser all the way down, until it crushes
  crushing: {
    label: 'Crushing',
    ocean: 0.3,
    // prettier-ignore
    colors: {
      deep: 0x0a0618, floor: 0x1a1428, beach: 0x4a4058, low1: 0x3a3048, low2: 0x2a2238, dry: 0x4a3a52,
      high: 0x5a4a62, rock1: 0x2a2232, rock2: 0x16121c, snow: 0x8a80a0,
    },
    water: { shallow: 0x3a2a6a, deep: 0x0a0620, emissive: 0 },
    sky: [6.0, 4.0, 14.0],
    atmo: 3.0,
    clouds: 0.6,
    hueJitter: 0.06,
    flora: 0.15,
    floraColors: [0x8a6aff, 0x5a3aa0, 0xc0a0ff],
    trunk: 0x2a1a3a,
    treeKinds: ['crystal', 'spiral'],
    snowLine: 2.0,
    weather: ['Crushing', 'Dense Murk', 'Abyssal'],
    sunTint: [0.6, 0.48, 0.8],
    skyTint: [0.5, 0.42, 0.68],
    lifeless: true,
    hazard: { kind: 'pressure', label: 'Crushing pressure', ceiling: 11000, dps: 14, curve: 2 },
  },
} satisfies Record<string, Archetype>;

/** A rocky world's kind (gas giants are described by the solar system, not here). */
export type PlanetType = keyof typeof ARCHETYPES;

export type ReliefStyle = 'rolling' | 'alpine' | 'highlands' | 'mesa' | 'spires' | 'canyon' | 'badlands' | 'rift' | 'volcanoes';

// Landform styles, weighted per archetype: on top of continents, ranges and hills, each world
// gets one character: sheer-walled plateaus, canyonlands, deep rifts, forests of stone pinnacles,
// long escarpments, giant volcanoes, or towering alpine ranges.
// prettier-ignore
const RELIEF_STYLES: Record<PlanetType, [ReliefStyle, number][]> = {
  lush: [['rolling', 2], ['alpine', 2], ['highlands', 2], ['mesa', 1], ['spires', 0.7], ['canyon', 1]],
  alien: [['spires', 3], ['mesa', 1.5], ['alpine', 1], ['canyon', 1]],
  desert: [['mesa', 3], ['canyon', 2.5], ['badlands', 2], ['rolling', 1]],
  frozen: [['alpine', 3], ['highlands', 1.5], ['canyon', 1.5], ['rolling', 1]],
  toxic: [['spires', 2], ['canyon', 2], ['rolling', 1], ['badlands', 1]],
  volcanic: [['volcanoes', 3], ['rift', 2], ['alpine', 1]],
  barren: [['rolling', 1.5], ['canyon', 1.5], ['rift', 1], ['mesa', 1]],
  dead: [['canyon', 2], ['mesa', 2], ['rift', 1.5], ['badlands', 1.5]],
  irradiated: [['rift', 2], ['spires', 1.5], ['badlands', 1]],
  inferno: [['volcanoes', 3], ['rift', 1.5], ['mesa', 1]],
  storm: [['alpine', 2], ['highlands', 2], ['spires', 1], ['canyon', 1]],
  corrosive: [['spires', 2], ['canyon', 2], ['badlands', 1]],
  crushing: [['spires', 2], ['mesa', 2], ['rift', 1]],
};

// Ship hazards some worlds of the ordinary kinds carry too (the hostile archetypes have their own)
const EXTRA_HAZARDS: Partial<Record<PlanetType, [number, Hazard]>> = {
  volcanic: [0.3, { kind: 'heat', label: 'Superheated air', ceiling: 3500, dps: 3 }],
  frozen: [0.25, { kind: 'cryo', label: 'Cryogenic cold', ceiling: 2500, dps: 2.5 }],
  desert: [0.2, { kind: 'storm', label: 'Sandstorms', ceiling: 3000, dps: 1.8 }],
  toxic: [0.25, { kind: 'acid', label: 'Caustic air', ceiling: 3500, dps: 2.2 }],
};

// chance a world of each kind is home to a civilisation (a few planets only, never moons)
const CITY_CHANCE: Partial<Record<PlanetType, number>> = { lush: 0.5, alien: 0.55, desert: 0.4, frozen: 0.25, toxic: 0.2, storm: 0.15 };

export const PLANET_TYPES = Object.keys(ARCHETYPES) as PlanetType[];

export function archetype(type: PlanetType): Archetype {
  return ARCHETYPES[type];
}

// ---------- parameters ----------
// Feature sizes were tuned on worlds of about HEIGHT_REF radius. The noise below runs on unit
// directions, so on a bigger world the frequencies go up (by different powers: continents grow
// with the planet, hills keep their size in metres) and the relief stays walkable.
const HEIGHT_REF = 32000;

/** A crater: unit direction, angular radius, depth factor. */
export type Crater = [x: number, y: number, z: number, size: number, depth: number];
/** A volcano: unit direction, angular radius of its base, height (m), caldera radius (fraction of the base). */
export type Volcano = [x: number, y: number, z: number, base: number, height: number, caldera: number];

export interface MesaRelief {
  size: number;
  t: number;
  edge: number;
  height: number;
  tiers: number;
  cover: number;
}
export interface CanyonRelief {
  size: number;
  floor: number;
  rim: number;
  depth: number;
  cover: number;
}
export type RiftRelief = CanyonRelief;
export interface SpiresRelief {
  size: number;
  t: number;
  height: number;
  cover: number;
}
export interface EscarpRelief {
  size: number;
  edge: number;
  height: number;
}
/** A world's landforms on top of its continents, ranges and hills (sizes and heights in metres). */
export interface Relief {
  style: ReliefStyle;
  mesa?: MesaRelief;
  canyon?: CanyonRelief;
  rift?: RiftRelief;
  spires?: SpiresRelief;
  escarp?: EscarpRelief;
}

export interface Atmosphere {
  scatter: number[];
  density: number;
  height: number;
}

/** Everything that defines a rocky world, generated from its seed, type and radius (see createPlanetParams). */
export interface PlanetParams {
  seed: number;
  type: PlanetType;
  radius: number;
  isMoon: boolean;
  hasOcean: boolean;
  continentBias: number;
  continentFreq: number;
  seaDepth: number;
  landHeight: number;
  mountainHeight: number;
  mountainFreq: number;
  hillHeight: number;
  hillFreq: number;
  detailHeight: number;
  warp: number;
  terraceStep: number;
  terraceStrength: number;
  duneHeight: number;
  craterCount: number;
  beachHeight: number;
  snowLine: number;
  colors: Record<ColorKey, Rgb>;
  lava: boolean;
  flora: number;
  craters?: Crater[];
  water: { shallow: Rgb; deep: Rgb; emissive: number };
  atmosphere: Atmosphere | null;
  clouds: number;
  label: string;
  weather: string;
  sunTint: Rgb;
  skyTint: Rgb | null;
  lifeless: boolean;
  dryBasins: boolean;
  ridgePow?: number;
  mountainCover?: number;
  volcanoes?: Volcano[];
  relief: Relief;
  hazard: Hazard | null;
  /** a mild world's air (only on one: absent everywhere else) */
  mist?: Mist;
  cityCount: number;
  citySeed: number;
  /** the capital of the people whose home this is, planned as the world's first city (absent on every other world) */
  capital?: CapitalSpec;
  /** levelled ground under cities and sites, flat [x, y, z, height, inner, outer] per pad (see TerrainSampler.setPads) */
  pads?: number[] | null;
}

/** How a world is made beyond its seed, type and radius. */
export interface PlanetOptions {
  isMoon?: boolean;
  /** the mild variant (the Ulgani's toxic home, DESIGN 5.1): no ship hazard, and on foot the air is caustic only above
   * the mist line */
  mild?: boolean;
  /** a people's capital, planned as its first city */
  capital?: CapitalSpec;
}

// The mild variant's air: breathable over the lowlands, turning caustic across a band above the mist line, as harsh there
// as any toxic world's. The line lies above every plain a city can be planned on (no higher than 0.3 of the mountain
// height, cut from ground no more than 380 m higher), so the capital always breathes; the hills and ranges do not.
const MIST_BAND = 150;
const MIST_RATE = 1.2;
function mistLine(p: PlanetParams): number {
  return p.mountainHeight * 0.3 + 400;
}

export function createPlanetParams(
  seed: number,
  type: PlanetType,
  radius: number,
  { isMoon = false, mild = false, capital }: PlanetOptions = {},
): PlanetParams {
  const rng = new Random(seed);
  const a: Archetype = ARCHETYPES[type];
  const dh = rng.float(-a.hueJitter, a.hueJitter);
  const colors = {} as Record<ColorKey, Rgb>;
  for (const k in a.colors) {
    const key = k as ColorKey;
    colors[key] = shiftColor(a.colors[key], dh, rng.float(-0.05, 0.05), rng.float(-0.03, 0.03), 0.8, 0.45);
  }

  const R = radius;
  // relief grows only slowly with the size of the world: a big planet is not a scaled-up small one
  // with kilometres-high hills, it has more room between its features (see TerrainSampler)
  const Rh = HEIGHT_REF * pow(Math.max(R, 1) / HEIGHT_REF, 0.35);
  const hasOcean = a.ocean > 0 && rng.chance(type === 'desert' ? 0.5 : 0.9);
  const oceanFrac = hasOcean ? clamp(a.ocean + rng.float(-0.15, 0.15), 0.05, 0.8) : 0;

  // (filled in below in the order the demo always built it, which the golden fixtures pin)
  const p = {
    seed,
    type,
    radius: R,
    isMoon,
    hasOcean,
    // continentBias shifts fbm (~[-0.6,0.6]) so roughly oceanFrac of the surface is below sea level
    continentBias: hasOcean ? lerp(0.25, -0.22, oceanFrac) : 0.35,
    continentFreq: rng.float(0.9, 1.7),
    seaDepth: Rh * rng.float(0.006, 0.012),
    landHeight: Rh * rng.float(0.004, 0.009),
    mountainHeight: Rh * rng.float(0.02, 0.042) * (type === 'frozen' ? 1.2 : 1),
    mountainFreq: rng.float(2.0, 4.5),
    hillHeight: Rh * rng.float(0.0025, 0.0055),
    hillFreq: rng.float(7, 14),
    detailHeight: rng.float(2.5, 6),
    warp: rng.float(0.08, 0.35),
    terraceStep: rng.chance(type === 'desert' || type === 'alien' ? 0.5 : 0.12) ? rng.float(25, 70) : 0,
    terraceStrength: rng.float(0.4, 0.9),
    duneHeight: type === 'desert' ? rng.float(6, 14) : 0,
    craterCount: a.craters ? rng.int(180, 320) : 0,
    beachHeight: rng.float(3, 7),
    snowLine: a.snowLine * Rh * 0.02,
    colors,
    lava: !!a.lava,
    flora: a.flora * rng.float(0.7, 1.2),
  } as PlanetParams;
  if (a.craters) {
    p.mountainHeight *= 0.5;
    p.landHeight *= 0.5;
    p.continentBias = 0.2;
  }

  // Crater list (unit vectors + angular radii) baked into params so workers agree.
  if (p.craterCount) {
    const craters: Crater[] = [];
    const crng = new Random(seed ^ 0x9e3779b9);
    for (let i = 0; i < p.craterCount; i++) {
      const u = crng.float(-1, 1);
      const t = crng.float(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      // power-law size distribution: lots of small craters, a few big ones
      const size = pow(crng.next(), 3.2) * 0.22 + 0.006;
      craters.push([s * cos(t), u, s * sin(t), size, crng.float(0.15, 0.45)]);
    }
    p.craters = craters;
  }

  // Water / atmosphere look (main thread uses these for shaders)
  const wsh = shiftColor(a.water.shallow, dh * 0.5, 0, 0, 1, a.water.emissive ? 1 : 0.6);
  const wdp = shiftColor(a.water.deep, dh * 0.5, 0, 0, 1, a.water.emissive ? 1 : 0.75);
  p.water = { shallow: wsh, deep: wdp, emissive: a.water.emissive };
  p.atmosphere = a.sky
    ? {
        scatter: a.sky.map((c) => c * rng.float(0.85, 1.15)),
        density: a.atmo * rng.float(0.85, 1.15),
        // deep enough that the sky darkens gradually on a climb and re-entry glows well above the
        // cloud deck (Planet thins the scattering to match, so the colours stay the same)
        height: R * rng.float(0.22, 0.26),
      }
    : null;
  p.clouds = a.sky ? clamp(a.clouds + rng.float(-0.2, 0.25), 0, 0.85) : 0;
  // (storm worlds are never anything but socked in)
  if (a.overcast) p.clouds = 1;
  p.label = a.label;
  p.weather = rng.pick(a.weather);
  p.sunTint = a.sunTint || [1, 1, 1];
  p.skyTint = a.skyTint || null;
  p.lifeless = !!a.lifeless;
  p.dryBasins = !!a.dryBasins;
  // (new features draw from streams of their own, so everything above stays as it was)
  addRelief(p, type, new Random((seed ^ 0x7e11ef) >>> 0), Rh);
  const hz = new Random((seed ^ 0x4a2a7d) >>> 0);
  const extra = EXTRA_HAZARDS[type];
  p.hazard = a.hazard ? { ...a.hazard } : extra && hz.chance(extra[0]) ? { ...extra[1] } : null;
  if (p.hazard) p.hazard.dps *= hz.float(0.8, 1.25);
  // (the draws above are still made, so a mild world is otherwise the world it would have been)
  if (mild) {
    p.hazard = null;
    p.mist = { line: mistLine(p), band: MIST_BAND, rate: MIST_RATE };
  }
  const cz = new Random((seed ^ 0xc171e5) >>> 0);
  p.cityCount = !isMoon && cz.chance(CITY_CHANCE[type] || 0) ? cz.int(1, 3) : 0;
  p.citySeed = cz.int(1, 1e9);
  // a people's home world has at least its capital (the draws above are made all the same, so its other cities and
  // everything planned from its city seed come out as they would have)
  if (capital && !isMoon) {
    p.cityCount = Math.max(1, p.cityCount);
    p.capital = { ...capital };
  }
  return p;
}

function pickWeighted<K>(rng: Random, list: [K, number][]): K {
  let t = list.reduce((a, [, w]) => a + w, 0) * rng.next();
  for (const [k, w] of list) if ((t -= w) <= 0) return k;
  return list[0][0];
}

function addRelief(p: PlanetParams, type: PlanetType, rng: Random, Rh: number) {
  const style = pickWeighted(rng, RELIEF_STYLES[type] || [['rolling', 1]]);
  const rl: Relief = { style };
  // sizes in metres; heights grow slowly with the world, like the rest of its relief
  const k = Rh / HEIGHT_REF;
  const mesa = (height: number, cover: number): MesaRelief => ({
    size: rng.float(1300, 3200),
    t: rng.float(0.15, 0.35) - cover,
    edge: rng.float(0.012, 0.03),
    height: height * k,
    tiers: rng.chance(0.55) ? 2 : 1,
    cover,
  });
  const canyon = (depth: number, size: number): CanyonRelief => ({
    size,
    floor: rng.float(0.012, 0.03),
    rim: rng.float(0.05, 0.09),
    depth: depth * k,
    cover: rng.float(-0.1, 0.25),
  });
  if (style === 'alpine') {
    // towering, sharper ranges over more of the land
    p.mountainHeight *= rng.float(1.9, 2.8);
    p.ridgePow = rng.float(2.1, 2.7);
    p.mountainCover = rng.float(0.08, 0.16);
  } else if (style === 'mesa') rl.mesa = mesa(rng.float(160, 420), rng.float(0, 0.15));
  else if (style === 'canyon') rl.canyon = canyon(rng.float(180, 520), rng.float(5000, 11000));
  else if (style === 'badlands') {
    rl.mesa = mesa(rng.float(90, 220), 0.1);
    rl.canyon = canyon(rng.float(120, 300), rng.float(2600, 5200));
    p.terraceStep = p.terraceStep || rng.float(18, 40);
    p.terraceStrength = Math.max(p.terraceStrength, 0.7);
  } else if (style === 'rift')
    rl.rift = {
      size: rng.float(14000, 30000),
      floor: rng.float(0.006, 0.012),
      rim: rng.float(0.018, 0.03),
      depth: rng.float(600, 1400) * k,
      cover: rng.float(-0.25, 0.05),
    };
  else if (style === 'spires') rl.spires = { size: rng.float(110, 260), t: rng.float(0.38, 0.5), height: rng.float(70, 230) * k, cover: rng.float(-0.05, 0.3) };
  else if (style === 'highlands') rl.escarp = { size: rng.float(9000, 22000), edge: rng.float(0.015, 0.035), height: rng.float(220, 650) * k };
  else if (style === 'volcanoes') {
    // a few giant cones, each with a caldera (of lava, where the world has it)
    const list: Volcano[] = [];
    const n = rng.int(5, 12);
    for (let i = 0; i < n; i++) {
      const u = rng.float(-0.85, 0.85);
      const t = rng.float(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      const base = rng.float(3500, 11000);
      list.push([s * cos(t), u, s * sin(t), base / p.radius, rng.float(0.32, 0.6) * base * (k * 0.6 + 0.4), rng.float(0.12, 0.2)]);
    }
    p.volcanoes = list;
  }
  p.relief = rl;
}

// ---------- terrain sampler ----------
/** One terrain sample (heights in metres above sea level; the fields in 0..1 unless noted). */
export interface TerrainSample {
  h: number;
  moisture: number;
  /** equator hot, poles and peaks cold: about -1..1 */
  temp: number;
  land: number;
  rockiness: number;
  mMask?: number;
}

export class TerrainSampler {
  p: PlanetParams;
  R: number;
  fWarp: number;
  fCont: number;
  fMask: number;
  fMount: number;
  fHill: number;
  fTerrace: number;
  fMoist: number;
  fTemp: number;
  hTemp: number;
  n1: Simplex3;
  n2: Simplex3;
  n3: Simplex3;
  craters: Crater[] | null;
  volcanoes: Volcano[] | null;
  /** per volcano: cos of its angular radius, cos of its caldera's, and its cone's height at the caldera's rim */
  private volcanoCos: Float64Array | null;
  relief: Partial<Relief>;
  /** the sample() result, reused: copy what you need before the next call */
  out: TerrainSample;
  pads: number[] | null = null;
  padGrid: Map<number, number[]> | null = null;

  constructor(params: PlanetParams) {
    this.p = params;
    this.R = params.radius;
    const F = Math.max(1, this.R / HEIGHT_REF);
    this.fWarp = 2.3 * Math.sqrt(F);
    this.fCont = params.continentFreq * Math.sqrt(F);
    this.fMask = 3.1 * pow(F, 0.6);
    this.fMount = params.mountainFreq * pow(F, 0.75);
    this.fHill = params.hillFreq * F;
    this.fTerrace = 4.0 * F;
    this.fMoist = 3.0 * pow(F, 0.6);
    this.fTemp = 5 * Math.sqrt(F);
    this.hTemp = HEIGHT_REF * pow(F, 0.35) * 0.03;
    this.n1 = new Simplex3(params.seed);
    this.n2 = new Simplex3(params.seed + 7919);
    this.n3 = new Simplex3(params.seed + 104729);
    this.craters = params.craters || null;
    this.volcanoes = params.volcanoes || null;
    this.volcanoCos = null;
    if (this.volcanoes) {
      this.volcanoCos = new Float64Array(this.volcanoes.length * 3);
      this.volcanoes.forEach((v, i) => this.volcanoCos!.set([cos(v[3]), cos(v[3] * v[5]), pow(1 - v[5], 1.7)], i * 3));
    }
    this.relief = params.relief || {};
    this.out = { h: 0, moisture: 0, temp: 0, land: 0, rockiness: 0 };
    this.setPads(params.pads || null);
  }

  /**
   * Level ground under points of interest. pads: flat [x, y, z, height, inner, outer] per site
   * (unit direction, metres), bucketed on a coarse grid so each sample checks only nearby pads.
   */
  setPads(pads: number[] | null) {
    this.pads = pads;
    this.padGrid = null;
    if (!pads || !pads.length) return;
    const grid = new Map<number, number[]>();
    for (let i = 0; i < pads.length; i += 6) {
      const e = pads[i + 5] / this.R;
      const lo = [0, 1, 2].map((a) => padCell(pads[i + a] - e));
      const hi = [0, 1, 2].map((a) => padCell(pads[i + a] + e));
      for (let x = lo[0]; x <= hi[0]; x++) {
        for (let y = lo[1]; y <= hi[1]; y++) {
          for (let z = lo[2]; z <= hi[2]; z++) {
            const key = (x * 64 + y) * 64 + z;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key)!.push(i);
          }
        }
      }
    }
    this.padGrid = grid;
  }

  /** How much a point lies on a site's worn ground (1 on the pad, fading out past it). */
  padWear(x: number, y: number, z: number): number {
    if (!this.padGrid) return 0;
    const list = this.padGrid.get((padCell(x) * 64 + padCell(y)) * 64 + padCell(z));
    if (!list) return 0;
    const P = this.pads!;
    let w = 0;
    for (const i of list) {
      const dx = x - P[i];
      const dy = y - P[i + 1];
      const dz = z - P[i + 2];
      // a ragged worn patch, not a stamped circle
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * this.R * (1 + 0.35 * this.n3.noise((x * this.R) / 11, (y * this.R) / 11, (z * this.R) / 11));
      w = Math.max(w, 1 - smoothstep(P[i + 4] - 6, P[i + 4] + 9, d));
    }
    return w;
  }

  flatten(x: number, y: number, z: number, h: number): number {
    const list = this.padGrid!.get((padCell(x) * 64 + padCell(y)) * 64 + padCell(z));
    if (!list) return h;
    const P = this.pads!;
    for (const i of list) {
      const dx = x - P[i];
      const dy = y - P[i + 1];
      const dz = z - P[i + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * this.R;
      if (d < P[i + 5]) h = lerp(h, P[i + 3], 1 - smoothstep(P[i + 4], P[i + 5], d));
    }
    return h;
  }

  /** Height above sea level (metres) for a unit direction. */
  height(x: number, y: number, z: number): number {
    return this.sample(x, y, z).h;
  }

  sample(x: number, y: number, z: number): TerrainSample {
    const p = this.p;
    const n1 = this.n1;
    const n2 = this.n2;
    const n3 = this.n3;
    const R = this.R;
    const o = this.out;

    // domain warp for organic continents
    const w = p.warp / Math.sqrt(Math.max(1, R / HEIGHT_REF));
    const fw = this.fWarp;
    const qx = x + w * n2.noise(x * fw + 11.1, y * fw, z * fw);
    const qy = y + w * n2.noise(x * fw, y * fw + 23.7, z * fw);
    const qz = z + w * n2.noise(x * fw, y * fw, z * fw + 37.3);

    const cf = this.fCont;
    const c = n1.fbm(qx * cf, qy * cf, qz * cf, 6, 2.0, 0.5) + p.continentBias;

    let h: number;
    let land: number;
    if (p.hasOcean) {
      land = smoothstep(-0.02, 0.1, c);
      const floor = -p.seaDepth * smoothstep(0.0, -0.35, c) - p.beachHeight * 3;
      const plains = p.beachHeight * 0.4 + Math.max(0, c) * p.landHeight * 2.5;
      h = lerp(floor, plains, land);
    } else {
      land = 1;
      h = c * p.landHeight * 2.0;
      // the beds of seas long gone: broad, flat-floored basins
      if (p.dryBasins) h -= p.seaDepth * 0.6 * smoothstep(0.05, -0.3, c - p.continentBias + 0.12);
    }

    // mountain ranges via ridged multifractal, masked to continent interiors
    const mf = this.fMount;
    const fm = this.fMask;
    const mc = p.mountainCover || 0;
    const mMask = smoothstep(0.02 - mc, 0.32 - mc, c + 0.22 * n3.noise(x * fm, y * fm, z * fm)) * land;
    let mountains = 0;
    if (mMask > 0.001) {
      const r = n1.ridged(qx * mf + 3.3, qy * mf, qz * mf, 7, 2.07, 0.52, 2.0);
      mountains = pow(r, p.ridgePow || 1.7) * p.mountainHeight * mMask;
    }

    // rolling hills
    const hf = this.fHill;
    const hills = n2.fbm(x * hf, y * hf, z * hf, 5, 2.0, 0.5) * p.hillHeight * (0.25 + 0.75 * land);

    // meter-scale detail
    const dx = x * R;
    const dy = y * R;
    const dz = z * R;
    const detail = n3.fbm(dx / 70, dy / 70, dz / 70, 4, 2.1, 0.5) * p.detailHeight;

    h += mountains + hills + detail;
    h += this.landforms(dx, dy, dz, land, mMask);

    if (p.duneHeight > 0 && land > 0.5) {
      const dn = 1 - Math.abs(n2.noise(dx / 160, dy / 420, dz / 160) + 0.3 * n3.noise(dx / 90, dy / 90, dz / 90));
      h += dn * dn * p.duneHeight * smoothstep(0.5, 1.0, land) * (1 - mMask);
    }

    if (p.terraceStep > 0 && h > 0) {
      const s = p.terraceStep;
      const k = h / s;
      const f = k - Math.floor(k);
      const stepped = (Math.floor(k) + pow(smoothstep(0.0, 1.0, f), 6)) * s;
      const ft = this.fTerrace;
      const tMask = smoothstep(0.1, 0.5, n3.noise(x * ft + 9.0, y * ft, z * ft) * 0.5 + 0.5);
      h = lerp(h, stepped, p.terraceStrength * tMask);
    }

    if (this.craters) {
      h += this.craterHeight(x, y, z);
    }
    if (this.volcanoes) h += this.volcanoHeight(x, y, z);
    if (this.padGrid) h = this.flatten(x, y, z, h);

    o.h = h;
    o.land = land;
    const fmo = this.fMoist;
    o.moisture = n2.fbm(x * fmo + 50, y * fmo, z * fmo, 4) * 0.5 + 0.5 + n3.noise(dx / 600, dy / 600, dz / 600) * 0.15;
    // temperature: equator hot, poles cold, decreasing with altitude
    const fte = this.fTemp;
    o.temp = 1 - pow(Math.abs(y), 1.6) - Math.max(0, h) / this.hTemp + n1.noise(x * fte, y * fte, z * fte) * 0.12;
    o.mMask = mMask;
    return o;
  }

  /**
   * The world's landforms (see addRelief), in metres at a point given in metres. Edges are a few
   * tens of metres wide in a feature hundreds of metres high: sheer cliffs.
   */
  landforms(dx: number, dy: number, dz: number, land: number, mMask: number): number {
    const rl = this.relief;
    const n1 = this.n1;
    const n2 = this.n2;
    const n3 = this.n3;
    let dh = 0;
    if (rl.mesa) {
      // plateaus: flat tops, sheer walls, sometimes a second tier
      const m = rl.mesa;
      const s = m.size;
      const n = n1.noise(dx / s + 31.7, dy / s, dz / s) + 0.35 * n2.noise(dx / (s * 0.45), dy / (s * 0.45) + 5.1, dz / (s * 0.45));
      const region = smoothstep(-0.25, 0.2, n3.noise(dx / (s * 7), dy / (s * 7) - 3.3, dz / (s * 7)) + m.cover);
      if (region > 0) {
        let t = smoothstep(m.t, m.t + m.edge, n);
        if (m.tiers > 1) t += 0.65 * smoothstep(m.t + 0.24, m.t + 0.24 + m.edge, n);
        dh += t * m.height * region * land * (1 - 0.6 * mMask);
      }
    }
    if (rl.canyon) {
      // winding canyons with benched walls (flooded into fjords where they cut below the sea)
      const k = rl.canyon;
      const s = k.size;
      const n = n2.noise(dx / s + 7.7, dy / s, dz / s - 2.2) + 0.22 * n3.noise(dx / (s * 0.28), dy / (s * 0.28), dz / (s * 0.28) + 9.4);
      const v = Math.abs(n);
      if (v < k.rim * 2.4) {
        const region = smoothstep(-0.3, 0.1, n1.noise(dx / (s * 4), dy / (s * 4) + 4.4, dz / (s * 4)) + k.cover);
        const cut = 0.45 * (1 - smoothstep(k.floor * 2.4, k.rim * 2.4, v)) + 0.55 * (1 - smoothstep(k.floor, k.rim, v));
        dh -= cut * k.depth * region * land;
      }
    }
    if (rl.rift) {
      // a few great chasms, near-vertical and deep
      const k = rl.rift;
      const s = k.size;
      const n = n3.noise(dx / s - 13.1, dy / s + 2.7, dz / s) + 0.12 * n1.noise(dx / (s * 0.15), dy / (s * 0.15), dz / (s * 0.15));
      const v = Math.abs(n);
      if (v < k.rim) {
        const region = smoothstep(-0.2, 0.2, n2.noise(dx / (s * 3), dy / (s * 3), dz / (s * 3) + 1.9) + k.cover);
        dh -= (1 - smoothstep(k.floor, k.rim, v)) * k.depth * region;
      }
    }
    if (rl.spires) {
      // forests of stone pinnacles: sheer sides, gently domed tops
      const k = rl.spires;
      const s = k.size;
      const n = n3.noise(dx / s + 3.1, dy / s - 8.2, dz / s);
      if (n > k.t) {
        const region = smoothstep(-0.15, 0.3, n1.noise(dx / (s * 16), dy / (s * 16), dz / (s * 16) - 6.6) + k.cover);
        const t = smoothstep(k.t, k.t + 0.05, n) * 0.8 + smoothstep(k.t, k.t + 0.4, n) * 0.2;
        const tall = 0.55 + 0.45 * (n2.noise(dx / (s * 3.3), dy / (s * 3.3), dz / (s * 3.3)) * 0.5 + 0.5);
        dh += t * k.height * tall * region * land;
      }
    }
    if (rl.escarp) {
      // long escarpments stepping the land up between lowlands and highlands
      const k = rl.escarp;
      const s = k.size;
      const n = n1.noise(dx / s - 4.4, dy / s + 2.2, dz / s) + 0.18 * n2.noise(dx / (s * 0.22), dy / (s * 0.22), dz / (s * 0.22));
      dh += (smoothstep(-k.edge, k.edge, n) + 0.7 * smoothstep(0.35 - k.edge, 0.35 + k.edge, n)) * k.height * land;
    }
    return dh;
  }

  /** Giant cones with concave flanks and a caldera at the summit; returns metres. */
  volcanoHeight(x: number, y: number, z: number): number {
    let total = 0;
    const vc = this.volcanoCos!;
    const list = this.volcanoes!;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const d = x * v[0] + y * v[1] + z * v[2];
      if (d < vc[i * 3]) continue;
      const r = acos(Math.min(1, d)) / v[3];
      if (r >= 1) continue;
      const cone = pow(1 - r, 1.7);
      const cal = v[5];
      // the caldera: a steep-walled pit with a flat floor a quarter of the way down
      const pit = 1 - smoothstep(cal * 0.75, cal, r);
      total += v[4] * (cone - pit * (cone - vc[i * 3 + 2] * 0.72));
    }
    return total;
  }

  /** 1 on a caldera's floor, for its lava glow. */
  caldera(x: number, y: number, z: number): number {
    if (!this.volcanoes) return 0;
    const vc = this.volcanoCos!;
    const list = this.volcanoes;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const d = x * v[0] + y * v[1] + z * v[2];
      if (d < vc[i * 3 + 1]) continue;
      const r = acos(Math.min(1, d)) / v[3];
      return 1 - smoothstep(v[5] * 0.55, v[5] * 0.72, r);
    }
    return 0;
  }

  craterHeight(x: number, y: number, z: number): number {
    const cr = this.craters!;
    let total = 0;
    const R = this.R;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i];
      const d = x * c[0] + y * c[1] + z * c[2];
      const size = c[3];
      // cheap reject: angular distance > 1.5 radius
      const cosLimit = 1 - size * 1.6 * (size * 1.6) * 0.5;
      if (d < cosLimit) continue;
      const ang = acos(Math.min(1, d));
      const r = ang / size;
      const depth = size * R * c[4] * 0.25;
      // Lague-style crater profile: cavity, rim, flat floor, blended with smooth min/max
      const cavity = r * r - 1;
      const rimX = Math.min(r - 1 - 0.7, 0);
      const rim = 0.6 * rimX * rimX;
      let shape = smoothMin(cavity, rim, 0.4);
      shape = smoothMax(shape, -0.55, 0.3);
      total += shape * depth;
    }
    return total;
  }
}

const padCell = (v: number) => Math.floor((v + 1) * 16);

function smoothMin(a: number, b: number, k: number): number {
  const h = clamp((b - a + k) / (2 * k), 0, 1);
  return a * h + b * (1 - h) - k * h * (1 - h);
}
function smoothMax(a: number, b: number, k: number): number {
  return -smoothMin(-a, -b, k);
}

// Broad forested tracts and open country (km scale) on top of the 260 m clumping, and a finer
// octave that frays the edges into spurs and stragglers, so woods don't read from the air as
// one even camouflage pattern of same-sized blobs. Shared with the tree scatter.
export const FOREST_REGION = 2600;
export function forestRegion(sampler: TerrainSampler, x: number, y: number, z: number): number {
  const k = sampler.R / FOREST_REGION;
  const f = sampler.R / 90;
  return 0.55 * sampler.n3.noise(x * k + 5.3, y * k - 7.1, z * k + 2.9) + 0.3 * sampler.n1.noise(x * f - 3.7, y * f + 8.2, z * f + 1.4);
}

// ---------- surface shading inputs ----------
// The terrain fragment shader works out colour per pixel from height, slope and
// noise; per vertex it only needs the slowly varying fields: [moisture, temperature,
// lava glow, forest cover], all in 0..1.
export function surfaceAttribs<T extends NumArray>(
  sampler: TerrainSampler,
  s: Pick<TerrainSample, 'h' | 'moisture' | 'temp'>,
  x: number,
  y: number,
  z: number,
  out: T,
): T {
  const p = sampler.p;
  const R = sampler.R;
  // trampled, dry ground around points of interest
  const wear = sampler.padWear(x, y, z);
  out[0] = clamp(s.moisture, 0, 1) * (1 - wear * 0.55);
  out[1] = clamp(s.temp * 0.5 + 0.5, 0, 1);
  // tree cover, using the same clumping noise and preferences as the tree scatter in
  // Flora, so the canopy drawn into distant terrain lines up with the real trees nearby
  let forest = 0;
  if (p.flora > 0.05 && s.h > (p.hasOcean ? 1.5 : -1e9)) {
    const c = sampler.n2.noise((x * R) / 260, (y * R) / 260, (z * R) / 260) + forestRegion(sampler, x, y, z);
    forest = clamp((c + 0.15) * 1.7, 0, 1) * clamp(1 - Math.abs(s.moisture - 0.6) * 0.6, 0, 1) * Math.min(1, p.flora);
    if (s.temp < -0.2) forest *= 0.15;
  }
  out[3] = forest * (1 - wear);
  let em = 0;
  if (p.lava && s.h > -p.beachHeight) {
    // glowing fissures in low valleys
    const crack = 1 - Math.abs(sampler.n3.noise((x * R) / 120, (y * R) / 120, (z * R) / 120));
    em = smoothstep(0.93, 0.985, crack) * smoothstep(p.landHeight * 1.2, 0, s.h);
  }
  // lava lakes in the volcanoes' calderas
  if (p.lava && sampler.volcanoes) em = Math.max(em, sampler.caldera(x, y, z));
  out[2] = em;
  return out;
}

// ---------- cube sphere helpers ----------
type V3 = [number, number, number];
/** The six cube faces: normal, and the u and v axes across it. */
export const FACES: { n: V3; a: V3; b: V3 }[] = [
  { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
  { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
  { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
];

/** Cube point -> unit sphere (area-preserving-ish mapping). Writes into out. */
export function cubeToSphere<T extends NumArray>(face: number, u: number, v: number, out: T): T {
  const F = FACES[face];
  const x = F.n[0] + F.a[0] * u + F.b[0] * v;
  const y = F.n[1] + F.a[1] * u + F.b[1] * v;
  const z = F.n[2] + F.a[2] * u + F.b[2] * v;
  const x2 = x * x;
  const y2 = y * y;
  const z2 = z * z;
  out[0] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
  out[1] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
  out[2] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
  return out;
}

export interface CubeCoord {
  face: number;
  u: number;
  v: number;
}

/** Inverse of cubeToSphere (approximate via Newton refinement): writes face, u, v into out. */
export function sphereToCube(x: number, y: number, z: number, out: Partial<CubeCoord>): CubeCoord {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  if (ax >= ay && ax >= az) face = x > 0 ? 0 : 1;
  else if (ay >= az) face = y > 0 ? 2 : 3;
  else face = z > 0 ? 4 : 5;
  const F = FACES[face];
  // gnomonic initial guess
  const dn = x * F.n[0] + y * F.n[1] + z * F.n[2];
  let u = (x * F.a[0] + y * F.a[1] + z * F.a[2]) / dn;
  let v = (x * F.b[0] + y * F.b[1] + z * F.b[2]) / dn;
  const tmp = [0, 0, 0];
  const tu = [0, 0, 0];
  const tv = [0, 0, 0];
  for (let it = 0; it < 4; it++) {
    cubeToSphere(face, u, v, tmp);
    const ex = tmp[0] - x;
    const ey = tmp[1] - y;
    const ez = tmp[2] - z;
    const e = 1e-4;
    cubeToSphere(face, u + e, v, tu);
    cubeToSphere(face, u, v + e, tv);
    const jux = (tu[0] - tmp[0]) / e;
    const juy = (tu[1] - tmp[1]) / e;
    const juz = (tu[2] - tmp[2]) / e;
    const jvx = (tv[0] - tmp[0]) / e;
    const jvy = (tv[1] - tmp[1]) / e;
    const jvz = (tv[2] - tmp[2]) / e;
    // least squares 2x2 solve: J^T J d = -J^T e
    const a11 = jux * jux + juy * juy + juz * juz;
    const a12 = jux * jvx + juy * jvy + juz * jvz;
    const a22 = jvx * jvx + jvy * jvy + jvz * jvz;
    const b1 = -(jux * ex + juy * ey + juz * ez);
    const b2 = -(jvx * ex + jvy * ey + jvz * ez);
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-12) break;
    u += (b1 * a22 - b2 * a12) / det;
    v += (a11 * b2 - a12 * b1) / det;
  }
  out.face = face;
  out.u = clamp(u, -1, 1);
  out.v = clamp(v, -1, 1);
  return out as CubeCoord;
}
