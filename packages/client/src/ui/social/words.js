// What the chat and party UI says (P1.E15.T03, docs/ARCHITECTURE.md §13, §21): the server's refusals (`denied`), party
// news and beacon news as the player reads them, and the waits and ages it shows. Plain strings only: the views put them
// in the page as text, never as markup.

/** A wait the server gave in whole seconds, as said: "12 s", "2 min". */
export function fmtWait(seconds) {
  const s = Math.max(1, Math.ceil(seconds));
  return s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`;
}

/** How long ago, or how long until, in seconds: "40 s", "6 min", "2 h". */
export function fmtAge(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h`;
}

/** The verb each party request is refused for, as "you cannot … yourself" and "only the leader can …" say it. */
const VERB = { invite: 'invite', accept: 'join', decline: 'decline', leave: 'leave', kick: 'remove', promote: 'promote' };

/** Why the server did not carry out a chat message, party request or beacon request (`denied {of, code, retryS?, name?}`). */
export function deniedText({ of, code, retryS, name }) {
  const wait = retryS === undefined ? '' : fmtWait(retryS);
  const who = name ?? 'That pilot';
  if (of === 'chat') {
    switch (code) {
      case 'rate':
        return wait ? `Slow down: chat again in ${wait}` : 'Slow down';
      case 'busy':
        return wait ? `The shard channel is busy: try again in ${wait}` : 'The shard channel is busy';
      case 'muted':
        return wait ? `You are muted for ${wait}` : 'You are muted';
      case 'no_party':
        return 'You are in no party';
      case 'no_zone':
        return 'System chat reaches no one out here';
    }
  } else if (of in VERB) {
    switch (code) {
      case 'rate':
        return wait ? `Too many invites: invite again in ${wait}` : 'Too many invites';
      case 'not_found':
        return `No one called ${who} is online`;
      case 'self':
        return `You cannot ${VERB[of]} yourself`;
      case 'in_party':
        return of === 'accept' ? 'You are in a party already' : `${who} is in a party already`;
      case 'party_full':
        return of === 'accept' ? `${who}'s party is full` : 'Your party is full';
      case 'pending':
        return `Your invite to ${who} is still waiting`;
      case 'busy':
        return `${who} has too many invites waiting`;
      case 'no_invite':
        return name ? `No invite from ${name} is waiting` : 'No invite is waiting';
      case 'not_member':
        return `${who} is not in your party`;
      case 'offline':
        return `${who} is offline: only an online member can lead`;
      case 'gone':
        return `${who} has gone offline`;
      case 'no_party':
        return 'You are in no party';
      case 'not_leader':
        return `Only the party's leader can ${VERB[of]}`;
    }
  } else {
    // beacon requests: raise, lower, answer, watch
    switch (code) {
      case 'rate':
        return of === 'watch' ? `The list comes back in ${wait || 'a moment'}` : wait ? `Raise another in ${wait}` : 'Too many beacons raised';
      case 'no_phase':
        return 'Raise a beacon from inside a story step, an event or a raid';
      case 'kind':
        return 'No beacon calls aid to this place';
      case 'raised':
        return 'A beacon is up for this instance already';
      case 'busy':
        return 'The shard lists all the beacons it can just now';
      case 'full':
        return of === 'raise' ? 'Your instance has no open slot' : 'No slot is left open';
      case 'unknown':
        return of === 'lower' ? 'You have no beacon up' : 'That beacon has ended';
      case 'self':
        return 'That beacon is your own';
      case 'elsewhere':
        return 'It is in another star system: go there first';
      case 'far':
        return 'Too far: go to its place first';
      case 'in_phase':
        return 'Leave your own instance first';
      case 'in_party':
        return 'You are in another party';
      case 'gone':
        return 'Its caller is away just now';
    }
  }
  return `Refused (${code})`;
}

/**
 * Party news (`event {kind: 'party', what, name?}`) as a line in the log. `me` is the player's own name (a member leaving,
 * joining, kicked or leading may be the player), `inviter` whether `name` had invited the player (an invite that lapsed
 * either way).
 */
export function partyNewsText({ what, name }, me, inviter = false) {
  const self = name !== undefined && name === me;
  switch (what) {
    case 'invite':
      return `${name} invites you to a party`;
    case 'invited':
      return `Invite sent to ${name}`;
    case 'declined':
      return `${name} declined your invite`;
    case 'expired':
      return inviter ? `${name}'s invite lapsed` : `Your invite to ${name} lapsed`;
    case 'joined':
      return self ? 'You joined the party' : `${name} joined the party`;
    case 'left':
      return self ? 'You left the party' : `${name} left the party`;
    case 'kicked':
      return self ? 'You were removed from the party' : `${name} was removed from the party`;
    case 'leader':
      return self ? 'You lead the party now' : `${name} leads the party now`;
    case 'disbanded':
      return 'The party disbanded';
  }
  return null;
}

/** Why a beacon ended, as its caller hears it. */
const ENDED = {
  lowered: 'Your beacon is down',
  full: 'Your beacon is down: every slot is taken',
  closed: 'Your beacon is down: its instance closed',
  left: 'Your beacon is down: you left its instance',
  expired: 'Your beacon lapsed',
};

/** Beacon news (`beacon {op, id, …}`) as a line in the log; `caller` the name of the beacon a `joined` answered, if known. */
export function beaconNewsText(m, caller = null) {
  switch (m.op) {
    case 'raised':
      return `Your beacon is up: ${m.beacon.open} of ${m.beacon.cap} open`;
    case 'answered':
      return `${m.name} answered your beacon`;
    case 'joined':
      return caller ? `You answered ${caller}'s beacon and joined the instance` : 'You answered the beacon and joined the instance';
    case 'ended':
      return ENDED[m.why] ?? 'Your beacon is down';
  }
  return null;
}

/** What each kind of instance is called on a beacon's tag. */
export const KIND_LABEL = { story: 'Story', event: 'Event', raid: 'Raid' };

/** A new beacon in the player's system, as a line in the log. */
export function beaconCallText(b) {
  return `${b.from} calls for aid: ${b.place}, ${b.open} of ${b.cap} open`;
}

/** The slash commands, for /help. */
export const HELP = [
  '/s, /sys, /p: talk to the shard, the system, the party',
  '/invite name · /accept · /decline · /leave',
  '/promote name · /kick name (the leader)',
];
