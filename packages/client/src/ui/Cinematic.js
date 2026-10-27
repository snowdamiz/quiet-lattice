// A cutscene's presentation over the picture: the letterbox and the dialogue bar in its lower band (speaker, line,
// the keys). Everything here is drawn from the cutscene's state each game frame (CutscenePlayer), never from CSS
// transitions, so it eases on game time: `window.step()` and the grader's captures see exactly what play shows.
// P1.E09.T03 adds the speaker's bust and choices to the same bar.
import { easeOutCubic } from '../cutscene/curve.js';

/** Speaker names in their people's or faction's colour (art bible §4), each lifted where needed to read on black at
 * WCAG AA. */
const VOICE_COLOURS = {
  compact: '#f28c28',
  reaches: '#ff6a3d',
  chorus: '#e8c66a',
  thalune: '#5fc4b6',
  ixari: '#b9a6ff',
  ulgani: '#d9962b',
  hollow: '#9fe8da',
  cartographer: '#d8f6ff',
  self: '#e9e7e2',
};

/** How many characters behind the reveal a character reaches full strength: the reveal is a soft wipe, not a cursor. */
const SOFT_EDGE = 6;
/** Seconds a line takes to rise into place. */
const RISE_SECONDS = 0.35;

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Cinematic {
  constructor(root) {
    this.root = root;
    this.el = el('div', 'cine', root);
    this.top = el('div', 'cine-bar top', this.el);
    this.bottom = el('div', 'cine-bar bottom', this.el);
    // (the line and the keys ride in the lower bar, sliding in and out with it)
    this.say = el('div', 'cine-say', this.bottom);
    this.who = el('div', 'cine-who', this.say);
    this.text = el('div', 'cine-line', this.say);
    this.keys = el('div', 'cine-keys', this.bottom);
    this.keys.innerHTML = '<span><kbd>Space</kbd>Next</span><span><kbd>Esc</kbd>Skip</span>';
    this.el.style.display = 'none';
    this.drawn = { line: null, shown: -1 };
  }

  /**
   * Draws one frame: `k` how closed the letterbox is (0..1, eased), `bar` each bar's height (px) when closed, `line`
   * the line showing (from Timeline.line(), or null), `keys` the keys' opacity.
   */
  render({ k, bar, line, keys }) {
    const on = k > 0.0005;
    this.el.style.display = on ? '' : 'none';
    this.root.classList.toggle('cinematic', on);
    if (!on) {
      this.drawn = { line: null, shown: -1 };
      return;
    }
    // (the bars slide in from the screen's edges; the banner sits clear of them)
    this.el.style.setProperty('--lb', `${bar.toFixed(1)}px`);
    this.root.style.setProperty('--cine-lb', `${bar.toFixed(1)}px`);
    const off = `${((1 - k) * 100).toFixed(2)}%`;
    this.top.style.transform = `translateY(-${off})`;
    this.bottom.style.transform = `translateY(${off})`;
    this.keys.style.opacity = (keys * k).toFixed(3);
    if (!line) {
      this.say.style.opacity = '0';
      return;
    }
    const l = line.line;
    if (this.drawn.line !== l) {
      this.who.textContent = l.speaker;
      this.who.style.color = VOICE_COLOURS[l.voice] ?? VOICE_COLOURS.self;
      this.drawn = { line: l, shown: -1 };
    }
    // (redrawn only when the reveal has moved by an eighth of a character)
    const at = line.reveal === Infinity ? Infinity : Math.round(line.reveal * 8) / 8;
    if (this.drawn.shown !== at) {
      this.drawn.shown = at;
      this.text.innerHTML = revealHtml(l.text, at);
    }
    // a line rises a few pixels into place as it fades in (and fades out where it stands)
    this.say.style.opacity = (line.alpha * k).toFixed(3);
    this.say.style.setProperty('--rise', `${((1 - easeOutCubic(line.since / RISE_SECONDS)) * 6).toFixed(2)}px`);
  }
}

/** The line as revealed up to character position `reveal`: what is through at full strength, the few characters fading
 * in behind the wipe, and the rest laid out but unseen (so the words never move as they appear). */
export function revealHtml(text, reveal) {
  const full = Math.max(0, Math.min(text.length, Math.floor(reveal - SOFT_EDGE)));
  if (full >= text.length) return escape(text);
  let out = escape(text.slice(0, full));
  const end = Math.min(text.length, Math.ceil(reveal));
  for (let j = full; j < end; j++) {
    const a = Math.min(1, Math.max(0, (reveal - j) / SOFT_EDGE));
    out += `<i style="opacity:${a.toFixed(2)}">${escape(text[j])}</i>`;
  }
  if (end < text.length) out += `<i class="unseen">${escape(text.slice(end))}</i>`;
  return out;
}
