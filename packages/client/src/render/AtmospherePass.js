// Fullscreen pass that reconstructs distance from the logarithmic depth buffer
// and composites, per planet: oceans (or lava seas), volumetric clouds and
// Rayleigh/Mie atmospheric scattering. Planets are processed far-to-near.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SIMPLEX3 } from './glsl.js';
import { getNoise3D, getNoise3DMipmapped, getBlueNoise } from './textures.js';

export const MAX_PLANETS = 4;

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const frag = /* glsl */ `
precision highp float;
precision highp sampler3D;
#define MAXP ${MAX_PLANETS}

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler3D tNoise;
uniform sampler3D tNoiseMip;
uniform sampler2D tBlue;
uniform float uPixelAngle;
uniform float uStarVis;
uniform mat4 uCamWorld;
uniform vec2 uTanFov;
uniform float uFar;
uniform float uTime;
uniform vec3 uSunPos;
uniform vec3 uSunLight;
uniform float uSunSky;
uniform int uCount;
uniform vec3 uCenter[MAXP];
uniform float uRadius[MAXP];
uniform float uCamDist[MAXP];
uniform float uAtmoTop[MAXP];
uniform vec3 uScatter[MAXP];
uniform float uFalloff[MAXP];
uniform float uMie[MAXP];
uniform float uOcean[MAXP];
uniform vec3 uWaterShallow[MAXP];
uniform vec3 uWaterDeep[MAXP];
uniform float uWaterEmissive[MAXP];
uniform mat3 uRot[MAXP];
uniform float uClouds[MAXP];
uniform vec3 uCloudColor[MAXP];
// light tint of a hostile sky (rgb) and how much of it the haze takes too (a: from outside it)
uniform vec4 uAirTint[MAXP];
uniform float uCloudBase[MAXP];
uniform float uCloudTop[MAXP];
uniform float uCloudSeed[MAXP];
uniform float uCloudQuality;
uniform int uMarchPlanet;
uniform vec2 uJitter;
uniform sampler2D tCloud;
uniform sampler2D tCloudInfo;

varying vec2 vUv;

${SIMPLEX3}

// ---------- atmosphere helpers (normalized units: sea radius == 1) ----------
vec2 lightDepth(vec3 p, vec3 sd, float top, float H, float fall) {
  float b = dot(p, sd);
  float pp = dot(p, p);
  float c = pp - top * top;
  float tTop = -b + sqrt(max(b * b - c, 0.0));
  float shadow = 1.0;
  if (b < 0.0) {
    float closest = sqrt(max(pp - b * b, 0.0));
    shadow = smoothstep(0.985, 1.004, closest);
  }
  const int M = 6;
  float ds = tTop / float(M);
  float oR = 0.0;
  float oM = 0.0;
  for (int k = 0; k < M; k++) {
    vec3 q = p + sd * (ds * (float(k) + 0.5));
    float hh = clamp((length(q) - 1.0) / H, 0.0, 1.0);
    float base = (1.0 - hh) * ds;
    oR += exp(-hh * fall) * base;
    oM += exp(-hh * fall * 3.0) * base;
  }
  float block = (1.0 - shadow) * 60.0;
  return vec2(oR + block, oM + block);
}

vec3 sunTransmittance(int i, vec3 p, vec3 sunDir) {
  float top = uAtmoTop[i];
  if (top <= 1.0) return vec3(1.0);
  float H = top - 1.0;
  vec2 ld = lightDepth(p, sunDir, top, H, uFalloff[i]);
  return exp(-(uScatter[i] * ld.x + uMie[i] * 1.1 * ld.y));
}

vec3 atmosphere(int i, vec3 rd, vec3 C, float camH, vec3 sunDir, float sd, vec3 col, float jitter) {
  float top = uAtmoTop[i];
  float b = dot(-C, rd);
  float cc = camH * camH - top * top;
  float h = b * b - cc;
  if (h < 0.0) return col;
  h = sqrt(h);
  float t0 = max(0.0, -b - h);
  float t1 = min(-b + h, sd);
  // the ray reaches a body out beyond the atmosphere (a moon, the station)
  bool beyond = sd < 1e5 && sd > -b + h;
  // clip against the solid planet (in case terrain is not loaded / far side)
  float cs = camH * camH - 0.985 * 0.985;
  float hs = b * b - cs;
  if (hs > 0.0) {
    float ts = -b - sqrt(hs);
    if (ts > 0.0) t1 = min(t1, ts);
  }
  if (t1 <= t0) return col;
  const int N = 18;
  float ds = (t1 - t0) / float(N);
  vec3 scat = uScatter[i];
  float mie = uMie[i];
  float H = top - 1.0;
  float fall = uFalloff[i];
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  for (int k = 0; k < N; k++) {
    // half a step of jitter: enough to break up banding without sky-wide grain
    float t = t0 + ds * (float(k) + 0.5 + (jitter - 0.5) * 0.5);
    vec3 p = rd * t - C;
    float r = length(p);
    float hh = clamp((r - 1.0) / H, 0.0, 1.0);
    float dR = exp(-hh * fall) * (1.0 - hh);
    float dM = exp(-hh * fall * 3.0) * (1.0 - hh);
    odR += dR * ds;
    odM += dM * ds;
    vec2 ls = lightDepth(p, sunDir, top, H, fall);
    vec3 tau = scat * (odR + ls.x) + mie * 1.1 * (odM + ls.y);
    vec3 att = exp(-tau);
    sumR += dR * att * ds;
    sumM += dM * att * ds;
  }
  float mu = dot(rd, sunDir);
  float phR = 0.0596831 * (1.0 + mu * mu);
  float g = 0.8;
  float g2 = g * g;
  float phM = 0.1193662 * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
  // + an isotropic share standing in for multiple scattering, so the sky away from the sun stays blue
  vec3 inscatter = (sumR * scat * (phR + 0.045) + sumM * mie * phM) * uSunSky;
  // faint airglow so nights are not pitch black
  inscatter += (odR * 0.012) * normalize(scat + 0.001) * 0.6;
  inscatter *= mix(vec3(1.0), uAirTint[i].rgb, uAirTint[i].a);
  vec3 trans = exp(-(scat * odR + mie * 1.1 * odM));
  // artistic aerial perspective: nearby geometry stays crisp, distant terrain melts into the sky
  if (sd < 1e5) {
    float R = uRadius[i];
    // keep more surface haze when looking down from high up, less in the low-level near field
    float kMin = mix(0.3, 0.45, smoothstep(0.0, top - 1.0, camH - 1.0));
    // full haze by ~14 km: the horizon a few km out should melt into the sky, which also hides how
    // sharply a small planet curves away below a low flight
    float k = mix(kMin, 1.0, smoothstep(0.0, 10000.0 / R, t1 - t0));
    inscatter *= k;
    trans = pow(trans, vec3(k));
    // less sky in front of a moon than around it: physically the same, but the full amount washes
    // its dark seas out to exactly the sky colour, and the moon reads as see-through
    if (beyond) inscatter *= 0.55;
  }
  // daylight sky hides stars/nebula behind it, but not the sun's own disk
  if (sd > 1e5) trans *= mix(exp(-dot(inscatter, vec3(0.3, 0.5, 0.2)) * 90.0), 1.0, smoothstep(1.5, 4.0, dot(col, vec3(0.3, 0.5, 0.2))));
  return col * trans + inscatter;
}

// ---------- ocean ----------
float waveHeight(vec3 m, float t) {
  float a = texture(tNoise, m * (1.0 / 57.0) + vec3(t * 0.011, 0.0, t * 0.007)).a;
  float b = texture(tNoise, m * (1.0 / 13.0) + vec3(-t * 0.021, t * 0.017, 0.0)).a;
  float c = texture(tNoise, m * (1.0 / 3.7) + vec3(0.0, -t * 0.05, t * 0.04)).a;
  return a * 0.6 + b * 0.3 + c * 0.1;
}

vec3 ocean(int i, vec3 rd, vec3 C, float camH, vec3 sunDir, inout float sd, vec3 col, inout bool under) {
  float R = uRadius[i];
  float b = dot(-C, rd);
  float cc = (camH - 1.0) * (camH + 1.0);
  float h = b * b - cc;
  if (camH >= 1.0) {
    if (h < 0.0) return col;
    h = sqrt(h);
    float t0 = -b - h;
    if (t0 <= 0.0 || t0 >= sd) return col;
    float depthM = (sd - t0) * R;
    vec3 p = rd * t0 - C;
    vec3 n0 = normalize(p);
    vec3 m = uRot[i] * (p * R);
    float distM = t0 * R;
    float lava = uWaterEmissive[i];
    // wave normal from central differences of the wave field
    float waveAmt = exp(-distM / 420.0);
    vec3 n = n0;
    if (waveAmt > 0.01) {
      float e = 0.6;
      float hc = waveHeight(m, uTime);
      vec3 tx = normalize(cross(n0, vec3(0.0, 1.0, 0.0) + vec3(1e-3, 0.0, 0.0)));
      vec3 ty = cross(n0, tx);
      vec3 mlx = uRot[i] * tx;
      vec3 mly = uRot[i] * ty;
      float hx = waveHeight(m + mlx * e, uTime);
      float hy = waveHeight(m + mly * e, uTime);
      float strength = mix(1.6, 0.4, lava);
      n = normalize(n0 - (tx * (hx - hc) + ty * (hy - hc)) * strength * waveAmt / e);
    }
    vec3 sunT = sunTransmittance(i, p, sunDir);
    vec3 sunL = (uSunLight * uAirTint[i].rgb) * sunT;
    float NdL = max(dot(n, sunDir), 0.0);
    float day = smoothstep(-0.12, 0.15, dot(n0, sunDir));
    vec3 surf;
    float alpha;
    if (lava > 0.5) {
      float crust = texture(tNoise, m * (1.0 / 140.0) + vec3(uTime * 0.002)).r;
      float crust2 = texture(tNoise, m * (1.0 / 31.0) - vec3(uTime * 0.004)).g;
      // mostly cooled dark crust with glowing cracks; the pattern averages out with distance
      float hot = smoothstep(0.5, 0.3, crust * 0.7 + crust2 * 0.3);
      hot = mix(hot, 0.22, smoothstep(3000.0, 25000.0, distM));
      vec3 glow = mix(uWaterDeep[i] * 0.5, uWaterShallow[i] * 2.4, hot) * (1.0 + 0.35 * sin(uTime * 0.7 + crust * 20.0));
      vec3 rock = vec3(0.035, 0.028, 0.026) * (NdL * sunL * 0.4 + 0.02);
      surf = mix(rock, glow, smoothstep(0.1, 0.6, hot)) + glow * 0.08;
      alpha = 1.0;
    } else {
      vec3 water = mix(uWaterShallow[i], uWaterDeep[i], 1.0 - exp(-depthM * 0.035));
      vec3 refl = reflect(rd, n);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
      float shin = mix(900.0, 25.0, smoothstep(2000.0, 60000.0, distM));
      float rs = max(dot(refl, sunDir), 0.0);
      float spec = pow(rs, shin) * (shin + 8.0) * 0.0398 * 0.3 + pow(rs, 40.0) * 0.025;
      // seen from altitude the glitter spreads wide and soft; at full strength it bloomed into a
      // second sun sitting on the sea under the ship
      spec *= mix(1.0, 0.3, smoothstep(3000.0, 30000.0, distM));
      // reflected sky: blue overhead, paler (but still blue) toward the horizon, and warm only
      // around the sun's own reflection, so distant water never turns to a cream or orange sheet
      vec3 scatN = normalize(uScatter[i] + 0.01);
      vec3 skyTint = mix(scatN * 0.7 + 0.22, scatN * 1.1, smoothstep(0.0, 0.5, max(dot(refl, n0), 0.0)));
      float sunLum = dot(sunL, vec3(0.3, 0.5, 0.2));
      vec3 skyCol = (skyTint * sunLum * 0.42 + sunL * 0.1 * pow(max(dot(refl, sunDir), 0.0), 6.0)) * day + 0.006;
      vec3 diffuse = water * (NdL * sunL * 0.35 + 0.025 * day + 0.004);
      surf = mix(diffuse, skyCol, fres) + spec * sunL * day;
      surf += water * uWaterEmissive[i] * 0.4;
      // shoreline foam
      float foamN = texture(tNoise, m * (1.0 / 6.0) + vec3(uTime * 0.03)).b;
      // (a thin lapping line: from the air, wide noisy foam read as white blotches round the lakes)
      float foam = (1.0 - smoothstep(0.0, 0.5 + foamN * 0.6, depthM)) * smoothstep(0.4, 0.8, foamN + 0.3 * sin(uTime * 1.3 + depthM * 4.0));
      foam *= exp(-distM / 350.0);
      surf = mix(surf, vec3(0.85) * (sunL * NdL * 0.3 + 0.03), foam * 0.55 * day);
      // underwater terrain absorption
      col *= exp(-depthM * vec3(0.6, 0.14, 0.08));
      // from far away even shallow shelves read as sea, not as pale sand
      alpha = clamp(1.0 - exp(-depthM * mix(0.45, 1.5, smoothstep(800.0, 12000.0, distM))), 0.0, 1.0);
      alpha = max(alpha, fres);
    }
    col = mix(col, surf, alpha);
    sd = t0;
    return col;
  }
  // camera underwater
  under = true;
  float t1 = -b + sqrt(max(h, 0.0));
  float tEnd = min(sd, t1);
  float dm = tEnd * R;
  vec3 up = normalize(-C);
  float day = smoothstep(-0.1, 0.2, dot(up, sunDir));
  vec3 fogCol = uWaterDeep[i] * (0.15 + 1.3 * day) * (uSunLight * uAirTint[i].rgb) * 0.25 + uWaterShallow[i] * uWaterEmissive[i];
  if (sd > t1) {
    // looking up at the surface from below: bright, wavy
    float w = waveHeight(uRot[i] * ((rd * t1 - C) * R), uTime);
    col = mix(col * 0.6, uWaterShallow[i] * (uSunLight * uAirTint[i].rgb) * 0.6 * day * (0.6 + w), 0.6);
  }
  col *= exp(-dm * vec3(0.3, 0.09, 0.05));
  col = mix(col, fogCol, 1.0 - exp(-dm * 0.045));
  sd = tEnd;
  return col;
}

// ---------- volumetric clouds ----------
// All cloud noise is read with an explicit mip level picked from the pixel footprint, so
// distant clouds filter smoothly instead of aliasing into moire.
float noiseLod(float distM, float scaleM) {
  return log2(max(1.0, distM * uPixelAngle * 64.0 / scaleM));
}

float cloudCoverage(vec3 lp, float cov, float seed, float R) {
  // weather systems keep their size in kilometres on bigger worlds (see TerrainSampler)
  float f = sqrt(max(1.0, R / 32000.0));
  float w = snoise(lp * (2.2 * f) + seed) * 0.6 + snoise(lp * (6.5 * f) + seed * 1.7) * 0.28 + 0.5;
  // (short of a full overcast even in a weather system's core: broken cumulus with sky between,
  // rather than one lid over a whole landing site)
  return 0.84 * smoothstep(1.0 - cov - 0.1, 1.0 - cov + 0.35, w);
}

float cloudShape(vec3 m, float distM) {
  vec3 wind = vec3(uTime * 6.0, 0.0, uTime * 3.0);
  return textureLod(tNoiseMip, (m + wind) * (1.0 / 9000.0), noiseLod(distM, 9000.0)).r * 0.62 +
    textureLod(tNoiseMip, (m + wind) * (1.0 / 3700.0) + 0.31, noiseLod(distM, 3700.0)).r * 0.26 +
    textureLod(tNoiseMip, (m + wind) * (1.0 / 1500.0) + 0.57, noiseLod(distM, 1500.0)).r * 0.12;
}

float cloudDensity(int i, vec3 p, float base, float top, float cov, float seed, float distM, out float hgt, out float cpOut) {
  float r = length(p);
  hgt = (r - base) / (top - base);
  cpOut = 0.0;
  if (hgt < 0.0 || hgt > 1.0) return 0.0;
  vec3 lp = uRot[i] * p;
  float c = cloudCoverage(lp, cov, seed, uRadius[i]);
  cpOut = c;
  // cumulus profile: rounded tops over a fairly flat base, whose height varies with the coverage
  // (thin cloud sits higher) so the whole deck does not end on one razor-straight plane; the tops
  // vary too (only the thick cores reach the top of the deck), so clouds seen from the side are
  // domes rather than slabs cut off along one level
  // (and under a full overcast, where that offset goes to nothing, a broad swell in the base keeps
  // the underside from reading as a flat lid with a ruler-straight edge)
  vec3 m = lp * uRadius[i];
  float swell = textureLod(tNoiseMip, m * (1.0 / 2600.0) + 0.71, noiseLod(distM, 2600.0)).r;
  float b0 = 0.18 * (1.0 - c) + 0.16 * swell;
  float t1 = mix(0.5, 1.0, smoothstep(0.3, 0.95, c));
  float prof = smoothstep(b0, b0 + 0.16, hgt) * smoothstep(t1, t1 * 0.35, hgt);
  float cp = c * prof;
  if (cp < 0.02) return 0.0;
  float d = clamp((cloudShape(m, distM) - (1.0 - cp)) / max(cp, 0.05), 0.0, 1.0);
  if (d <= 0.0) return 0.0;
  // erode the rims with fine worley noise: wispy edges around solid cores
  vec3 wind = vec3(uTime * 9.6, 0.0, uTime * 4.8);
  vec4 det = textureLod(tNoiseMip, (m + wind) * (1.0 / 1300.0), noiseLod(distM, 1300.0));
  float erode = mix(det.g, det.b, smoothstep(0.2, 0.8, hgt));
  d = clamp(d - erode * 0.5 * (1.0 - d) * (1.0 - 0.5 * d), 0.0, 1.0);
  // close up, a finer octave turns smooth rims into billows
  float nearK = 1.0 - smoothstep(9000.0, 22000.0, distM);
  if (nearK > 0.0 && d > 0.0 && d < 0.95) {
    vec4 det2 = textureLod(tNoiseMip, (m + wind * 1.4) * (1.0 / 520.0) + 0.17, noiseLod(distM, 520.0));
    d = clamp(d - mix(det2.g, det2.b, hgt) * 0.3 * (1.0 - d) * nearK, 0.0, 1.0);
  }
  // ease density in from zero so rims fade instead of ending on a grainy hard edge, and thin it
  // out towards each cloud's own base: seen from below a dense bottom read as a flat sheet
  return d * d * (3.0 - 2.0 * d) * smoothstep(0.0, 0.3, hgt + 0.15) * mix(0.35, 1.0, smoothstep(b0, b0 + 0.3, hgt));
}

// cheap density for light marching: reuses the coverage of the parent sample
float cloudDensityLight(int i, vec3 p, float base, float top, float c, float distM) {
  float r = length(p);
  float hgt = (r - base) / (top - base);
  if (hgt < 0.0 || hgt > 1.0) return 0.0;
  vec3 m = (uRot[i] * p) * uRadius[i];
  float swell = textureLod(tNoiseMip, m * (1.0 / 2600.0) + 0.71, noiseLod(distM, 2600.0)).r;
  float b0 = 0.18 * (1.0 - c) + 0.16 * swell;
  float t1 = mix(0.5, 1.0, smoothstep(0.3, 0.95, c));
  float prof = smoothstep(b0, b0 + 0.16, hgt) * smoothstep(t1, t1 * 0.35, hgt);
  float cp = c * prof;
  if (cp < 0.02) return 0.0;
  return clamp((cloudShape(m, distM) - (1.0 - cp)) / max(cp, 0.05), 0.0, 1.0);
}

float hgPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

// 2D density of the deck at a point (unit-sphere coords), with eroded, wispy rims
float layerDensity(vec3 lp, float R, float cov, float seed, float distM) {
  float c = cloudCoverage(lp, cov, seed, R);
  vec3 m = lp * R;
  float d = clamp((cloudShape(m, distM) - (1.0 - c)) / max(c, 0.05), 0.0, 1.0);
  vec3 wind = vec3(uTime * 9.6, 0.0, uTime * 4.8);
  float det = textureLod(tNoiseMip, (m + wind) * (1.0 / 1300.0), noiseLod(distM, 1300.0)).g;
  return clamp(d - det * 0.5 * (1.0 - d) * (1.0 - d), 0.0, 1.0);
}

// Seen from far above, the deck is drawn as a single shaded layer: smooth edges, and it
// can never poke out past the atmosphere's rim.
vec4 cloudLayer(int i, vec3 rd, vec3 C, float camH, vec3 sunDir, float sd, float cov, float seed, vec3 cloudCol, out float tHit) {
  tHit = -1.0;
  float rMid = mix(uCloudBase[i], uCloudTop[i], 0.5);
  float b = dot(-C, rd);
  float h = b * b - (camH * camH - rMid * rMid);
  if (h < 0.0) return vec4(0.0);
  float t = -b - sqrt(h);
  if (t <= 0.0 || t >= sd) return vec4(0.0);
  tHit = t;
  vec3 p = rd * t - C;
  vec3 lp = uRot[i] * p;
  float distM = t * uRadius[i];
  float d = layerDensity(lp, uRadius[i], cov, seed, distM);
  float dens = smoothstep(0.0, 0.7, d);
  vec3 n = normalize(p);
  float ndl = dot(n, sunDir);
  float day = smoothstep(-0.15, 0.12, ndl);
  vec3 sunL = (uSunLight * uAirTint[i].rgb) * sunTransmittance(i, n * uCloudTop[i], sunDir) * day;
  vec3 amb = (normalize(uScatter[i] + 0.01) * 0.5 + 0.35) * (0.05 + 0.25 * day) * length(uSunLight * uAirTint[i].rgb) * 0.3 + 0.004;
  // thick cores read brighter and rounder; thin edges pick up the sky colour
  vec3 lit = cloudCol * (sunL * (0.25 + 0.75 * max(ndl, 0.0)) * (0.3 + 0.55 * d) + amb * (0.6 + 0.8 * d));
  return vec4(lit, dens);
}

// fraction of sunlight the cloud deck lets through to a point on the surface
float cloudShadow(int i, vec3 ps, vec3 sunDir, float cov, float seed, float distM) {
  vec3 n = normalize(ps);
  float rMid = mix(uCloudBase[i], uCloudTop[i], 0.5);
  float mu = dot(n, sunDir);
  float cosZ = max(mu, 0.35);
  vec3 pc = ps + sunDir * ((rMid - length(ps)) / cosZ);
  float d = layerDensity(uRot[i] * pc, uRadius[i], cov, seed, distM);
  // with a low sun the sky's own light dominates, so shadows soften away instead of
  // stretching into long black slabs; from high above they fade into the haze too
  return 1.0 - 0.5 * smoothstep(0.15, 0.55, mu) * smoothstep(0.0, 0.7, d) * (1.0 - smoothstep(8000.0, 30000.0, distM));
}

// Where a ray runs through the deck ([tStart, tEnd], planet radii), how much of it the flat far
// layer takes over (w2d) and how much fades into the limb haze. False when it misses the deck.
bool cloudSpan(int i, vec3 rd, vec3 C, float camH, float sd, out float tStart, out float tEnd, out float limbFade, out float w2d) {
  float base = uCloudBase[i];
  float top = uCloudTop[i];
  float b = dot(-C, rd);
  float hb = b * b - (camH * camH - base * base);
  float ht = b * b - (camH * camH - top * top);
  tStart = 0.0;
  tEnd = 0.0;
  limbFade = 1.0;
  w2d = 0.0;
  if (ht < 0.0) return false;
  // seen from above, decks beyond the horizon would stand out against space as floating
  // plates (the deck is thick next to a small planet); let them sink into the limb haze.
  // Well above the deck, cloud on any ray that misses the planet goes (a grey slab stood up
  // past the limb); just over the deck the distant cloud sea beyond the horizon stays.
  float high = camH > top ? smoothstep(top + 300.0 / uRadius[i], top + 1800.0 / uRadius[i], camH) : 0.0;
  if (camH > top && sd > 1e4 && b < 0.0) {
    limbFade = mix(1.0 - smoothstep(1.0, base, sqrt(max(camH * camH - b * b, 0.0))), 0.0, high);
  }
  float sqt = sqrt(ht);
  float tTop0 = -b - sqt;
  float tTop1 = -b + sqt;
  bool hitInner = hb > 0.0;
  float sqb = hitInner ? sqrt(hb) : 0.0;
  float tB0 = -b - sqb;
  float tB1 = -b + sqb;
  if (camH < base) {
    tStart = tB1;
    tEnd = tTop1;
  } else if (camH < top) {
    tStart = 0.0;
    tEnd = (hitInner && tB0 > 0.0) ? tB0 : tTop1;
  } else {
    tStart = tTop0;
    tEnd = (hitInner && tB0 > 0.0) ? tB0 : tTop1;
  }
  tStart = max(tStart, 0.0);
  tEnd = min(tEnd, sd);
  if (tEnd <= tStart) return false;
  // only decks well beyond the horizon sink into the haze; just over the deck, nearby cloud
  // just above the horizon line stays solid (otherwise the horizon draws a seam through it)
  limbFade = mix(1.0, limbFade, max(smoothstep(6000.0, 18000.0, tStart * uRadius[i]), high));
  // the same, from well above, for deck over the far ground and sea just short of the horizon:
  // the planet curves away so fast there that it stood up as flat white strips (it fades to
  // the value the sky side has at the horizon line, so the two meet without a seam)
  if (camH > top && sd <= 1e4) {
    float hz = sqrt(camH * camH - 1.0);
    limbFade *= 1.0 - high * smoothstep(0.55 * hz, 0.85 * hz, sd);
  }
  if (limbFade <= 0.0) return false;
  // from above, hand distant clouds over to the flat layer
  w2d = camH > top ? smoothstep(9000.0, 16000.0, tStart * uRadius[i]) : 0.0;
  return true;
}

// Ray-marched deck: (in-scattered light, transmittance) and the distance of the first cloud hit.
vec4 cloudVolume(int i, vec3 rd, vec3 C, float camH, vec3 sunDir, float sd, float jitter, out float firstHit) {
  firstHit = -1.0;
  float tStart;
  float tEnd;
  float limbFade;
  float w2d;
  if (!cloudSpan(i, rd, C, camH, sd, tStart, tEnd, limbFade, w2d) || w2d >= 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float base = uCloudBase[i];
  float top = uCloudTop[i];
  float R = uRadius[i];
  float maxLen = 70000.0 / R;
  float distStart = tStart * R;
  float cov = uClouds[i];
  float seed = uCloudSeed[i];
  vec3 cloudCol = uCloudColor[i];

  float mu = dot(rd, sunDir);
  // forward-scattering silver lining plus a soft back-scatter lobe
  // (a big isotropic share: thick clouds scatter many times and look white from any side)
  float phase = (mix(hgPhase(mu, 0.6), hgPhase(mu, -0.25), 0.35) * 0.5 + 0.0796 * 0.5) * 11.0;
  vec3 pMid = rd * mix(tStart, tEnd, 0.5) - C;
  vec3 sunT = sunTransmittance(i, normalize(pMid) * ((base + top) * 0.5), sunDir);
  float day = smoothstep(-0.15, 0.12, dot(normalize(pMid), sunDir));
  vec3 sunL = (uSunLight * uAirTint[i].rgb) * sunT * day;
  vec3 amb = (normalize(uScatter[i] + 0.01) * 0.5 + 0.35) * (0.05 + 0.25 * day) * length(uSunLight * uAirTint[i].rgb) * 0.3 + 0.004;

  float len = min(tEnd - tStart, maxLen);
  // coarse steps through empty air, then back up and refine once a cloud is found
  int steps = int(mix(24.0, 40.0, uCloudQuality));
  // floors on both steps: a short ray (flying in the deck, looking out through its top) would
  // otherwise take steps of a few metres and run out of iterations long before leaving the cloud
  float dsC = max(len / float(steps), 120.0 / R);
  float dsF = max(dsC * mix(0.2, 0.33, smoothstep(2000.0, 12000.0, distStart)), 30.0 / R);
  float tMax = tStart + len;
  // near the camera the steps shrink with distance, so the first samples are not spread over
  // a whole coarse step (neighbouring pixels would land at unrelated depths)
  float nearK = 0.1;
  float minStep = 20.0 / R;
  float t = tStart + min(dsC, max(minStep, tStart * nearK)) * jitter;
  float ds = dsC;
  bool fine = false;
  int empty = 0;
  float T = 1.0;
  vec3 L = vec3(0.0);
  float lightStep = 200.0 / R;
  for (int k = 0; k < 72; k++) {
    if (t > tMax) break;
    float st = min(ds, max(minStep, t * nearK));
    vec3 p = rd * t - C;
    float distM = t * R;
    float hgt;
    float cpv;
    float d = cloudDensity(i, p, base, top, cov, seed, distM, hgt, cpv);
    if (d > 0.001) {
      if (!fine) {
        fine = true;
        ds = dsF;
        t = max(tStart, t - st * 0.75);
        continue;
      }
      empty = 0;
      // (at least a metre: starting inside a cloud, t = 0 would read as "no hit")
      if (firstHit < 0.0) firstHit = max(t, 1.0 / R);
      float lod = 0.0;
      // one short detailed step, so the billows shade themselves
      float hgt2;
      float cpv2;
      lod += 0.8 * cloudDensity(i, p + sunDir * (70.0 / R), base, top, cov, seed, distM, hgt2, cpv2) * (1.0 - smoothstep(9000.0, 20000.0, distM));
      for (int j = 1; j <= 3; j++) {
        lod += cloudDensityLight(i, p + sunDir * lightStep * float(j * j), base, top, cpv, distM);
      }
      // distant clouds get a softer, hazier edge instead of a hard aliased one
      // dense surfaces, so a ray stops near the sunlit skin instead of averaging in the shadowed
      // interior (which turned front-lit clouds grey)
      float sigma = 0.07 * mix(1.0, 0.2, smoothstep(3000.0, 30000.0, distM));
      float od = lod * 0.045 * 200.0;
      // Beer + weaker, longer-reaching octaves standing in for multiple scattering
      float lightT = exp(-od) + 0.45 * exp(-od * 0.3) + 0.2 * exp(-od * 0.1);
      // a few short light steps cannot resolve distant clouds; seen from afar they read as
      // their sunlit tops, not as near-black shadowed flanks
      // (the tops only: lifted the same, the bases seen from below read as one flat beige sheet)
      lightT = max(lightT, (0.07 + 0.45 * smoothstep(8000.0, 24000.0, distM)) * mix(0.3, 1.0, smoothstep(0.1, 0.7, hgt)));
      float powder = 1.0 - exp(-d * 2.5);
      // sky light falls mostly on the tops; the bellies get some back from the sunlit ground below
      // (cool and faint: warm sunlight here turned the whole underside of a deck beige)
      vec3 bounce = sunL * vec3(0.7, 0.78, 0.9) * (0.03 * (1.0 - hgt));
      // sky occlusion: cloud overhead darkens bellies and the creases between billows
      vec3 upN = normalize(p);
      float aod = cloudDensityLight(i, p + upN * (150.0 / R), base, top, cpv, distM) + 0.7 * cloudDensityLight(i, p + upN * (450.0 / R), base, top, cpv, distM);
      float skyVis = mix(exp(-aod * 1.8), 1.0, smoothstep(9000.0, 24000.0, distM));
      vec3 S = cloudCol * (sunL * lightT * phase * mix(1.0, powder, 0.5) + amb * (0.3 + 1.0 * hgt) * (0.3 + 0.7 * skyVis) + bounce);
      float dT = exp(-d * sigma * st * R);
      L += T * S * (1.0 - dT);
      T *= dT;
      if (T < 0.02) break;
    } else if (fine && ++empty > 6) {
      fine = false;
      ds = dsC;
    }
    t += st;
  }
  // fade far clouds to keep horizon tidy
  float fade = (1.0 - smoothstep(40000.0, 70000.0, distStart)) * limbFade;
  // the march stops at 2% transmittance; close that last gap so the sun cannot glint through
  T *= smoothstep(0.02, 0.06, T);
  return vec4(L * fade, mix(1.0, T, fade));
}

#ifdef CLOUD_UPSAMPLE
// The nearby deck is marched at half resolution (see CLOUD_MARCH below). Upsample it with a
// small Gaussian over the 3x3 half-res neighbourhood that also favours samples at the same
// depth: terrain edges stay sharp and the march's per-pixel jitter is smoothed out.
vec4 upsampleCloud(float sdM, out float firstHitM) {
  vec2 hp = gl_FragCoord.xy * 0.5 - 0.5;
  ivec2 c = ivec2(floor(hp + 0.5));
  ivec2 hi = textureSize(tCloud, 0) - 1;
  float lsd = log2(1.0 + sdM);
  vec4 acc = vec4(0.0);
  float hit = 0.0;
  float wsum = 0.0;
  for (int k = 0; k < 9; k++) {
    ivec2 q = clamp(c + ivec2(k % 3 - 1, k / 3 - 1), ivec2(0), hi);
    vec2 dq = vec2(q) - hp;
    vec4 info = texelFetch(tCloudInfo, q, 0);
    float w = exp(-dot(dq, dq) * 0.55) * exp(-min(abs(info.y - lsd) * 3.0, 30.0)) + 1e-9;
    acc += texelFetch(tCloud, q, 0) * w;
    hit += info.x * w;
    wsum += w;
  }
  hit /= wsum;
  firstHitM = hit > 0.5 ? exp2(hit) - 1.0 : -1.0;
  return acc / wsum;
}
#endif

vec3 clouds(int i, vec3 rd, vec3 C, float camH, vec3 sunDir, inout float sd, vec3 col, float jitter) {
  // shadows of the deck on whatever surface this ray ends on (ground or sea)
  if (sd < 1e5 && length(rd * sd - C) < uCloudBase[i]) col *= cloudShadow(i, rd * sd - C, sunDir, uClouds[i], uCloudSeed[i], sd * uRadius[i]);
  float tStart;
  float tEnd;
  float limbFade;
  float w2d;
  if (!cloudSpan(i, rd, C, camH, sd, tStart, tEnd, limbFade, w2d)) return col;
  vec3 col2d = col;
  float t2d = -1.0;
  float a2d = 0.0;
  if (w2d > 0.0) {
    vec4 lay = cloudLayer(i, rd, C, camH, sunDir, sd, uClouds[i], uCloudSeed[i], uCloudColor[i], t2d);
    a2d = lay.a * limbFade;
    col2d = mix(col, lay.rgb, a2d);
    if (w2d >= 1.0) {
      if (a2d > 0.5) sd = min(sd, t2d);
      return col2d;
    }
  }
  float firstHit;
  vec4 LT;
#ifdef CLOUD_UPSAMPLE
  if (i == uMarchPlanet) {
    float hitM;
    LT = upsampleCloud(sd * uRadius[i], hitM);
    firstHit = hitM > 0.0 ? hitM / uRadius[i] : -1.0;
  } else {
    LT = cloudVolume(i, rd, C, camH, sunDir, sd, jitter, firstHit);
  }
#else
  LT = cloudVolume(i, rd, C, camH, sunDir, sd, jitter, firstHit);
#endif
  if (firstHit > 0.0 && LT.a < 0.5) sd = min(sd, firstHit);
  vec3 col3d = col * LT.a + LT.rgb;
  // only an opaque deck stops the haze short, as in the far branch above (pulling the haze in
  // over clear sky left a hard ring where that branch takes over)
  if (w2d > 0.0 && t2d > 0.0 && a2d > 0.5) sd = mix(sd, min(sd, t2d), w2d);
  return mix(col3d, col2d, w2d);
}

// ---------- cirrus ----------
// A thin, wispy ice layer well above the cumulus deck. On a small planet the deck drops under the
// horizon only ~10 km out, so without it a gap in the deck overhead left the whole sky bare.
vec3 cirrus(int i, vec3 rd, vec3 C, float camH, vec3 sunDir, float sd, vec3 col) {
  float R = uRadius[i];
  float hc = uCloudTop[i] + 3500.0 / R;
  float b = dot(-C, rd);
  float h = b * b - (camH * camH - hc * hc);
  if (h < 0.0) return col;
  h = sqrt(h);
  float t = camH < hc ? -b + h : -b - h;
  if (t <= 0.0 || t >= sd) return col;
  vec3 p = rd * t - C;
  vec3 up = p / hc;
  float distM = t * R;
  vec3 mL = uRot[i] * (p * R);
  // drawn out into streaks along the high-level wind, in the east/north plane over the camera (a
  // fixed planet axis pointed straight up at some sites and turned the streaks into dots)
  vec3 upL = normalize(uRot[i] * (-C));
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), upL) + vec3(1e-4, 0.0, 0.0));
  vec3 north = cross(upL, east);
  vec2 w = vec2(dot(mL, east) + uTime * 14.0, dot(mL, north) + uTime * 4.0);
  // (no fine octave: thin hard strokes read as scratches on the lens)
  float n = textureLod(tNoiseMip, vec3(w.x / 18000.0, w.y / 8000.0, 0.13), noiseLod(distM, 8000.0)).r * 0.65 +
    textureLod(tNoiseMip, vec3(w.x / 6000.0, w.y / 2600.0, 0.61), noiseLod(distM, 2600.0)).r * 0.35;
  // in drifts across the sky, not a uniform sheet of strokes
  float region = textureLod(tNoiseMip, vec3(w.x / 30000.0, w.y / 22000.0, 0.37), noiseLod(distM, 22000.0)).r;
  float d = smoothstep(0.5, 0.85, n) * smoothstep(0.4, 0.62, region + uClouds[i] * 0.25);
  // a sky detail for the ground: from a few km up it is too close and reads as smudges
  d *= 1.0 - smoothstep(1.5, 3.5, (camH - 1.0) * R / 1000.0);
  // seen edge-on the sheet would read as a hard band: it thins out toward grazing views
  d *= smoothstep(0.03, 0.25, abs(dot(rd, up)));
  if (d <= 0.001) return col;
  float mu = dot(rd, sunDir);
  float lit = smoothstep(-0.1, 0.15, dot(up, sunDir));
  vec3 sunL = (uSunLight * uAirTint[i].rgb) * sunTransmittance(i, p, sunDir) * lit;
  vec3 amb = (normalize(uScatter[i] + 0.01) * 0.5 + 0.4) * length(uSunLight * uAirTint[i].rgb) * 0.05 * lit;
  vec3 c = uCloudColor[i] * (sunL * (0.12 + 0.9 * hgPhase(mu, 0.65)) + amb);
  return mix(col, c, d * 0.4);
}

vec3 shadeScene(vec3 col, vec3 rd, float sceneDist, float jitter) {
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    float R = uRadius[i];
    vec3 C = uCenter[i] / R;
    float camH = uCamDist[i] / R;
    float sd = sceneDist / R;
    vec3 sunDir = normalize(uSunPos - uCenter[i]);
    bool under = false;
    if (uOcean[i] > 0.5) col = ocean(i, rd, C, camH, sunDir, sd, col, under);
    if (!under) {
      bool ci = uClouds[i] > 0.001 && uAtmoTop[i] > 1.0;
      bool ciAbove = camH >= uCloudTop[i] + 3500.0 / R;
      if (uClouds[i] > 0.001) col = clouds(i, rd, C, camH, sunDir, sd, col, jitter);
      // the cirrus sits near the top of the air: under the haze seen from above, over it from below
      if (ci && ciAbove) col = cirrus(i, rd, C, camH, sunDir, sd, col);
      if (uAtmoTop[i] > 1.0) col = atmosphere(i, rd, C, camH, sunDir, sd, col, jitter);
      if (ci && !ciAbove) col = cirrus(i, rd, C, camH, sunDir, sd, col);
    }
    sceneDist = sd * R;
  }
  return col;
}

#ifdef CLOUD_MARCH
layout(location = 0) out highp vec4 oCloud;
layout(location = 1) out highp vec4 oInfo;

// Half-resolution march of the nearby planet's deck. Alternate pixels take the nearest and the
// farthest depth of their 2x2 block, so the upsampler finds a match on both sides of an edge.
void main() {
  ivec2 hp = ivec2(gl_FragCoord.xy);
  ivec2 fp = hp * 2;
  ivec2 hi = textureSize(tDepth, 0) - 1;
  float d00 = texelFetch(tDepth, min(fp, hi), 0).x;
  float d10 = texelFetch(tDepth, min(fp + ivec2(1, 0), hi), 0).x;
  float d01 = texelFetch(tDepth, min(fp + ivec2(0, 1), hi), 0).x;
  float d11 = texelFetch(tDepth, min(fp + ivec2(1, 1), hi), 0).x;
  float d = ((hp.x + hp.y) & 1) == 1 ? max(max(d00, d10), max(d01, d11)) : min(min(d00, d10), min(d01, d11));
  // the ray wanders over the 2x2 block from frame to frame; the temporal pass averages it out,
  // so cloud edges come out antialiased instead of in half-res steps
  vec2 uv = (vec2(fp) + 1.0 + uJitter) / vec2(hi + 1);
  vec3 viewDir = normalize(vec3((uv.x * 2.0 - 1.0) * uTanFov.x, (uv.y * 2.0 - 1.0) * uTanFov.y, -1.0));
  vec3 rd = normalize((uCamWorld * vec4(viewDir, 0.0)).xyz);
  float sceneDist = 1e20;
  if (d < 0.9999999) sceneDist = (pow(uFar + 1.0, d) - 1.0) / max(1e-6, -viewDir.z);
  int i = uMarchPlanet;
  float R = uRadius[i];
  vec3 C = uCenter[i] / R;
  float camH = uCamDist[i] / R;
  float sd = sceneDist / R;
  oCloud = vec4(0.0, 0.0, 0.0, 1.0);
  oInfo = vec4(0.0, log2(1.0 + sceneDist), 0.0, 1.0);
  if (uOcean[i] > 0.5) {
    // under water the deck is not drawn; above it, the sea surface ends the ray as in ocean()
    if (camH < 1.0) return;
    float b = dot(-C, rd);
    float h = b * b - (camH - 1.0) * (camH + 1.0);
    if (h >= 0.0) {
      float t0 = -b - sqrt(h);
      if (t0 > 0.0 && t0 < sd) sd = t0;
    }
  }
  vec3 sunDir = normalize(uSunPos - uCenter[i]);
  float jitter = fract(texture2D(tBlue, gl_FragCoord.xy / 64.0).r + fract(uTime * 60.0) * 0.618034);
  float firstHit;
  oCloud = cloudVolume(i, rd, C, camH, sunDir, sd, jitter, firstHit);
  oInfo = vec4(firstHit > 0.0 ? log2(1.0 + firstHit * R) : 0.0, log2(1.0 + sd * R), 0.0, 1.0);
}
#else
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  vec3 viewDir = normalize(vec3((vUv.x * 2.0 - 1.0) * uTanFov.x, (vUv.y * 2.0 - 1.0) * uTanFov.y, -1.0));
  vec3 rd = normalize((uCamWorld * vec4(viewDir, 0.0)).xyz);
  float sceneDist = 1e20;
  bool silhouette = false;
  if (d < 0.9999999) {
    float w = pow(uFar + 1.0, d) - 1.0;
    sceneDist = w / max(1e-6, -viewDir.z);
    // antialiased edge against empty sky: the resolved colour is part terrain, part
    // black background, so shading it purely as terrain leaves a dark fringe
    ivec2 pc = ivec2(gl_FragCoord.xy);
    float dn = max(max(texelFetch(tDepth, pc + ivec2(1, 0), 0).x, texelFetch(tDepth, pc - ivec2(1, 0), 0).x),
      max(texelFetch(tDepth, pc + ivec2(0, 1), 0).x, texelFetch(tDepth, pc - ivec2(0, 1), 0).x));
    silhouette = dn >= 0.9999999;
  }
  if (d >= 0.9999999) col *= mix(uStarVis, 1.0, smoothstep(1.5, 4.0, dot(col, vec3(0.3, 0.5, 0.2))));
  // blue-noise jitter, stepped along the golden ratio each frame
  float jitter = fract(texture2D(tBlue, gl_FragCoord.xy / 64.0).r + fract(uTime * 60.0) * 0.618034);
  vec3 outCol = shadeScene(col, rd, sceneDist, jitter);
  if (silhouette) outCol = mix(outCol, shadeScene(col, rd, 1e20, jitter), 0.5);
  gl_FragColor = vec4(max(outCol, vec3(0.0)), 1.0);
}
#endif
`;

// Temporal accumulation of the half-res march: each texel is reprojected to where its cloud
// was last frame (in the planet's own frame, so the spin and the floating origin drop out),
// clamped to this frame's neighbourhood and blended in. It averages away the march jitter and
// the sub-pixel ray offsets.
const resolveFrag = /* glsl */ `
precision highp float;
uniform sampler2D tCur;
uniform sampler2D tCurInfo;
uniform sampler2D tHist;
uniform sampler2D tHistInfo;
uniform mat4 uCamWorld;
uniform vec2 uTanFov;
uniform vec2 uFullSize;
uniform mat3 uPrevView;
uniform vec3 uPrevOffset;
uniform vec2 uPrevTanFov;
uniform float uHistValid;
uniform float uBlend;
layout(location = 0) out highp vec4 oCloud;
layout(location = 1) out highp vec4 oInfo;
void main() {
  ivec2 hp = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(tCur, 0) - 1;
  vec4 cur = texelFetch(tCur, hp, 0);
  vec4 info = texelFetch(tCurInfo, hp, 0);
  oCloud = cur;
  oInfo = info;
  if (uHistValid < 0.5) return;
  vec4 mn = cur;
  vec4 mx = cur;
  for (int k = 0; k < 9; k++) {
    vec4 s = texelFetch(tCur, clamp(hp + ivec2(k % 3 - 1, k / 3 - 1), ivec2(0), hi), 0);
    mn = min(mn, s);
    mx = max(mx, s);
  }
  vec2 uv = (vec2(hp * 2) + 1.0) / uFullSize;
  vec3 viewDir = normalize(vec3((uv.x * 2.0 - 1.0) * uTanFov.x, (uv.y * 2.0 - 1.0) * uTanFov.y, -1.0));
  vec3 rd = normalize((uCamWorld * vec4(viewDir, 0.0)).xyz);
  // the cloud's own depth where there is one, else the scene (capped: clear sky has none)
  float tM = info.x > 0.0 ? exp2(info.x) - 1.0 : min(exp2(info.y) - 1.0, 6000.0);
  vec3 pv = uPrevView * (rd * tM) + uPrevOffset;
  if (pv.z > -1e-3) return;
  vec2 puv = (pv.xy / -pv.z) / uPrevTanFov * 0.5 + 0.5;
  if (any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) return;
  // a different surface behind the cloud there (a terrain edge moved over it): start afresh
  vec4 hInfo = texelFetch(tHistInfo, clamp(ivec2(puv * vec2(hi + 1)), ivec2(0), hi), 0);
  if (abs(hInfo.y - info.y) > 0.4) return;
  vec4 h = clamp(texture(tHist, puv), mn, mx);
  oCloud = mix(h, cur, uBlend);
}
`;

const _m3a = new THREE.Matrix3();
const _m3b = new THREE.Matrix3();
const _v3a = new THREE.Vector3();
const halton = (i, b) => {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
};

export class AtmospherePass extends Pass {
  constructor() {
    super();
    const arr = (fn) => Array.from({ length: MAX_PLANETS }, fn);
    this.uniforms = {
      tColor: { value: null },
      tDepth: { value: null },
      tNoise: { value: getNoise3D() },
      tNoiseMip: { value: getNoise3DMipmapped() },
      tBlue: { value: getBlueNoise() },
      uPixelAngle: { value: 0.001 },
      uStarVis: { value: 1 },
      uCamWorld: { value: new THREE.Matrix4() },
      uTanFov: { value: new THREE.Vector2(1, 1) },
      uFar: { value: 1e9 },
      uTime: { value: 0 },
      uSunPos: { value: new THREE.Vector3() },
      uSunLight: { value: new THREE.Vector3(3, 3, 3) },
      uSunSky: { value: 7 },
      uCount: { value: 0 },
      uCenter: { value: arr(() => new THREE.Vector3()) },
      uRadius: { value: arr(() => 1) },
      uCamDist: { value: arr(() => 10) },
      uAtmoTop: { value: arr(() => 0) },
      uScatter: { value: arr(() => new THREE.Vector3()) },
      uFalloff: { value: arr(() => 4) },
      uMie: { value: arr(() => 0) },
      uOcean: { value: arr(() => 0) },
      uWaterShallow: { value: arr(() => new THREE.Vector3()) },
      uWaterDeep: { value: arr(() => new THREE.Vector3()) },
      uWaterEmissive: { value: arr(() => 0) },
      uRot: { value: arr(() => new THREE.Matrix3()) },
      uClouds: { value: arr(() => 0) },
      uCloudColor: { value: arr(() => new THREE.Vector3(1, 1, 1)) },
      uAirTint: { value: arr(() => new THREE.Vector4(1, 1, 1, 0)) },
      uCloudBase: { value: arr(() => 1.05) },
      uCloudTop: { value: arr(() => 1.12) },
      uCloudSeed: { value: arr(() => 0) },
      uCloudQuality: { value: 0.6 },
      uMarchPlanet: { value: -1 },
      uJitter: { value: new THREE.Vector2() },
      tCloud: { value: null },
      tCloudInfo: { value: null },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: '#define CLOUD_UPSAMPLE\n' + frag,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.needsSwap = true;

    // The volumetric deck of the planet the camera is near is the costliest part of the frame:
    // march it at half resolution into (light, transmittance) + (first hit, scene depth).
    this.cloudTarget = new THREE.WebGLRenderTarget(1, 1, {
      count: 2,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    this.uniforms.tCloud.value = this.cloudTarget.textures[0];
    this.uniforms.tCloudInfo.value = this.cloudTarget.textures[1];
    // shares every uniform with the composite, except the coarser pixel footprint
    this.marchUniforms = { ...this.uniforms, uPixelAngle: { value: 0.002 } };
    this.marchMaterial = new THREE.ShaderMaterial({
      uniforms: this.marchUniforms,
      vertexShader: vert,
      fragmentShader: '#define CLOUD_MARCH\n' + frag,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });
    this.marchQuad = new FullScreenQuad(this.marchMaterial);

    // history ping-pong for the temporal resolve; the composite reads the resolved one
    const histTarget = () => {
      const t = new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
      t.textures[0].minFilter = t.textures[0].magFilter = THREE.LinearFilter;
      return t;
    };
    this.hist = [histTarget(), histTarget()];
    this.histIdx = 0;
    this.histValid = false;
    this.frameIdx = 0;
    this.prevLocalToView = new THREE.Matrix3();
    this.prevCamLocal = new THREE.Vector3();
    this.prevKey = '';
    this.resolveUniforms = {
      tCur: { value: this.cloudTarget.textures[0] },
      tCurInfo: { value: this.cloudTarget.textures[1] },
      tHist: { value: null },
      tHistInfo: { value: null },
      uCamWorld: this.uniforms.uCamWorld,
      uTanFov: this.uniforms.uTanFov,
      uFullSize: { value: new THREE.Vector2(1, 1) },
      uPrevView: { value: new THREE.Matrix3() },
      uPrevOffset: { value: new THREE.Vector3() },
      uPrevTanFov: { value: new THREE.Vector2(1, 1) },
      uHistValid: { value: 0 },
      uBlend: { value: 0.15 },
    };
    this.resolveQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.resolveUniforms,
        vertexShader: vert,
        fragmentShader: resolveFrag,
        glslVersion: THREE.GLSL3,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  // Sets up last frame's camera for the reprojection, in the march planet's own frame.
  updateHistory(march, w, h) {
    const u = this.uniforms;
    const ru = this.resolveUniforms;
    // world -> planet local, and world -> view
    const rot = u.uRot.value[march];
    const viewFromWorld = _m3a.setFromMatrix4(u.uCamWorld.value).transpose();
    const localToView = _m3b.copy(viewFromWorld).multiply(_m3a.copy(rot).transpose());
    const camLocal = _v3a.copy(u.uCenter.value[march]).negate().applyMatrix3(rot);
    const key = `${march}_${u.uRadius.value[march]}_${u.uCloudSeed.value[march]}_${w}_${h}`;
    const moved = camLocal.distanceTo(this.prevCamLocal);
    ru.uHistValid.value = this.histValid && key === this.prevKey && moved < 4000 ? 1 : 0;
    // current world direction -> last frame's view space, plus how far the camera moved since
    ru.uPrevView.value.copy(this.prevLocalToView).multiply(rot);
    ru.uPrevOffset.value.copy(camLocal).sub(this.prevCamLocal).applyMatrix3(this.prevLocalToView);
    this.prevLocalToView.copy(localToView);
    this.prevCamLocal.copy(camLocal);
    this.prevKey = key;
    this.histValid = true;
  }

  // the planet whose deck may be close enough to need the volumetric march
  marchPlanet() {
    const u = this.uniforms;
    let best = -1;
    let bestAlt = 60000;
    for (let i = 0; i < u.uCount.value; i++) {
      if (u.uClouds.value[i] <= 0.001) continue;
      const alt = u.uCamDist.value[i] - u.uRadius.value[i] * u.uCloudTop.value[i];
      if (alt < bestAlt) {
        bestAlt = alt;
        best = i;
      }
    }
    return best;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.lastDepth = readBuffer.depthTexture;
    const march = this.marchPlanet();
    this.uniforms.uMarchPlanet.value = march;
    if (march >= 0) {
      // sized from the frame being shaded (the composer's resize calls arrive in varying order)
      const w = Math.ceil(readBuffer.width / 2);
      const h = Math.ceil(readBuffer.height / 2);
      if (this.cloudTarget.width !== w || this.cloudTarget.height !== h) this.cloudTarget.setSize(w, h);
      this.marchUniforms.uPixelAngle.value = this.uniforms.uPixelAngle.value * 2;
      const n = (this.frameIdx++ % 16) + 1;
      this.uniforms.uJitter.value.set(halton(n, 2) * 2 - 1, halton(n, 3) * 2 - 1);
      renderer.setRenderTarget(this.cloudTarget);
      this.marchQuad.render(renderer);
      const ru = this.resolveUniforms;
      const prev = this.hist[this.histIdx];
      const next = this.hist[1 - this.histIdx];
      for (const t of this.hist) if (t.width !== w || t.height !== h) t.setSize(w, h);
      this.updateHistory(march, w, h);
      ru.uFullSize.value.set(readBuffer.width, readBuffer.height);
      ru.tHist.value = prev.textures[0];
      ru.tHistInfo.value = prev.textures[1];
      renderer.setRenderTarget(next);
      this.resolveQuad.render(renderer);
      ru.uPrevTanFov.value.copy(this.uniforms.uTanFov.value);
      this.histIdx = 1 - this.histIdx;
      this.uniforms.tCloud.value = next.textures[0];
      this.uniforms.tCloudInfo.value = next.textures[1];
    } else {
      this.histValid = false;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
    this.marchMaterial.dispose();
    this.marchQuad.dispose();
    this.cloudTarget.dispose();
    this.resolveQuad.material.dispose();
    this.resolveQuad.dispose();
    for (const t of this.hist) t.dispose();
  }
}
