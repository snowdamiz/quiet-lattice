// Adds triplanar hull-plating detail (panel seams, grime, rivets) to a standard
// material using object-space coordinates, so models need no UVs.
import * as THREE from 'three';
import { makePanelTexture } from './textures.js';

let panelTex = null;
function getPanelTex() {
  if (!panelTex) {
    const { map } = makePanelTexture({ size: 1024, base: '#c8c8c8', line: '#5a5a5a', seed: 11 });
    map.colorSpace = THREE.NoColorSpace;
    panelTex = map;
  }
  return panelTex;
}

export function applyPanelDetail(material, { scale = 0.5, strength = 0.55, worldSpace = false } = {}) {
  if (material.userData.panel) return material;
  const tex = getPanelTex();
  material.userData.panel = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uPanelTex = { value: tex };
    shader.uniforms.uPanelScale = { value: scale };
    shader.uniforms.uPanelStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${worldSpace ? 'vObjPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vObjNormal = mat3(modelMatrix) * normal;' : 'vObjPos = transformed; vObjNormal = normal;'}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uPanelTex;
        uniform float uPanelScale;
        uniform float uPanelStrength;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 pw = abs(normalize(vObjNormal));
        pw = pow(pw, vec3(6.0));
        pw /= (pw.x + pw.y + pw.z);
        vec3 pp = vObjPos * uPanelScale;
        float panel = texture2D(uPanelTex, pp.yz).r * pw.x + texture2D(uPanelTex, pp.zx).r * pw.y + texture2D(uPanelTex, pp.xy).r * pw.z;
        diffuseColor.rgb *= mix(1.0, panel * 1.35, uPanelStrength);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (0.75 - panel) * 0.35 * uPanelStrength, 0.05, 1.0);`,
      );
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + `panel${worldSpace ? 'W' : 'O'}`;
  material.needsUpdate = true;
  return material;
}
