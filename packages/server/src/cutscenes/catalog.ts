// The cutscenes the server plays (DESIGN 8 "Cutscenes in-engine", 14.1 "Cutscenes are always instanced"; docs/
// ARCHITECTURE.md "Cutscenes"): which ids a client may ask for, the story phase's volume round the player, and the
// actors each spawns into its phase. What a cutscene shows (cameras, lines, banners) is the client's, exported from
// Blender to packages/client/public/cutscenes/<id>.json; the quest engine (P1.E09.T01) adds its chapters' entries.

type Vec3 = [number, number, number];

/** One of a cutscene's actors: spawned into its phase, placed relative to the player who started it (in the player's
 * frame, turned with the player: +x right, +y up, -z ahead). */
export interface CutsceneActor {
  kind: 'npc' | 'ship' | 'prop';
  name: string;
  hull?: string;
  offset: Vec3;
}

export interface CutsceneEntry {
  /** radius (m) of the story phase's volume round where the player was when it started; a member who stays outside
   * it past the phase kind's grace goes back to the shared world */
  radius: number;
  actors: readonly CutsceneActor[];
}

export const CUTSCENES: Readonly<Record<string, CutsceneEntry>> = Object.freeze({
  // the pipeline's test (assets/blend/cutscenes/test_cutscene.blend): the Waystation hails a dark ship and sends a tug
  test: { radius: 3000, actors: [{ kind: 'ship', name: 'Waystation tug', hull: 'mule', offset: [-40, 12, -160] }] },
});
