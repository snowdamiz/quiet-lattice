// The compass at the top of the HUD: a small ball fixed to the galaxy that turns as you turn, its
// north the edge of space (the nearest way out of the universe), its equator the galactic plane.
// The middle of its face is where you are looking, so the edge's marker drifts round it as you
// steer, and sits dead centre when you face the edge. Drawn by the game's own renderer on top of
// the finished frame; the readouts under it are DOM.
import * as THREE from 'three';
import { edgeBearing } from './map/EdgeOfSpace.js';
import { fmtLy } from '../universe/Cosmos.js';

// css pixels: the ball's box, and its top edge
export const COMPASS_SIZE = 92;
const TOP = 12;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _here = new THREE.Vector3();

const ballVert = /* glsl */ `
  varying vec3 vL;
  varying vec3 vV;
  void main() {
    vL = position;
    vV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// ball-local frame: +z the edge (north), +y galactic up, east is -x
const ballFrag = /* glsl */ `
  uniform vec3 uAccent;
  varying vec3 vL;
  varying vec3 vV;
  const float PI = 3.14159265;
  // coverage of a line of half-width w (in px) at angular distance d, with d's own screen derivative
  float line(float d, float aa, float w) {
    return 1.0 - smoothstep(w * aa, (w + 1.0) * aa, d);
  }
  void main() {
    vec3 L = normalize(vL);
    float lat = asin(clamp(L.y, -1.0, 1.0));
    float lon = atan(-L.x, L.z);
    float cl = max(cos(lat), 0.05);
    // two-tone like an attitude ball: steel above the galactic plane, near-black below
    vec3 col = L.y > 0.0 ? vec3(0.15, 0.19, 0.25) : vec3(0.055, 0.05, 0.048);
    // the side that faces the edge is warmed a little
    col += uAccent * 0.09 * smoothstep(-0.2, 1.0, L.z);
    float step30 = PI / 6.0;
    float aLat = fwidth(lat);
    float aLon = fwidth(lon) * cl;
    float dLat = abs(lat - floor(lat / step30 + 0.5) * step30);
    float dLon = abs(lon - floor(lon / step30 + 0.5) * step30) * cl;
    float grid = max(line(dLat, aLat, 0.25), line(dLon, aLon, 0.25) * (1.0 - smoothstep(0.75, 0.95, abs(L.y))));
    col = mix(col, vec3(0.7, 0.72, 0.76), grid * 0.5);
    // the galactic plane
    col = mix(col, vec3(0.92, 0.91, 0.88), line(abs(lat), aLat, 0.6));
    // the meridian through the edge, in the accent colour
    float dN = abs(lon) * cl;
    col = mix(col, uAccent, line(dN, aLon, 0.7) * (1.0 - smoothstep(0.8, 1.0, abs(L.y))));
    // the edge itself: a diamond on the plane; the way back (the core side): a small ring
    vec2 pN = vec2(lon, lat);
    float dia = abs(pN.x) * cl + abs(pN.y);
    col = mix(col, uAccent * 1.25, 1.0 - smoothstep(0.17, 0.17 + aLat * 1.5, dia));
    vec2 pS = vec2((PI - abs(lon)) * cl, lat);
    float ring = abs(length(pS) - 0.12);
    col = mix(col, vec3(0.85), line(ring, aLat, 0.5));
    // shading: a soft sphere, darker to the rim, with a thin bright edge
    float f = clamp(vV.z, 0.0, 1.0);
    col *= 0.45 + 0.55 * pow(f, 0.6);
    col += vec3(0.5, 0.52, 0.56) * pow(1.0 - f, 6.0) * 0.6;
    // a glint, as off a polished ball lit from the upper left
    col += vec3(0.9, 0.92, 1.0) * pow(max(dot(normalize(vV), normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 40.0) * 0.35;
    // (a soft silhouette: drawn straight to the screen, the rim would otherwise be jagged)
    gl_FragColor = vec4(col, 0.92 * smoothstep(0.0, 0.16, f));
  }`;

function letter(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = "600 44px 'Barlow Condensed', 'Barlow', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, 32, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, transparent: true }));
  s.scale.setScalar(0.36);
  return s;
}

export class EdgeCompass {
  constructor(game, parent) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    this.camera.position.set(0, 0, 4.7);
    // mirrored in depth: the view direction (into the screen) comes out at the middle of the face
    this.flip = new THREE.Group();
    this.flip.scale.set(1, 1, -1);
    this.scene.add(this.flip);
    this.ball = new THREE.Group();
    this.flip.add(this.ball);
    this.ball.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1, 48, 32),
        new THREE.ShaderMaterial({
          vertexShader: ballVert,
          fragmentShader: ballFrag,
          uniforms: { uAccent: { value: new THREE.Color(0.94, 0.64, 0.29) } },
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
    // headings round the galactic plane: N toward the edge, E/W across, S back toward the core
    this.labels = [
      ['N', '#f6b866', 0],
      ['E', '#e9e7e2', 90],
      ['S', '#e9e7e2', 180],
      ['W', '#e9e7e2', 270],
    ].map(([t, c, deg]) => {
      const s = letter(t, c);
      const a = THREE.MathUtils.degToRad(deg);
      s.position.set(-Math.sin(a), 0.24, Math.cos(a)).normalize();
      s.renderOrder = 1;
      this.ball.add(s);
      return s;
    });

    this.el = document.createElement('div');
    this.el.className = 'edge-compass';
    this.el.innerHTML = '<div class="ec-ball"><i class="ec-wings"></i></div><div class="ec-read"><span class="ec-hdg"></span><span class="ec-dist"></span></div>';
    this.el.style.setProperty('--size', `${COMPASS_SIZE}px`);
    this.el.style.top = `${TOP}px`;
    parent.appendChild(this.el);
    this.hdgEl = this.el.querySelector('.ec-hdg');
    this.distEl = this.el.querySelector('.ec-dist');
    this.visible = false;
    this.north = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.east = new THREE.Vector3(0, 0, 1);
  }

  update(show) {
    this.visible = show;
    this.el.style.display = show ? '' : 'none';
    if (!show) return;
    const g = this.game;
    // the frame of the galaxy at the camera: world axes are galactic axes, only shifted
    const dist = edgeBearing(g.universe.toLy(g.camWorld, _here), this.north);
    this.up.set(0, 1, 0).addScaledVector(this.north, -this.north.y).normalize();
    this.east.crossVectors(this.north, this.up);
    // ball-local (x west, y up, z north) to world, then to the camera's view
    _m.makeBasis(_v.copy(this.east).negate(), this.up, this.north);
    _q.setFromRotationMatrix(_m);
    this.ball.quaternion.copy(g.camWorldQuatInv).multiply(_q);
    // labels fade as they turn away round the back
    for (const s of this.labels) {
      _v.copy(s.position).applyQuaternion(this.ball.quaternion);
      // (mirrored: facing the viewer is -z here)
      s.material.opacity = THREE.MathUtils.smoothstep(-_v.z, 0.05, 0.55);
    }
    // heading of the view in the galactic plane, 0 facing the edge, and how far above or below it
    const f = _v.set(0, 0, -1).applyQuaternion(g.camWorldQuat);
    const hdg = (THREE.MathUtils.radToDeg(Math.atan2(f.dot(this.east), f.dot(this.north))) + 360) % 360;
    const inc = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(f.dot(this.up), -1, 1)));
    const h = `${String(Math.round(hdg) % 360).padStart(3, '0')}°<small>${inc >= 0 ? '+' : '−'}${Math.abs(Math.round(inc))}</small>`;
    if (h !== this._h) this.hdgEl.innerHTML = this._h = h;
    const d = `<small>EDGE</small>${fmtLy(dist)}`;
    if (d !== this._d) this.distEl.innerHTML = this._d = d;
  }

  render(renderer) {
    if (!this.visible) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const S = COMPASS_SIZE;
    const x = Math.round((W - S) / 2);
    const y = H - TOP - S;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setViewport(x, y, S, S);
    renderer.setScissor(x, y, S, S);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.autoClear = ac;
  }
}
