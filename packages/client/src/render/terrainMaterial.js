// MeshStandardMaterial extended for planet terrain: per-pixel palette colouring
// from height, slope, moisture and noise, triplanar detail + bump, lava emissive and
// a per-planet sun direction so distant planets are lit correctly by the single
// shared directional light.
import * as THREE from 'three';
import { getDetailTexture, getNoise3DMipmapped } from './textures.js';

// palette slots, in the order the shader indexes uPal
const PALETTE = ['deep', 'floor', 'beach', 'low1', 'low2', 'dry', 'high', 'rock1', 'rock2', 'snow'];

// Sky light and the environment map come from wherever the camera is, so on their own they
// would light a planet's night side as brightly as its day side: scale them by local daylight.
const lightsChunk =
  `float terrainDay = mix(0.05, 1.0, smoothstep(-0.2, 0.25, dot(normalize(vPlanetPos), normalize(mat3(uPlanetInv) * (transpose(mat3(viewMatrix)) * uSunDirView)))));\n` +
  THREE.ShaderChunk.lights_fragment_begin
    .replace(
      'directionalLight = directionalLights[ i ];',
      'directionalLight = directionalLights[ i ]; directionalLight.direction = uSunDirView;',
    )
    .replace(
      'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
      'irradiance += uAmbientScale * terrainDay * getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
    );
const mapsChunk = THREE.ShaderChunk.lights_fragment_maps.replace(
  'iblIrradiance += getIBLIrradiance( geometryNormal );',
  'iblIrradiance += terrainDay * getIBLIrradiance( geometryNormal );',
);

export function createTerrainMaterial(params, { detailStrength = 0.5, roughness = 0.93 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness, metalness: 0.0, color: 0xffffff });
  const uniforms = {
    uPal: { value: PALETTE.map((k) => new THREE.Vector3(...params.colors[k])) },
    uNoise3D: { value: getNoise3DMipmapped() },
    uRadius: { value: params.radius },
    uHasOcean: { value: params.hasOcean ? 1 : 0 },
    uSeaDepth: { value: params.seaDepth },
    uBeachH: { value: params.beachHeight },
    uMountainH: { value: params.mountainHeight },
    uSnowLine: { value: params.snowLine },
    uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
    uAmbientScale: { value: 1.0 },
    uPlanetInv: { value: new THREE.Matrix4() },
    uDetailTex: { value: getDetailTexture() },
    uDetailStrength: { value: detailStrength },
    uEmissiveBoost: { value: 6.0 },
    // cities' paved plains (planet-local direction, cos of angular radius): the paving is the
    // ground there, and coarse terrain chunks would bulge up through it
    uCities: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 2)) },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aColor;
        uniform mat4 uPlanetInv;
        varying vec4 vTerr;
        varying vec3 vPlanetPos;
        varying vec3 vPlanetNormal;
        varying float vSkirtDrop;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTerr = aColor;
        vSkirtDrop = (length(normal) - 1.0) * 1000.0;
        vPlanetPos = (uPlanetInv * (modelMatrix * vec4(transformed, 1.0))).xyz;
        vPlanetNormal = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDirView;
        uniform float uAmbientScale;
        uniform sampler2D uDetailTex;
        uniform float uDetailStrength;
        uniform float uEmissiveBoost;
        uniform vec3 uPal[10];
        uniform mat4 uPlanetInv;
        uniform vec4 uCities[4];
        uniform highp sampler3D uNoise3D;
        uniform float uRadius;
        uniform float uHasOcean;
        uniform float uSeaDepth;
        uniform float uBeachH;
        uniform float uMountainH;
        uniform float uSnowLine;
        varying vec4 vTerr;
        varying vec3 vPlanetPos;
        varying vec3 vPlanetNormal;
        varying float vSkirtDrop;
        vec4 triplanar(vec3 p, vec3 w, float scale) {
          vec4 a = texture2D(uDetailTex, p.yz * scale);
          vec4 b = texture2D(uDetailTex, p.zx * scale);
          vec4 c = texture2D(uDetailTex, p.xy * scale);
          return a * w.x + b * w.y + c * w.z;
        }
        vec3 bumpPerturb(vec3 pos, vec3 n, float h) {
          vec3 dpdx = dFdx(pos);
          vec3 dpdy = dFdy(pos);
          float dhdx = dFdx(h);
          float dhdy = dFdy(h);
          vec3 r1 = cross(dpdy, n);
          vec3 r2 = cross(n, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
          return normalize(abs(det) * n - grad);
        }
        // Ground colour for this pixel. Bands follow real contours (per-pixel height and
        // slope) and are broken up by noise at several scales, so there are no vertex stripes.
        vec3 terrainColor(vec3 pos, vec3 pn, out float lavaGlow) {
          float hgt = length(pos) - uRadius + vSkirtDrop;
          float slope = dot(pn, normalize(pos));
          float nL = (texture(uNoise3D, pos * (1.0 / 2900.0)).a - 0.5) * 3.0;
          float nM = (texture(uNoise3D, pos * (1.0 / 610.0) + 0.37).a - 0.5) * 3.0;
          // fine noise fades out with distance: from orbit its texels read as a blocky grid
          float farK = 1.0 - smoothstep(4000.0, 16000.0, length(vViewPosition));
          float nF = (texture(uNoise3D, pos * (1.0 / 47.0) + 0.71).a - 0.5) * 3.0 * farK;
          // meadow / scrub patches at a scale that still reads from the air
          vec4 nP4 = mix(vec4(0.5), texture(uNoise3D, pos * (1.0 / 170.0) + 0.53), farK);
          float nP = (nP4.a - 0.5) * 3.0;
          float moist = clamp(vTerr.r + nL * 0.3 + nM * 0.12, 0.0, 1.0);
          float temp = vTerr.g * 2.0 - 1.0;
          lavaGlow = vTerr.b;
          vec3 col;
          if (uHasOcean > 0.5 && hgt < 0.0) {
            // a muted, weedy shallow bed: bright sand here showed through as a pale ring round every lake
            col = mix(mix(uPal[2], uPal[3], 0.5) * 0.5, uPal[1], smoothstep(0.0, -2.0, hgt));
            col = mix(col, uPal[0], smoothstep(0.0, -uSeaDepth * 0.6, hgt));
            return col * 0.6;
          }
          vec3 veg = mix(uPal[3], uPal[4], smoothstep(-0.3, 0.3, nM * 0.5 + nL * 0.2 + nP * 0.45));
          col = mix(uPal[5], veg, smoothstep(0.32, 0.62, moist + nP * 0.08));
          // broad drier swathes and lusher hollows, so open country is not one flat green from the air
          float swDry = smoothstep(-0.1, 0.7, nL * 0.3 + nM * 0.45 + nP * 0.35);
          col = mix(col, mix(uPal[5], uPal[3], 0.35) * 1.06, swDry * 0.5 * smoothstep(0.3, 0.7, moist));
          col = mix(col, uPal[4] * 0.95, (1.0 - smoothstep(-0.9, -0.25, nL * 0.6 + nM * 0.4)) * 0.4);
          // clumps of darker growth and lighter bare ground
          col *= 0.87 + 0.22 * smoothstep(0.3, 0.7, nP4.a * 0.65 + nP4.g * 0.35) - 0.07 * smoothstep(0.6, 0.9, nP4.b);
          float hi = smoothstep(uMountainH * 0.15, uMountainH * 0.55, hgt + nL * uMountainH * 0.12);
          col = mix(col, uPal[6], hi);
          if (uHasOcean > 0.5) {
            // narrow sandy strip, and only along some stretches of coast
            float beach = (1.0 - smoothstep(0.6, 1.8 + nF * 0.8, hgt)) * smoothstep(-0.25, 0.2, nL + nM * 0.3) * farK;
            col = mix(col, uPal[2], beach);
          }
          // rock varies by noise only: altitude-based strata read as contour stripes from afar
          // (the fine noise's cell grid shows as a lattice from a few km, so far rock uses the broad octaves)
          float rockFine = 1.0 - smoothstep(700.0, 2500.0, length(vViewPosition));
          vec3 rock = mix(uPal[7], uPal[8], smoothstep(-0.6, 0.6, nF * 0.7 * rockFine + nM * 0.3 + nL * 0.25 * (1.0 - rockFine))) * 1.3;
          // layered strata on sheer faces (mesa walls, canyon sides, rifts), near only: from afar
          // altitude bands read as contour stripes, and a whole mountain banded reads as a layer cake,
          // so only in some stretches of country, in rock tones, and the fine bands go first
          float strataD = length(vViewPosition);
          float strataK = (1.0 - smoothstep(0.32, 0.6, slope)) * (1.0 - smoothstep(700.0, 2400.0, strataD)) * smoothstep(-0.15, 0.35, nL * 0.8 + nM * 0.3);
          if (strataK > 0.0) {
            // (uneven: bands of different thickness that wander and fade, not a regular stripe)
            float band = sin(hgt * 0.42 + nM * 3.0 + nF * 1.2) * 0.5 + 0.5;
            band = mix(0.5, band, 1.0 - smoothstep(200.0, 800.0, strataD));
            float band2 = sin(hgt * 0.13 + nL * 2.2 + nM) * 0.5 + 0.5;
            float bandMix = smoothstep(0.25, 0.85, band * 0.45 + band2 * 0.55);
            vec3 strata = mix(rock * 0.8, mix(rock, uPal[8] * 1.3, 0.5) * 1.1, bandMix);
            rock = mix(rock, strata, strataK * 0.45 * (0.55 + 0.45 * smoothstep(-0.6, 0.6, nL + nM * 0.5)));
          }
          // grass holds on fairly steep ground; bare rock only on real cliffs
          float rockT = 1.0 - smoothstep(0.58, 0.78, slope + nF * 0.06);
          float rockHigh = smoothstep(uMountainH * 0.45, uMountainH * 0.8, hgt + nM * uMountainH * 0.08) * 0.55;
          col = mix(col, rock, max(rockT, rockHigh));
          // snow caps above the snow line, or wherever it is simply very cold
          // the snow line softens and wanders more with distance: seen from orbit a crisp one drew
          // hard white pills on the peaks
          float snowW = 40.0 + length(vViewPosition) * 0.012;
          float snow = max(smoothstep(uSnowLine - snowW, uSnowLine + snowW * 1.5, hgt + nM * 30.0 + nL * snowW * 0.8), smoothstep(0.45, 0.65, -temp + nM * 0.08)) *
            smoothstep(0.55, 0.8, slope + nF * 0.04);
          col = mix(col, uPal[9], snow);
          // forests: shaded forest floor up close (the real trees stand on it), a dark
          // canopy further out where the instanced trees have faded
          float forest = vTerr.a * smoothstep(0.72, 0.8, slope) * smoothstep(-0.3, 0.1, nF * 0.5 + 0.2);
          float canopyFar = smoothstep(250.0, 480.0, length(vViewPosition));
          vec3 canopy = mix(uPal[4], uPal[3], 0.25 + 0.3 * smoothstep(-0.4, 0.4, nF)) * (0.7 + 0.15 * nP4.g);
          col = mix(col, mix(col * 0.78, canopy, canopyFar * 0.3), forest * (1.0 - snow) * (1.0 - max(rockT, rockHigh)));
          // damp, darker ground right above the waterline instead of a bright shore band
          if (uHasOcean > 0.5) col *= mix(0.55, 1.0, smoothstep(0.0, 1.4 + nF * 0.4, hgt));
          col *= 0.92 + nF * 0.05;
          // close to the player: small patches of lusher and drier growth, so the ground is not one flat colour
          float nearK = 1.0 - smoothstep(60.0, 420.0, length(vViewPosition));
          if (nearK > 0.0) {
            float nS = (texture(uNoise3D, pos * (1.0 / 9.0) + 0.13).a - 0.5) * 3.0;
            float nT = (texture(uNoise3D, pos * (1.0 / 3.1) + 0.57).a - 0.5) * 3.0;
            vec3 tint = mix(vec3(0.82, 0.92, 0.7), vec3(1.12, 1.06, 0.82), smoothstep(-0.6, 0.6, nS));
            col = mix(col, col * tint * (0.94 + 0.08 * nT), nearK * (1.0 - snow) * (1.0 - max(rockT, rockHigh) * 0.7));
          }
          return mix(col, vec3(1.0, 0.25, 0.02), lavaGlow);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // weights from the actual triangle, not the smoothed vertex normal: on coarse cliffs the
        // two disagree and the texture smears into vertical streaks
        // (taken from view-space derivatives, which stay precise up close, then rotated into the planet frame)
        for (int ci = 0; ci < 4; ci++) if (dot(normalize(vPlanetPos), uCities[ci].xyz) > uCities[ci].w) discard;
        vec3 nGeo = mat3(uPlanetInv) * (transpose(mat3(viewMatrix)) * normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))));
        vec3 tw = abs(nGeo);
        tw = pow(tw, vec3(4.0));
        tw /= (tw.x + tw.y + tw.z);
        float viewDist = length(vViewPosition);
        vec4 dNear = triplanar(vPlanetPos, tw, 0.31);
        vec4 dMid = triplanar(vPlanetPos, tw, 0.043);
        vec4 dFar = triplanar(vPlanetPos, tw, 0.0061);
        // a second, rotated far octave at an unrelated scale hides the tiling of the first
        vec4 dFar2 = triplanar(vPlanetPos.yzx + vec3(311.0, 97.0, 53.0), tw.yzx, 0.0023);
        float nearFade = 1.0 - smoothstep(30.0, 140.0, viewDist);
        // the mid octave repeats every 23 m: from a few km up that repeat reads as a lattice
        float midFade = 1.0 - smoothstep(500.0, 2200.0, viewDist);
        float farR = dFar.r * 0.55 + dFar2.r * 0.45;
        float detail = mix(0.5, dNear.r * 0.6 + dNear.b * 0.4, nearFade) * 0.4 + mix(0.5, dMid.r, midFade) * 0.35 + farR * 0.25;
        float dMod = clamp(1.0 + (detail - 0.5) * mix(2.2, 3.0, nearFade) * uDetailStrength, 0.55, 1.45);
        float lavaGlow;
        vec3 terrCol = terrainColor(vPlanetPos, normalize(vPlanetNormal), lavaGlow);
        diffuseColor.rgb *= terrCol * dMod;
        float bumpH = (dNear.r * 0.5 + dNear.b * 0.35 + dNear.g * 0.15) * 0.12 * nearFade + dMid.r * 1.1 * midFade + farR * 1.6;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = bumpPerturb(-vViewPosition, normal, bumpH * uDetailStrength);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // fissures are thin: on coarse distant chunks the per-vertex glow would smear into blobs
        totalEmissiveRadiance += vec3(1.0, 0.25, 0.02) * lavaGlow * uEmissiveBoost * (0.8 + 0.4 * dMid.r) * (1.0 - 0.9 * smoothstep(3000.0, 15000.0, viewDist));`,
      )
      .replace('#include <lights_fragment_begin>', lightsChunk)
      .replace('#include <lights_fragment_maps>', mapsChunk);
  };
  mat.customProgramCacheKey = () => 'terrain-v11';
  return mat;
}
