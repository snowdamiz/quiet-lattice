// The dialogue bar's reveal: a soft wipe over the line, the words laid out from the start (so nothing moves as it
// appears), the whole line once revealed, and the text always escaped.
import { describe, expect, it } from 'vitest';
import { revealHtml } from './Cinematic.js';

const strip = (html) => html.replace(/<[^>]+>/g, '');

describe('revealHtml', () => {
  it('lays the whole line out at every step of the reveal', () => {
    const text = 'Hold where you are.';
    for (const r of [0, 0.5, 3, 7.25, 12, 19, 30, Infinity]) expect(strip(revealHtml(text, r))).toBe(text);
  });

  it('shows nothing before the reveal, fades the characters just behind it in, and ends as plain text', () => {
    expect(revealHtml('Hello', 0)).toBe('<i class="unseen">Hello</i>');
    const mid = revealHtml('Hello there', 4);
    expect(mid).toMatch(/^<i style="opacity:0\.67">H<\/i><i style="opacity:0\.50">e<\/i>/);
    expect(mid).toContain('<i class="unseen">o there</i>');
    expect(revealHtml('Hello', 11)).toBe('Hello');
    expect(revealHtml('Hello', Infinity)).toBe('Hello');
  });

  it('escapes the line', () => {
    expect(revealHtml('<b>&"', Infinity)).toBe('&lt;b&gt;&amp;&quot;');
  });
});
