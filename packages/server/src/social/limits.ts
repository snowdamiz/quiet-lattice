// Chat, party and beacon limits (P1.E15.T01, T02; docs/ARCHITECTURE.md §13, §21). Chat sits inside the gateway's
// per-socket message budget (60/s, burst 120: gateway/ws.ts) with a far smaller limit of its own, per account so that an
// account's four sockets share it. The party size is ours: DESIGN does not give one. The disconnect grace is the phases'
// (15 s), so a dropped connection keeps its party exactly as long as it keeps its place in a phase. A beacon reaches the
// whole shard, so raising one is rate-limited per account like chat, and a beacon lapses after ten minutes.
import { BEACON_MAX, PARTY_MAX } from '@astra/shared/protocol';
import { PHASE_KINDS } from '../phases/kinds.ts';

export interface SocialLimits {
  /** chat messages an account may send at once, then `chatPerSecond` */
  chatBurst: number;
  chatPerSecond: number;
  /** shard-channel messages from every account together: a burst, then `shardPerSecond` (keeps the shard's fan-out bounded) */
  shardBurst: number;
  shardPerSecond: number;
  /** chat messages refused for rate an account may send (refilled at `floodPerSecond`) before it is muted for `muteS` */
  floodAllowance: number;
  floodPerSecond: number;
  muteS: number;
  /** invites an account may send at once, then `invitePerSecond` */
  inviteBurst: number;
  invitePerSecond: number;
  /** an invite lapses after this long */
  inviteTtlMs: number;
  /** pending invites one character may hold; more are refused as `busy` */
  maxInvitesHeld: number;
  /** characters in one party */
  partyMax: number;
  /** a member whose connection dropped keeps its place this long, then leaves the party */
  graceMs: number;
  /** how often the social timer runs: invites lapse, and the parties due are refreshed */
  tickMs: number;
  /** every party is refreshed (graces checked, tags checked, state sent if it changed) once this often, spread over the ticks */
  refreshMs: number;
  /** beacons an account may raise at once, then `beaconPerSecond` */
  beaconBurst: number;
  beaconPerSecond: number;
  /** a beacon lapses this long after it is raised, seconds of world time */
  beaconTtlS: number;
  /** beacons up on the shard at once; more are refused as `busy` */
  beaconMax: number;
}

export const SOCIAL_LIMITS: Readonly<SocialLimits> = Object.freeze({
  chatBurst: 5,
  chatPerSecond: 1,
  shardBurst: 20,
  shardPerSecond: 10,
  floodAllowance: 10,
  floodPerSecond: 1 / 3,
  muteS: 60,
  inviteBurst: 5,
  invitePerSecond: 0.1,
  inviteTtlMs: 60_000,
  maxInvitesHeld: 8,
  partyMax: PARTY_MAX,
  graceMs: PHASE_KINDS.story.graceS * 1000,
  tickMs: 100,
  refreshMs: 1000,
  beaconBurst: 3,
  beaconPerSecond: 1 / 30,
  beaconTtlS: 600,
  beaconMax: BEACON_MAX,
});
