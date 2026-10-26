// Recording helper (dev only): the HUD is DOM, so a canvas capture leaves it out. This draws it
// over a captured frame: the #hud subtree is cloned with its CSS animations held at the
// recording's clock (their current values inlined), put into an SVG foreignObject with the
// stylesheet and fonts inlined (an SVG image can't load anything itself), and rasterised.

const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600&family=Barlow+Condensed:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Michroma&display=swap';
const META = new Set(['offset', 'computedOffset', 'easing', 'composite']);

async function dataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

async function inlineFonts() {
  let out = '';
  const cache = new Map();
  try {
    const text = await (await fetch(FONT_CSS)).text();
    // Google serves one block per subset, each headed by a comment naming it: keep latin
    for (const block of text.split('/*').filter((b) => b.startsWith(' latin */'))) {
      const face = block.slice(block.indexOf('@font-face'));
      const m = face.match(/url\((https:[^)]+)\)/);
      if (!m) continue;
      if (!cache.has(m[1])) cache.set(m[1], await dataUrl(m[1]));
      out += face.replace(m[1], cache.get(m[1])) + '\n';
    }
  } catch (e) {
    console.warn('HUD capture: fonts not inlined', e);
  }
  return out;
}

export async function createHudCapture(root, width, height) {
  let css = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) css += r.cssText + '\n';
    } catch {
      // the cross-origin font sheet: inlined separately below
    }
  }
  // nothing may animate inside the image (it would start from its first keyframe every frame):
  // running animations are copied in as plain values instead
  const style = `${await inlineFonts()}${css}
#hud *, #hud *::before, #hud *::after { animation: none !important; transition: none !important; }`;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const started = new WeakMap();
  const serializer = new XMLSerializer();

  return {
    canvas,
    // `frame` must be the WebGL canvas straight after rendering (it is copied before any await);
    // `t` is the recording clock in seconds
    async draw(frame, t) {
      ctx.drawImage(frame, 0, 0, width, height);
      const held = [];
      for (const a of root.getAnimations({ subtree: true })) {
        if (!started.has(a)) started.set(a, t);
        a.pause();
        a.currentTime = (t - started.get(a)) * 1000;
        const el = a.effect?.target;
        if (!el || a.effect.pseudoElement) continue;
        const props = new Set();
        for (const k of a.effect.getKeyframes()) for (const p in k) if (!META.has(p)) props.add(p);
        held.push([el, props]);
      }
      held.forEach(([el], i) => el.setAttribute('data-cap', i));
      const clone = root.cloneNode(true);
      held.forEach(([el, props], i) => {
        el.removeAttribute('data-cap');
        const sel = `[data-cap="${i}"]`;
        const c = clone.matches(sel) ? clone : clone.querySelector(sel);
        if (!c) return;
        const cs = getComputedStyle(el);
        for (const p of props) c.style[p] = cs[p];
      });
      // markers are placed in window pixels; the capture is a fixed size
      const kx = width / innerWidth;
      const ky = height / innerHeight;
      for (const m of clone.querySelectorAll('.marker')) {
        const tr = m.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
        if (tr) m.style.transform = `translate(${(tr[1] * kx).toFixed(1)}px, ${(tr[2] * ky).toFixed(1)}px)`;
      }
      // the pulse-drive streaks are a 2D canvas: drawn straight across instead
      const lines = root.querySelector('.speedlines');
      clone.querySelector('.speedlines')?.remove();
      const html = serializer.serializeToString(clone);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${height}px;overflow:hidden;color:#f1f4f8;font-family:Barlow,system-ui,sans-serif;-webkit-font-smoothing:antialiased">` +
        `<style><![CDATA[${style}]]></style>${html}</div></foreignObject></svg>`;
      if (lines && +getComputedStyle(lines).opacity > 0.01) {
        ctx.globalAlpha = +getComputedStyle(lines).opacity;
        ctx.drawImage(lines, 0, 0, width, height);
        ctx.globalAlpha = 1;
      }
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      ctx.drawImage(img, 0, 0);
      return canvas;
    },
  };
}
