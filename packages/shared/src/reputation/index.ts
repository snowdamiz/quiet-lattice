// Reputation (`@astra/shared/reputation`, DESIGN 14.4; P2.E18.T01; ARCHITECTURE §24): a character's standing with each
// faction, 0–1000 (none is 0), its rank there (the highest whose threshold, 200, 500 or 800, its standing reaches: ranks
// follow standing down as well as up, since rep is lost as well as gained), and the titles it has earned, kept for good
// whatever its standing does later: a rank's title the first time the rank is reached, and those quests give. A rank's
// title is held by its faction and rank (the data names it), a quest's by its name, and a quest's title that names a
// rank's (a chain's last quest giving "Hand") is that rank's title, so it is never held twice. The server changes
// standing with these rules (its reputation service adds who is in play, the log and the messages); the client reads the
// view it is sent.
//
// Acts that move two factions at once (DESIGN 14.4: "raiding a convoy costs Compact rep, defending one costs Reaches
// rep") are data here (`REP_ACTS`): the side helped gains, its opposed side loses, each act with its Count meter tag.
//
// This module imports only the data tables: the protocol imports it, never the other way round.
import { z } from 'zod';
import { deepFreeze, FACTION_IDS, FACTION_RULES, factionIdSchema, getFaction, idSchema, rankAt, type FactionId } from '../data/index.ts';

/** Standing's bounds (DESIGN 14.4: "Rep runs 0–1000 per faction"). */
export const REP_MIN = FACTION_RULES.repMin;
export const REP_MAX = FACTION_RULES.repMax;
/** The most titles a character keeps: every rank's (18: six factions of three) and room for quests' and seasons'. Past it
 * no title is added. */
export const TITLES_MAX = 128;
/** The most factions a stored value names (the table has 6): a bound on what a corrupt row can make the server hold. */
const STORED_FACTIONS_MAX = 64;

const FACTIONS_KNOWN: ReadonlySet<string> = new Set(FACTION_IDS);

/** Whether `id` is a faction the table has. */
export function isFaction(id: string): id is FactionId {
  return FACTIONS_KNOWN.has(id);
}

/** A title as shown: a rank's name (Hand, Captain's Ear) or a quest's (Unlisted). */
export const titleSchema = z.string().trim().min(1).max(48);

/** A faction as stored: any id, so a value naming one the table has since dropped still reads, and is reconciled away. */
const storedFactionSchema = idSchema.max(32);
/** A rank's id (a faction's ranks: `hand`, `captains_ear`…). */
export const rankIdSchema = idSchema.max(32);
const questRefSchema = idSchema.max(48);

/** A rank's title: held by its faction and rank, so the data's name for it is the one shown (the three cities share their
 * ranks' names, and a rename shows the new one). */
export const rankTitleSchema = z.strictObject({ faction: storedFactionSchema, rank: rankIdSchema });
/** A quest's title (Forty Names' "Unlisted"): held by its name, with the quest that gave it. */
export const questTitleSchema = z.strictObject({ title: titleSchema, quest: questRefSchema.optional() });
/** A title a character has earned, as stored. */
export const earnedTitleSchema = z.union([rankTitleSchema, questTitleSchema]);
export type RankTitle = z.infer<typeof rankTitleSchema>;
export type QuestTitle = z.infer<typeof questTitleSchema>;
export type EarnedTitle = RankTitle | QuestTitle;

/** Whether a title is a rank's. */
export function isRankTitle(t: EarnedTitle): t is RankTitle {
  return 'rank' in t;
}

/** The key a title is held once by: a rank's is its faction and rank, a quest's its name. */
export function titleKey(t: EarnedTitle): string {
  return isRankTitle(t) ? `rank:${t.faction}:${t.rank}` : `title:${t.title}`;
}

/** A title's name as shown: a rank's from the data (null for a rank or faction the table does not have), a quest's own. */
export function titleName(t: EarnedTitle): string | null {
  if (!isRankTitle(t)) return t.title;
  if (!isFaction(t.faction)) return null;
  return getFaction(t.faction).ranks.find((r) => r.id === t.rank)?.title ?? null;
}

const uniqueTitles = (titles: readonly EarnedTitle[]) => new Set(titles.map(titleKey)).size === titles.length;

/** A character's reputation (the `reputation` persistence component, v1): standing by faction (a faction it names none
 * with is at 0) and the titles it has earned, each once, in the order earned. */
export const reputationSchema = z.strictObject({
  rep: z.record(storedFactionSchema, z.int().min(REP_MIN).max(REP_MAX)).refine((r) => Object.keys(r).length <= STORED_FACTIONS_MAX, 'too many factions'),
  titles: z.array(earnedTitleSchema).max(TITLES_MAX).refine(uniqueTitles, 'a title is held once'),
});
export type Reputation = z.infer<typeof reputationSchema>;

/** A new character's: no standing anywhere, no titles. */
export function emptyReputation(): Reputation {
  return { rep: {}, titles: [] };
}

/** Standing held to its bounds, in whole points. */
export function clampRep(n: number): number {
  return Math.min(REP_MAX, Math.max(REP_MIN, Math.round(n)));
}

/** A character's standing with a faction (0 when it has none). */
export function standingOf(r: Pick<Reputation, 'rep'>, faction: FactionId): number {
  return r.rep[faction] ?? 0;
}

/** The id of the rank standing `rep` holds with a faction, or null below its first threshold. */
export function rankIdAt(faction: FactionId, rep: number): string | null {
  return rankAt(faction, rep)?.id ?? null;
}

/** Whether a character's standing with `faction` holds rank `rank` or a higher one (a quest's or a trainer's gate). */
export function meetsRank(r: Pick<Reputation, 'rep'>, faction: FactionId, rank: string): boolean {
  const ranks = getFaction(faction).ranks;
  const need = ranks.find((x) => x.id === rank);
  return need !== undefined && standingOf(r, faction) >= need.rep;
}

/** What one change of standing did. */
export interface StandingChange {
  faction: FactionId;
  /** standing before and after, 0–1000 */
  from: number;
  to: number;
  /** the rank held before and after (its id; null below the first threshold) */
  rankFrom: string | null;
  rankTo: string | null;
  /** titles it earned: every rank reached for the first time */
  titles: RankTitle[];
}

/**
 * The rank whose title a quest's title names (a chain's last quest giving "Hand"): one of `factions`' ranks (the factions
 * the quest pays reputation to) first, else the only rank of the table with that name; null when there is none, or when
 * several factions' ranks share it and `factions` does not say which (the cities' Guest, Neighbour, Claimant).
 */
export function rankOfTitle(title: string, factions: readonly FactionId[] = []): RankTitle | null {
  const named = (fs: readonly FactionId[]) =>
    fs.flatMap((faction) =>
      getFaction(faction)
        .ranks.filter((r) => r.title === title)
        .map((r) => ({ faction, rank: r.id })),
    );
  const own = named([...new Set(factions)]);
  if (own.length === 1) return own[0]!;
  const all = named(FACTION_IDS);
  return own.length === 0 && all.length === 1 ? all[0]! : null;
}

/** A quest's title as it is held: the rank's title it names (rankOfTitle), or its name, with the quest. */
export function questTitle(title: string, quest?: string, factions: readonly FactionId[] = []): EarnedTitle {
  return rankOfTitle(title, factions) ?? (quest === undefined ? { title } : { title, quest });
}

/**
 * Adds a title the character has not earned: false when it holds it already, or holds TITLES_MAX. A quest's title counts
 * as held when any title held has its name; a rank's title takes the place of a quest's title of its name (the same
 * title, now known to be the rank's). Changes `r` in place.
 */
export function earnTitle(r: Reputation, t: EarnedTitle): boolean {
  const key = titleKey(t);
  if (r.titles.some((x) => titleKey(x) === key)) return false;
  const name = titleName(t);
  if (!isRankTitle(t) && r.titles.some((x) => titleName(x) === name)) return false;
  const same = isRankTitle(t) ? r.titles.findIndex((x) => !isRankTitle(x) && x.title === name) : -1;
  if (same >= 0) r.titles.splice(same, 1);
  else if (r.titles.length >= TITLES_MAX) return false;
  r.titles.push({ ...t });
  return true;
}

/**
 * Sets standing with `faction` to `value`, held to 0–1000. Every rank whose threshold it rises through (from below it to
 * at or above it) earns its title, once ever: a rank lost and reached again earns nothing more. Changes `r` in place.
 */
export function setStanding(r: Reputation, faction: FactionId, value: number): StandingChange {
  const from = standingOf(r, faction);
  const to = clampRep(value);
  r.rep[faction] = to;
  const titles: RankTitle[] = [];
  for (const rank of getFaction(faction).ranks) {
    if (from >= rank.rep || to < rank.rep) continue;
    const t: RankTitle = { faction, rank: rank.id };
    if (earnTitle(r, t)) titles.push(t);
  }
  return { faction, from, to, rankFrom: rankIdAt(faction, from), rankTo: rankIdAt(faction, to), titles };
}

/** Moves standing with `faction` by `delta` (a loss when negative), held to 0–1000; see setStanding. */
export function moveStanding(r: Reputation, faction: FactionId, delta: number): StandingChange {
  return setStanding(r, faction, standingOf(r, faction) + delta);
}

/** One faction's share of a change. */
export interface RepDelta {
  faction: FactionId;
  amount: number;
}

/** An act's side in the Count meter's lean (DESIGN 16.2; the server's `CountTag`). */
export type RepActTag = 'feed' | 'hold' | 'break';

/** An act: what each faction gains or loses by it, and the Count meter tag of the counted action it is. */
export interface RepActDef {
  readonly counted: RepActTag;
  readonly deltas: readonly RepDelta[];
}

/**
 * Acts that move standing with opposed factions at once (DESIGN 14.4: "raiding a convoy costs Compact rep, defending one
 * costs Reaches rep"; 14.6's convoy run: "escort it (Compact rep) or raid it (Reaches rep)"): the side the act helped
 * gains, the side it went against loses half that. Each is the Count meter's counted action of its name (P2.E22.T01: a
 * convoy escorted Feeds, one raided Breaks), so its gain earns the underdog's bonus while the Count favours that side.
 * DESIGN gives no amounts (tunable; a bounty pays 60, DESIGN 14.8); the convoy run (P2.E21.T05) is the act's source and
 * may scale it by contribution.
 */
export const REP_ACTS = deepFreeze({
  /** a Compact convoy seen safe to its destination */
  convoy_escorted: {
    counted: 'feed',
    deltas: [
      { faction: 'compact', amount: 50 },
      { faction: 'reaches', amount: -25 },
    ],
  },
  /** a Compact convoy raided */
  convoy_raided: {
    counted: 'break',
    deltas: [
      { faction: 'reaches', amount: 50 },
      { faction: 'compact', amount: -25 },
    ],
  },
} as const satisfies Record<string, RepActDef>);
export type RepAct = keyof typeof REP_ACTS;
export const REP_ACT_IDS = Object.keys(REP_ACTS) as RepAct[];

/** Whether `id` is an act REP_ACTS has. */
export function isRepAct(id: string): id is RepAct {
  return Object.hasOwn(REP_ACTS, id);
}

/** What reconciling a stored value with the faction table changed. */
export interface ReputationReconciled {
  reputation: Reputation;
  /** factions the table no longer has (their standing and their ranks' titles are dropped), and `<faction>:<rank>` for
   * ranks it no longer has (their titles are dropped) */
  dropped: string[];
}

/**
 * Brings a stored value in line with the faction table as it is now: standing with a faction the table no longer has is
 * dropped, and so is the title of a rank it no longer has (a rename is a removal; a quest's title stays). Returns the
 * value itself when nothing changed.
 */
export function reconcileReputation(stored: Reputation): ReputationReconciled {
  const dropped = new Set<string>();
  for (const f of Object.keys(stored.rep)) if (!isFaction(f)) dropped.add(f);
  const gone = (t: EarnedTitle) => isRankTitle(t) && titleName(t) === null;
  for (const t of stored.titles) if (isRankTitle(t) && gone(t)) dropped.add(isFaction(t.faction) ? `${t.faction}:${t.rank}` : t.faction);
  if (dropped.size === 0) return { reputation: stored, dropped: [] };
  const rep: Reputation['rep'] = {};
  for (const [f, v] of Object.entries(stored.rep)) if (isFaction(f)) rep[f] = v;
  const titles = stored.titles.filter((t) => !gone(t));
  return { reputation: { rep, titles }, dropped: [...dropped].sort() };
}

// ---------- what the client is sent ----------

/** One faction's standing as the client sees it: its value and the rank it holds (null below the first threshold). */
export const standingViewSchema = z.strictObject({
  faction: factionIdSchema,
  rep: z.int().min(REP_MIN).max(REP_MAX),
  rank: rankIdSchema.nullable(),
});
export type StandingView = z.infer<typeof standingViewSchema>;

/** A title as the client sees it: its name, and a rank's faction and rank or the quest that gave it. */
export const titleViewSchema = z
  .strictObject({
    title: titleSchema,
    faction: factionIdSchema.optional(),
    rank: rankIdSchema.optional(),
    quest: questRefSchema.optional(),
  })
  .refine((t) => (t.faction === undefined) === (t.rank === undefined), 'a rank’s title names its faction and its rank')
  .refine((t) => t.rank === undefined || t.quest === undefined, 'a title is a rank’s or a quest’s');
export type TitleView = z.infer<typeof titleViewSchema>;

/** A title as the client sees it, or null for a rank the table does not have. */
export function titleView(t: EarnedTitle): TitleView | null {
  const title = titleName(t);
  if (title === null) return null;
  if (!isRankTitle(t)) return { ...t };
  return { title, faction: t.faction as FactionId, rank: t.rank };
}

/** A character's reputation as the client sees it: every faction of the table, in its order, and the titles earned. */
export const reputationViewSchema = z.strictObject({
  factions: z.array(standingViewSchema).max(FACTION_IDS.length),
  titles: z.array(titleViewSchema).max(TITLES_MAX),
});
export type ReputationView = z.infer<typeof reputationViewSchema>;

/** The view of a (reconciled) reputation: every faction of the table with its standing and rank, and the titles. */
export function reputationView(r: Reputation): ReputationView {
  const factions = FACTION_IDS.map((faction) => {
    const rep = standingOf(r, faction);
    return { faction, rep, rank: rankIdAt(faction, rep) };
  });
  const titles = r.titles.flatMap((t) => titleView(t) ?? []);
  return { factions, titles };
}
