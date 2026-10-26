// World-space speed streaks: specks of dust or moisture fixed in the world, drawn as short lines
// along the flight direction that lengthen with speed. Close to the camera and moving past it with
// parallax, they give pace where the ground or the stars are too far away to.
import * as THREE from 'three';

const N = 260;
const BOX = 90;

export class SpeedLines {
  constructor() {
    this.pts = new Float32Array(N * 3);
    for (let i = 0; i < this.pts.length; i++) this.pts[i] = (Math.random() * 2 - 1) * BOX;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(N * 6), 3);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(N * 2), 1);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vA;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vA = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vA;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(uColor * vA * uOpacity, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.opacity = 0;
  }

  // vel: velocity in world axes (m/s); the camera sits at the origin (floating origin)
  update(dt, vel, strength, color) {
    this.opacity = THREE.MathUtils.damp(this.opacity, strength, 3, dt);
    this.mesh.visible = this.opacity > 0.01;
    if (!this.mesh.visible) return;
    if (color) this.material.uniforms.uColor.value.copy(color);
    this.material.uniforms.uOpacity.value = this.opacity;
    const speed = vel.length();
    // a streak is where the speck was a moment ago; long enough to read, never a full stripe
    const len = Math.min(45, speed * 0.035) / Math.max(speed, 1e-3);
    const p = this.pts;
    const pos = this.posAttr.array;
    const al = this.alphaAttr.array;
    const mx = -vel.x * dt;
    const my = -vel.y * dt;
    const mz = -vel.z * dt;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      let x = p[o] + mx;
      let y = p[o + 1] + my;
      let z = p[o + 2] + mz;
      // wrap through the box round the camera, so the specks never run out
      if (x > BOX) x -= 2 * BOX;
      else if (x < -BOX) x += 2 * BOX;
      if (y > BOX) y -= 2 * BOX;
      else if (y < -BOX) y += 2 * BOX;
      if (z > BOX) z -= 2 * BOX;
      else if (z < -BOX) z += 2 * BOX;
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = z;
      const d = Math.hypot(x, y, z);
      // faint far out, gone right at the lens (no streak sweeping across the whole screen)
      const a = (1 - d / (BOX * 1.73)) * Math.min(1, Math.max(0, (d - 4) / 10));
      const v = o * 2;
      pos[v] = x;
      pos[v + 1] = y;
      pos[v + 2] = z;
      pos[v + 3] = x + vel.x * len;
      pos[v + 4] = y + vel.y * len;
      pos[v + 5] = z + vel.z * len;
      al[i * 2] = a;
      al[i * 2 + 1] = 0;
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}
