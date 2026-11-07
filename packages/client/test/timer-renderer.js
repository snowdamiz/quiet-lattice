// CPU renderer stand-in for resource/state/recording tests. It does not compile shaders or prove GPU behavior.
export function timerRenderer(onDraw = () => {}, options = {}) {
  const original = { name: 'original target' };
  const state = { target: original, face: 2, mip: 3, drawCount: 0, readCount: 0, disposed: new Set(), seen: new Set(), ...options };
  const samplers = new WeakMap();
  const watch = (resource) => {
    if (state.seen.has(resource)) return;
    state.seen.add(resource);
    resource.addEventListener('dispose', () => state.disposed.add(resource));
  };
  const renderer = {
    autoClear: true,
    info: { render: { calls: 0, triangles: 0 } },
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => state.face,
    getActiveMipmapLevel: () => state.mip,
    setRenderTarget(target, face = 0, mip = 0) {
      state.target = target;
      state.face = face;
      state.mip = mip;
      if (target?.isWebGLRenderTarget) watch(target);
    },
    render(mesh) {
      state.drawCount++;
      watch(mesh.geometry);
      watch(mesh.material);
      const previous = mesh.material.uniforms.uPrevious.value;
      if (previous.isDataTexture) watch(previous);
      const sample = previous.isDataTexture
        ? (x, y) => Array.from(previous.image.data.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 4))
        : samplers.get(previous);
      const step = mesh.material.uniforms.uStep.value;
      const output = (x, y) => {
        const before = sample((x + step) % 256, (y + step * 2) % 256);
        const add = [3 + step + (x % 7), 5 + step + (y % 11), 7 + step + ((x + y) % 13), 11 + step];
        return before.map((v, channel) => (v + add[channel]) % 251);
      };
      samplers.set(state.target.texture, output);
      renderer.info.render.calls++;
      renderer.info.render.triangles++;
      onDraw();
      if (state.drawCount === state.failDraw) throw new Error('Dependent draw failed');
    },
    readRenderTargetPixels(target, x, y, width, height, bytes) {
      state.beforeRead?.();
      state.readCount++;
      bytes.set(samplers.get(target.texture)(x, y));
      if (state.corruptReadback) bytes[0] ^= 1;
    },
  };
  return { renderer, state, original };
}
