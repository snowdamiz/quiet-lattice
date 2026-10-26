// The look the game gives mask-coloured families, for the grader's captures (IMPLEMENTATION_PLAN 0.10.3). Creatures and
// flora carry a colour-region mask in their vertex colours (R primary, G secondary, B accent, A occlusion) that the game
// fills with a species' or a planet's palette at run time (the client's modelLibrary.recolor), so neither the raw mask
// nor any one palette is the asset's colour. The review scene and the turntable sheets fill the mask with these
// representative palettes and the game's own material settings, so the grader judges what a player sees.

export interface GameLook {
  /** sRGB hex colours for the mask's R, G and B regions */
  palette: readonly [number, number, number];
  /** the brightest any palette channel may be, in linear terms (recolor's albedo cap) */
  albedoCap: number;
  /** the colour kept where the mask's occlusion is 0 */
  aoFloor: number;
  roughness: number;
  metalness: number;
}

/** Fauna's creature material and recolor settings, with a dun grazer's palette. */
const CREATURE: GameLook = { palette: [0x8a6b4f, 0xd8c6a0, 0x2f2622], albedoCap: 0.75, aoFloor: 0.05, roughness: 0.65, metalness: 0.05 };

const flora = (palette: GameLook['palette']): GameLook => ({ palette, albedoCap: 0.6, aoFloor: 0.35, roughness: 0.82, metalness: 0 });

/** Flora kinds by name prefix, with the palettes floraModels fills them with on a lush world. */
const FLORA: readonly [RegExp, GameLook][] = [
  [/^(tree_|cactus|bush|fern|grass)/, flora([0x4f8a3a, 0x5a4030, 0x9fd65a])],
  [/^(rock|boulder)/, flora([0x7a746c, 0x55514c, 0x8f8880])],
  [/^deposit/, flora([0x6a6560, 0x45423f, 0xff8a2a])],
  [/^plant_/, flora([0x4a7a3a, 0x35552a, 0x4fc8ff])],
  [/^crystal/, flora([0x7fc8e8, 0x3f6a88, 0xbfefff])],
];

/** The game's look for an asset of `family` named `name`, or null when the game draws the file's own materials. */
export function gameLook(family: string, name: string): GameLook | null {
  if (family === 'creatures') return CREATURE;
  if (family !== 'flora') return null;
  const kind = name.replace(/_(?:lod|LOD)\d+$/, '').replace(/_\d+$/, '');
  return (FLORA.find(([re]) => re.test(kind)) ?? FLORA[0]!)[1];
}

/** Every look a file of `family` can use, keyed by the regex source its asset names are matched with (for Blender). */
export function gameLooksFor(family: string): { match: string; look: GameLook }[] {
  if (family === 'creatures') return [{ match: '.*', look: CREATURE }];
  if (family === 'flora') return [...FLORA.map(([re, look]) => ({ match: re.source, look })), { match: '.*', look: FLORA[0]![1] }];
  return [];
}
