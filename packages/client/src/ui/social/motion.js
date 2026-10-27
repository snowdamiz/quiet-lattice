// The chat and party UI's layout motion (P1.E15.T03): boxes that open, close, resize or slide, stepped once a frame on
// the HUD's clock rather than left to CSS. Each frame a box moves at least a whole pixel toward where it lands (never a
// frame standing still, never back), on whole pixels only (so no line of text sits half a pixel off and hops as it
// lands), and lands exactly where it lays out. A box closing fades out first, before anything moves over where it was;
// one opening fades in over the later part of its growth.

/** How long a move takes once it starts, and how long a closing box takes to fade out before it moves (ms). */
export const MOVE_MS = 240;
export const OUT_MS = 100;
/** The flex gap a box opening across (a button beside others) also brings. */
const GAP = 4;
/** A frame at 60 fps (ms): a move's first step is at least this far along, so it never stands still on the frame after
 * the one it started in, whenever in that frame it started. */
const FRAME_MS = 1000 / 60;

/** The HUD's ease-out, cubic-bezier(0.2, 0.7, 0.2, 1), as a function of time 0–1. */
export function ease(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const curve = (u, a, b) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (curve(mid, 0.2, 0.2) < t) lo = mid;
    else hi = mid;
  }
  return curve((lo + hi) / 2, 0.7, 1);
}

/** Ease in and out, clamped to 0–1: how opacity goes. */
const smooth = (q) => (q <= 0 ? 0 : q >= 1 ? 1 : q * q * (3 - 2 * q));

/**
 * What a stepped move shows at progress `p` (0–1, of time) from `from` to `to`, having shown `last` the frame before:
 * a whole pixel on the eased curve, but at least one pixel on from `last` toward `to` (never the same as the frame
 * before, never back), never past `to`, and `to` exactly once the time is up. Before it starts (`p` 0) it holds.
 */
export function stepValue(from, to, p, last) {
  if (p <= 0) return last;
  if (p >= 1) return to;
  const goal = Math.round(to);
  const dir = Math.sign(goal - last);
  if (dir === 0) return last;
  let v = Math.round(from + (to - from) * ease(p));
  if ((v - last) * dir < 1) v = last + dir;
  if ((v - goal) * dir > 0) v = goal;
  return v;
}

/** The inline styles a move sets, all taken off once it lands. */
const STYLES = ['height', 'width', 'marginTop', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'];
const BORDERS = ['borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth'];

function clear(e) {
  for (const p of STYLES) e.style[p] = '';
  for (const p of BORDERS) e.style[p] = '';
  e.style.opacity = '';
  e.style.transform = '';
}

const px = (v) => parseFloat(v) || 0;

/** A box's metrics down (its height and what is round it) or across (its width), as it lays out now. */
function metrics(e, kind) {
  const r = e.getBoundingClientRect();
  if (kind === 'height') return { h: r.height };
  const cs = getComputedStyle(e);
  if (kind === 'across') return { w: r.width, pl: px(cs.paddingLeft), pr: px(cs.paddingRight), bl: px(cs.borderLeftWidth), br: px(cs.borderRightWidth) };
  return { h: r.height, mt: px(cs.marginTop), mb: px(cs.marginBottom), pt: px(cs.paddingTop), pb: px(cs.paddingBottom), bt: px(cs.borderTopWidth), bb: px(cs.borderBottomWidth) };
}

/** The room a box takes in the layout: down, its height and margins; across, its width and the gap it brings. */
function footprint(m, kind) {
  if (kind === 'across') return m.w + GAP;
  if (kind === 'height') return m.h;
  return m.h + m.mt + m.mb;
}

/** Sets a box to take exactly `f` of room, its margins, padding and borders shrunk with it in proportion (whole pixels,
 * never more than the box holds). */
function place(e, kind, m, f) {
  if (kind === 'height') {
    e.style.height = `${f}px`;
    return;
  }
  if (kind === 'y') {
    e.style.transform = f ? `translateY(${f}px)` : '';
    return;
  }
  if (kind === 'across') {
    const w = Math.max(0, f - GAP);
    const r = m.w > 0 ? Math.min(1, w / m.w) : 0;
    e.style.marginLeft = `${Math.min(0, f - GAP)}px`;
    e.style.width = `${w}px`;
    e.style.paddingLeft = `${Math.floor(m.pl * r)}px`;
    e.style.paddingRight = `${Math.floor(m.pr * r)}px`;
    e.style.borderLeftWidth = `${Math.floor(m.bl * r)}px`;
    e.style.borderRightWidth = `${Math.floor(m.br * r)}px`;
    return;
  }
  const all = m.h + m.mt + m.mb;
  const k = all > 0 ? Math.min(1, Math.max(0, f / all)) : 0;
  const mt = Math.floor(m.mt * k);
  const mb = Math.floor(m.mb * k);
  const h = Math.max(0, f - mt - mb);
  const r = m.h > 0 ? Math.min(1, h / m.h) : 0;
  e.style.marginTop = `${mt}px`;
  e.style.marginBottom = `${mb}px`;
  e.style.height = `${h}px`;
  e.style.paddingTop = `${Math.floor(m.pt * r)}px`;
  e.style.paddingBottom = `${Math.floor(m.pb * r)}px`;
  e.style.borderTopWidth = `${Math.floor(m.bt * r)}px`;
  e.style.borderBottomWidth = `${Math.floor(m.bb * r)}px`;
}

export class Motion {
  /** `now()` the clock (ms) the moves run on: the HUD's, which a capture runs a frame at a time. */
  constructor(now) {
    this.now = now;
    /** element → its move */
    this.runs = new Map();
  }

  /** Opens `e` from nothing (or from where a close had it) to its own size, down or `across`, fading in as it grows;
   * after `delay` ms (while something closing fades out). */
  reveal(e, { across = false, delay = 0 } = {}) {
    const kind = across ? 'across' : 'down';
    const cur = this.runs.get(e);
    const f0 = cur?.kind === kind ? cur.last : 0;
    const o0 = cur?.o ?? 0;
    this.stop(e);
    const m = metrics(e, kind);
    this.begin(e, { kind, m, f0, f1: footprint(m, kind), o0, o1: 1, delay });
  }

  /** Closes `e`: it fades out first (`OUT_MS`), then shrinks to nothing; `then()` once it is shut (and its styles are
   * taken off after that, so hide or remove it there). */
  conceal(e, then, { across = false } = {}) {
    const kind = across ? 'across' : 'down';
    const cur = this.runs.get(e);
    let m;
    let f0;
    if (cur?.kind === kind) {
      m = cur.m;
      f0 = cur.last;
      this.runs.delete(e);
    } else {
      this.stop(e);
      m = metrics(e, kind);
      f0 = footprint(m, kind);
    }
    this.begin(e, { kind, m, f0, f1: 0, o0: cur?.o ?? 1, o1: 0, delay: OUT_MS, then });
  }

  /** Eases `e`'s height from `from` (px, what it showed before its content changed) to the height it lays out at now;
   * after `delay` ms. */
  resize(e, from, { delay = 0 } = {}) {
    this.stop(e);
    const to = e.getBoundingClientRect().height;
    if (Math.abs(to - from) < 0.5) return;
    this.begin(e, { kind: 'height', m: { h: to }, f0: Math.round(from), f1: to, o0: null, o1: null, delay });
  }

  /**
   * Replaces `e`'s content: what is there fades out where it stands (`OUT_MS`), then `build()` puts the new content in
   * and `e` eases from the height it had to the new one, the new content fading in as it grows. One height moves, so
   * whatever is below moves one way, a pixel or more every frame.
   */
  replace(e, build) {
    const cur = this.runs.get(e);
    const from = cur?.kind === 'height' ? cur.last : e.getBoundingClientRect().height;
    const o0 = cur?.o ?? 1;
    this.stop(e);
    this.begin(e, {
      kind: 'height',
      m: null,
      f0: Math.round(from),
      f1: Math.round(from),
      o0,
      o1: 0,
      delay: OUT_MS,
      start: (r) => {
        build();
        e.style.height = '';
        r.f1 = e.getBoundingClientRect().height;
        e.style.height = `${r.f0}px`;
        r.o0 = 0;
        r.o1 = 1;
      },
    });
  }

  /** Eases `e` up from `rise` px below where it lays out (and from wherever a slide still had it). */
  slide(e, rise) {
    const cur = this.runs.get(e);
    const from = Math.round(rise + (cur?.kind === 'y' ? cur.last : 0));
    this.stop(e);
    if (from) this.begin(e, { kind: 'y', m: null, f0: from, f1: 0, o0: null, o1: null, delay: 0 });
  }

  /** Shows `e` or not: opening or closing it (across: its width) when `animate`, else at once. One closing stays laid
   * out until it is shut, then is `hidden`. */
  toggle(e, show, animate, { across = false, delay = 0 } = {}) {
    const on = e.shownTo ?? !e.hidden;
    if (show === on) return;
    e.shownTo = show;
    if (!animate) {
      this.stop(e);
      e.hidden = !show;
    } else if (show) {
      e.hidden = false;
      this.reveal(e, { across, delay });
    } else this.conceal(e, () => !e.shownTo && (e.hidden = true), { across });
  }

  /** Whether `e` is opening or closing just now. */
  moving(e) {
    return this.runs.has(e);
  }

  /** Stops `e`'s move where it is, and takes its styles off (it lays out as it is). */
  stop(e) {
    if (!this.runs.delete(e)) return;
    clear(e);
    e.classList.remove('sizing');
  }

  begin(e, r) {
    r.at = this.now();
    r.elapsed = 0;
    r.stepped = false;
    r.last = r.f0;
    r.o = r.o0;
    this.runs.set(e, r);
    if (r.kind !== 'y') e.classList.add('sizing');
    place(e, r.kind, r.m, r.f0);
    if (r.o !== null) e.style.opacity = String(r.o);
  }

  /** One frame of every move (the HUD calls it each frame). */
  step() {
    const now = this.now();
    for (const [e, r] of this.runs) {
      // (time since it began, its first step a frame at least)
      r.elapsed += r.stepped ? now - r.at : Math.max(now - r.at, FRAME_MS);
      r.stepped = true;
      r.at = now;
      const p = Math.max(0, Math.min(1, (r.elapsed - r.delay) / MOVE_MS));
      if (p > 0 && r.start) {
        r.start(r);
        r.start = null;
      }
      const f = stepValue(r.f0, r.f1, p, r.last);
      if (f !== r.last) place(e, r.kind, r.m, f);
      r.last = f;
      if (r.o1 !== null) {
        // (a closing box fades out from the start, before it moves; an opening one fades in over the later part of its
        // growth)
        r.o = r.o1 < r.o0 ? r.o0 + (r.o1 - r.o0) * smooth(r.elapsed / OUT_MS) : r.o0 + (r.o1 - r.o0) * smooth((p - 0.25) / 0.75);
        if (r.o1 > r.o0 && p <= 0) r.o = r.o0;
        e.style.opacity = String(r.o);
      }
      if (p < 1) continue;
      this.runs.delete(e);
      r.then?.();
      clear(e);
      e.classList.remove('sizing');
    }
  }
}
