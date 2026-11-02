import * as THREE from 'three';

export const DEPENDENT_SIDE = 256;
const POINTS = [[0, 0], [17, 23], [DEPENDENT_SIDE - 1, DEPENDENT_SIDE - 1]];
const seed = (x, y) => [(x * 3 + y * 5 + 1) % 251, (x * 7 + y * 11 + 7) % 251, (x * 13 + y * 17 + 13) % 251, (x * 19 + y * 23 + 19) % 251];
const validSteps = (steps) => {
  if (!Number.isInteger(steps) || steps < 1 || steps > 4) throw new Error('Dependent-output passes must be an integer from 1 to 4');
};

// Reverse the spatial dependency chain to compute the expected final readback without assuming any GPU timing.
export function expectedDependentBytes(steps, x, y) {
  validSteps(steps);
  const value = (step, px, py) => {
    if (!step) return seed(px, py);
    const previous = value(step - 1, (px + step) % DEPENDENT_SIDE, (py + 2 * step) % DEPENDENT_SIDE);
    const add = [3 + step + px % 7, 5 + step + py % 11, 7 + step + (px + py) % 13, 11 + step];
    return previous.map((v, channel) => (v + add[channel]) % 251);
  };
  return value(steps, x, y);
}

/** Owned offscreen resources in the review's GL context. No game scene or shared fullscreen geometry is modified. */
export function dependentOutput(renderer) {
  const bytes = new Uint8Array(DEPENDENT_SIDE * DEPENDENT_SIDE * 4);
  for (let y = 0; y < DEPENDENT_SIDE; y++) for (let x = 0; x < DEPENDENT_SIDE; x++) bytes.set(seed(x, y), (y * DEPENDENT_SIDE + x) * 4);
  const initial = new THREE.DataTexture(bytes, DEPENDENT_SIDE, DEPENDENT_SIDE);
  initial.colorSpace = THREE.NoColorSpace;
  initial.needsUpdate = true;
  const targets = Array.from({ length: 2 }, () => new THREE.WebGLRenderTarget(DEPENDENT_SIDE, DEPENDENT_SIDE, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, samples: 0, generateMipmaps: false,
  }));
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    uniforms: { uPrevious: { value: initial }, uStep: { value: 1 } },
    vertexShader: 'precision highp float; in vec3 position; void main() { gl_Position = vec4(position, 1.0); }',
    fragmentShader: `
      precision highp float;
      precision highp int;
      uniform highp sampler2D uPrevious;
      uniform int uStep;
      out vec4 outColor;
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        ivec2 q = ivec2((p.x + uStep) % ${DEPENDENT_SIDE}, (p.y + 2 * uStep) % ${DEPENDENT_SIDE});
        uvec4 previous = uvec4(floor(texelFetch(uPrevious, q, 0) * 255.0 + 0.5));
        uvec4 add = uvec4(3u, 5u, 7u, 11u) + uvec4(uint(uStep))
          + uvec4(uint(p.x % 7), uint(p.y % 11), uint((p.x + p.y) % 13), 0u);
        outColor = vec4((previous + add) % uvec4(251u)) / 255.0;
      }`,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const camera = new THREE.Camera();
  let last = null;
  return {
    render(steps, work) {
      validSteps(steps);
      const previousTarget = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace();
      const mip = renderer.getActiveMipmapLevel();
      const autoClear = renderer.autoClear;
      let previous = initial;
      last = null;
      try {
        renderer.autoClear = false;
        for (let step = 1; step <= steps; step++) {
          const rec = { step, completed: false, calls: null, triangles: null };
          work.push(rec);
          const target = targets[(step - 1) % 2];
          material.uniforms.uPrevious.value = previous;
          material.uniforms.uStep.value = step;
          renderer.setRenderTarget(target);
          const calls = renderer.info.render.calls;
          const triangles = renderer.info.render.triangles;
          try {
            renderer.render(mesh, camera);
            rec.completed = true;
          } finally {
            rec.calls = renderer.info.render.calls - calls;
            rec.triangles = renderer.info.render.triangles - triangles;
          }
          previous = target.texture;
          last = { target, steps: step };
        }
      } finally {
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(previousTarget, face, mip);
      }
    },
    read() {
      if (!last) throw new Error('No dependent output was rendered');
      const points = POINTS.map(([x, y]) => {
        const actual = new Uint8Array(4);
        renderer.readRenderTargetPixels(last.target, x, y, 1, 1, actual);
        const expected = expectedDependentBytes(last.steps, x, y);
        return { x, y, actual: Array.from(actual), expected, matches: expected.every((v, channel) => actual[channel] === v) };
      });
      const checksum = (key) => points.flatMap((point) => point[key]).map((v) => v.toString(16).padStart(2, '0')).join('');
      return { steps: last.steps, side: DEPENDENT_SIDE, points, sampleChecksum: checksum('actual'), expectedSampleChecksum: checksum('expected'), matches: points.every((point) => point.matches) };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      initial.dispose();
      for (const target of targets) target.dispose();
    },
  };
}
