// Distant forests: one point sprite per terrain vertex, kept with a probability set by
// the forest cover the chunk worker wrote into aColor.a. Takes over from the instanced
// trees where those fade out (~400 m), so forests still read from the air. Open ground
// gets a sparse scatter of shrubs the same way.
import * as THREE from 'three';
import { archetype } from '../terrain/planetgen.js';

const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aColor;
uniform float uSpacing;
uniform float uDensity;
uniform float uHeight;
uniform float uPixelScale;
uniform float uFadeIn;
uniform float uFadeOut;
uniform float uConifer;
uniform vec3 uSunDirView;
uniform vec3 uSunCol;
uniform vec3 uAmbCol;
uniform vec3 uCanopyA;
uniform vec3 uCanopyB;
uniform float uShrubDensity;
uniform vec3 uShrubCol;
uniform vec3 uCenterView;
uniform float uRadius;
uniform float uSnowLine;
varying vec3 vCol;
varying float vAlpha;
varying float vConifer;
varying float vShrub;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  float h = hash13(position * 0.37 + 11.0);
  // scatter anywhere within the vertex's cell, along the local slope (so the sprite stays on the
  // ground), in the chunk's own axes: in view axes the offsets swam as the camera turned, and a
  // half-cell scatter still left the terrain grid showing as orchard rows from the air
  vec3 n0 = normalize(normal);
  vec3 a1 = normalize(cross(n0, abs(n0.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 a2 = cross(n0, a1);
  vec3 p = position + (a1 * (fract(h * 91.7) - 0.5) + a2 * (fract(h * 57.3) - 0.5)) * uSpacing;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = length(mv.xyz);
  // expected number of trees this vertex stands for; thin out where that is below one
  float trees = aColor.a * uDensity * uSpacing * uSpacing;
  // outside the forests: the odd shrub or boulder, so open ground is not bare from the air
  float shrubs = (1.0 - aColor.a) * uShrubDensity * uSpacing * uSpacing;
  // (strict comparisons: step() counts a hash of exactly 0 as passing even a zero threshold, and the
  // odd vertex whose hash came out 0 drew a full-size tree right in front of the camera)
  float isTree = h < trees ? 1.0 : 0.0;
  float isShrub = (1.0 - isTree) * (hash13(position * 0.61 + 3.7) < shrubs ? 1.0 : 0.0);
  float fadeIn = isTree > 0.5 ? smoothstep(uFadeIn, uFadeIn + 110.0, dist) : smoothstep(170.0, 230.0, dist);
  // nothing on cliffs or above the snow line
  vec3 radial = normalize(mv.xyz - uCenterView);
  float slope = dot(normalize(normalMatrix * normal), radial);
  float hgt = length(mv.xyz - uCenterView) - uRadius;
  float site = smoothstep(0.8, 0.9, slope) * (1.0 - smoothstep(uSnowLine - 120.0, uSnowLine - 20.0, hgt));
  // fade by thinning: each sprite appears or leaves whole at its own distance, instead of a
  // fractional alpha that alpha-to-coverage would turn into a fixed dither grid
  float fade = fadeIn * (1.0 - smoothstep(uFadeOut * 0.6, uFadeOut, dist));
  float alpha = max(isTree, isShrub) * step(0.5, site) * (fract(h * 23.17) < fade ? 1.0 : 0.0);
  vAlpha = alpha;
  vShrub = isShrub;
  if (alpha < 0.01) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float h2 = fract(h * 7.13);
  float height = isShrub > 0.5
    ? 2.6 * (0.6 + 0.8 * h2) * min(sqrt(max(shrubs, 1.0)), 2.0)
    : uHeight * (0.75 + 0.6 * h2) * min(sqrt(max(trees, 1.0)), 2.2);
  mv.xyz += radial * height * 0.42;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = height * uPixelScale / dist;
  float ndl = max(dot(normalize(normalMatrix * normal), uSunDirView), 0.0);
  vec3 albedo = isShrub > 0.5 ? uShrubCol * (0.75 + 0.5 * fract(h * 3.1)) : mix(uCanopyA, uCanopyB, fract(h * 13.7)) * (0.8 + 0.4 * fract(h * 3.1));
  // dark on the night side, whatever the light where the camera is
  float dayF = smoothstep(-0.2, 0.25, dot(radial, uSunDirView));
  // (lifted to the brightness of the real trees, which also get the sky's image light: without it
  // the distant ones read as black pepper on the sunlit ground)
  vCol = albedo * (uSunCol * (0.25 + 0.75 * ndl) * dayF + uAmbCol * mix(0.05, 1.6, dayF)) * RECIPROCAL_PI * 1.35;
  vConifer = step(fract(h * 5.3), uConifer) * isTree;
  #include <logdepthbuf_vertex>
}
`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vCol;
varying float vAlpha;
varying float vConifer;
varying float vShrub;

// coverage of a shape from its signed distance, antialiased over one pixel
float cover(float sd) {
  float w = max(fwidth(sd), 1e-4);
  return clamp(0.5 - sd / w, 0.0, 1.0);
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  c.y = -c.y;
  float crown;
  float shade;
  if (vShrub > 0.5) {
    // low rounded mound sitting on the ground
    vec2 q = (c - vec2(0.0, -0.22)) * vec2(1.0, 1.7);
    crown = cover(length(q) - 0.36) * cover(-0.5 - c.y);
    shade = 0.7 + 0.9 * (q.y + 0.1) - 0.3 * q.x;
  } else if (vConifer > 0.5) {
    float w = (0.48 - c.y) * 0.42;
    crown = cover(abs(c.x) - w) * cover(-0.32 - c.y) * cover(c.y - 0.48);
    shade = 0.7 + 0.5 * (c.y + 0.32) - 0.3 * c.x;
  } else {
    vec2 q = (c - vec2(0.0, 0.08)) * vec2(1.0, 1.2);
    crown = cover(length(q) - 0.38);
    shade = 0.75 + 0.6 * (q.y + 0.1) - 0.35 * q.x;
  }
  float trunk = cover(abs(c.x) - 0.04) * cover(-0.5 - c.y) * cover(c.y + 0.2) * (1.0 - vShrub);
  // alpha-to-coverage: the distance fade and the soft edges resolve through MSAA
  // instead of a screen-door dither
  float a = max(crown, trunk) * vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(crown >= trunk ? vCol * shade : vCol * 0.3, a);
}
`;

export function createTreePointsMaterial(params) {
  const a = archetype(params.type);
  const C = params.colors;
  const leaf = new THREE.Color(a.floraColors[0]).convertSRGBToLinear();
  const leaf2 = new THREE.Color(a.floraColors[1 % a.floraColors.length]).convertSRGBToLinear();
  const canopyA = new THREE.Vector3(...C.low1).lerp(new THREE.Vector3(leaf.r, leaf.g, leaf.b), 0.45).multiplyScalar(0.9);
  const canopyB = new THREE.Vector3(...C.low2).lerp(new THREE.Vector3(leaf2.r, leaf2.g, leaf2.b), 0.45).multiplyScalar(0.9);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSpacing: { value: 10 },
      // matches the tree scatter in Flora: ~2.5 species at 0.0055 trees per m² each
      uDensity: { value: 0.0055 * 2.5 * params.flora },
      uHeight: { value: 12 },
      uPixelScale: { value: 500 },
      uFadeIn: { value: 250 },
      // thinned out over the last few km (a hard nearer edge drew a line round the woods; dots all the
      // way out peppered the ground seen from altitude)
      uFadeOut: { value: 6000 },
      uConifer: { value: a.treeKinds.includes('conifer') ? 0.5 : 0 },
      uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(3, 3, 3) },
      uAmbCol: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uCanopyA: { value: canopyA },
      uCanopyB: { value: canopyB },
      uShrubDensity: { value: 0.0045 * Math.min(1, params.flora * 1.5) },
      uShrubCol: { value: canopyB.clone().multiplyScalar(0.9) },
      uCenterView: { value: new THREE.Vector3() },
      uRadius: { value: params.radius },
      uSnowLine: { value: params.snowLine },
    },
    vertexShader: vert,
    fragmentShader: frag,
    alphaToCoverage: true,
  });
  return mat;
}
