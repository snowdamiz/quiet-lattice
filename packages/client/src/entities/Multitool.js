// First-person mining tool: viewmodel, beam, heat and resource extraction.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyPanelDetail } from '../render/panelMaterial.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Multitool {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.overheated = false;
    this.firing = false;
    this.target = null;
    this.power = 1.6;
    this.heatRate = 0.32;
    this.kick = 0;
    this.buildViewModel();
    this.buildBeam();
  }

  upgrade() {
    this.power = 2.4;
    this.heatRate = 0.22;
  }

  buildViewModel() {
    const g = new THREE.Group();
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6fe3ff, emissiveIntensity: 2 });
    g.position.set(0.15, -0.12, -0.42);
    g.rotation.set(0.03, 0.06, 0);
    g.scale.setScalar(0.64);
    this.view = g;
    this.basePos = g.position.clone();
    this.swayX = 0;
    this.swayY = 0;
    this.stride = 0;
    this.game.engine.viewScene.add(g);
    g.visible = false;
    new GLTFLoader().load('/models/multitool.glb', (gltf) => {
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material.name === 'ToolGlow') o.material = this.glowMat;
        else if (o.material.name === 'ToolBody' || o.material.name === 'ToolAccent') {
          // the model carries its own panelling; just a hint of wear, and keep the white shell off clipping
          if (o.material.name === 'ToolBody') o.material.color.multiplyScalar(0.82);
          applyPanelDetail(o.material, { scale: 9, strength: 0.15 });
        }
      });
      g.add(gltf.scene);
    });
    // muzzle flash light in the view scene
    this.vmLight = new THREE.PointLight(0xff9a50, 0, 2, 2);
    this.vmLight.position.set(0.17, -0.12, -0.75);
    this.game.engine.viewScene.add(this.vmLight);
  }

  buildBeam() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.5, 0.2) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uColor;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float pulse = 0.7 + 0.3 * sin(vUv.y * 60.0 - uTime * 40.0);
          float a = pow(edge, 2.0) * pulse;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), pow(edge, 6.0)) * a * 5.0, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.game.engine.scene.add(this.beam);
    // impact glow
    const spark = new THREE.SpriteMaterial({ color: new THREE.Color(2.2, 0.9, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: radialTexture() });
    this.spark = new THREE.Sprite(spark);
    this.spark.visible = false;
    this.game.engine.scene.add(this.spark);
    this.hitLight = new THREE.PointLight(0xff8a40, 0, 12, 2);
    this.game.engine.scene.add(this.hitLight);
  }

  update(dt, input, active) {
    const g = this.game;
    // hidden while the camera is still easing in from the ship
    this.view.visible = g.mode === 'foot' && !g.player.headUnderwater && !g.camBlend && !g.poseBlend;
    // and raised into view once it has arrived
    this.raise = this.view.visible ? Math.min(1, (this.raise ?? 1) + dt * 2.6) : 0;
    this.beamMat.uniforms.uTime.value += dt;
    const wantFire = active && input.mouse(0) && !this.overheated;
    if (this.overheated) {
      this.heat = Math.max(0, this.heat - dt * 0.45);
      if (this.heat < 0.25) this.overheated = false;
    }
    this.target = null;
    let hitPoint = null;
    if (g.mode === 'foot') {
      const frame = g.cam.frame;
      const origin = g.cam.pos;
      const dir = _v.set(0, 0, -1).applyQuaternion(g.cam.quat).clone();
      const hit = g.flora.raycast(origin, dir, 30);
      if (hit) {
        this.target = hit;
        hitPoint = hit.point;
      } else if (wantFire && frame && frame.sampler) {
        // march terrain for beam end
        for (let t = 1; t < 30; t += 0.75) {
          const p = _v2.copy(origin).addScaledVector(dir, t);
          const r = p.length();
          if (r < frame.surfaceRadius(p.clone().divideScalar(r))) {
            hitPoint = p.clone();
            break;
          }
        }
      }
      if (wantFire) {
        this.heat = Math.min(1, this.heat + dt * this.heatRate);
        if (this.heat >= 1) {
          this.overheated = true;
          g.hud.toast('Mining beam overheated', 'warn');
        }
        if (this.target) {
          const res = g.flora.hit(this.target, this.power * dt);
          if (res && res.res) {
            g.inventory.add(res.res, res.amount);
            g.hud.pickup(res.res, res.amount);
            g.audio.play('break');
            g.audio.play('pickup');
          }
        }
      } else if (!this.overheated) {
        this.heat = Math.max(0, this.heat - dt * 0.6);
      }
    }
    this.firing = wantFire && g.mode === 'foot';

    // beam visual (world space relative to camera)
    if (this.firing) {
      const frame = g.cam.frame;
      const start = _v.set(0.16, -0.14, -0.66).applyQuaternion(g.camWorldQuat);
      let end;
      if (hitPoint && frame) end = frame.localToWorld(hitPoint, new THREE.Vector3()).sub(g.camWorld);
      else end = new THREE.Vector3(0, 0, -30).applyQuaternion(g.camWorldQuat);
      const len = start.distanceTo(end);
      this.beam.visible = true;
      this.beam.position.copy(start);
      this.beam.lookAt(end);
      // lookAt points +Z at the target for non-cameras; geometry extends along +Z
      const w = 0.025 + Math.sin(g.time * 50) * 0.006;
      this.beam.scale.set(w, w, len);
      this.spark.visible = !!hitPoint;
      if (hitPoint) {
        // keep the impact readable at point-blank range: shrink the glare with distance
        const dist = end.length();
        const near = THREE.MathUtils.clamp((dist - 1) / 6, 0.15, 1);
        this.spark.position.copy(end);
        const s = (0.5 + Math.random() * 0.4) * near;
        this.spark.scale.set(s, s, s);
        this.spark.material.opacity = 0.4 + 0.6 * near;
        this.hitLight.position.copy(end).addScaledVector(end.clone().normalize(), -Math.min(0.5, dist * 0.2));
        this.hitLight.intensity = (12 + Math.random() * 8) * near * near;
      } else this.hitLight.intensity = 0;
      this.kick = Math.min(1, this.kick + dt * 8);
      this.vmLight.intensity = 0.6 + Math.random() * 0.4;
      this.beamMat.uniforms.uColor.value.setRGB(1.0, 0.5 - this.heat * 0.3, 0.2);
    } else {
      this.beam.visible = false;
      this.spark.visible = false;
      this.hitLight.intensity = 0;
      this.vmLight.intensity = 0;
      this.kick = Math.max(0, this.kick - dt * 6);
    }

    // viewmodel sway / bob: the tool trails the look direction and rocks with the stride
    const p = g.player;
    const bob = p.grounded ? p.bob : 0;
    const k = 1 - Math.exp(-dt * 9);
    this.swayX += (THREE.MathUtils.clamp(-(input.mouseDX || 0) * 0.0007, -0.035, 0.035) - this.swayX) * k;
    this.swayY += (THREE.MathUtils.clamp((input.mouseDY || 0) * 0.0007, -0.03, 0.03) - this.swayY) * k;
    const stride = THREE.MathUtils.damp(this.stride, p.grounded ? Math.min(1, p.hSpeed / 4.5) : 0, 6, dt);
    this.stride = stride;
    this.view.position.copy(this.basePos);
    this.view.position.x += Math.sin(bob) * 0.016 * stride + this.swayX;
    this.view.position.y += -Math.abs(Math.cos(bob)) * 0.014 * stride - p.landShake * 0.04 + this.swayY;
    this.view.position.z += this.kick * 0.015 + (Math.random() - 0.5) * this.kick * 0.004;
    this.view.rotation.set(0.03 + this.swayY * 2.5, 0.06 + this.swayX * 3, this.swayX * 4 + Math.sin(bob) * 0.02 * stride);
    const low = 1 - this.raise * this.raise * (3 - 2 * this.raise);
    this.view.position.y -= low * 0.32;
    this.view.rotation.x -= low * 0.7;
    this.glowMat.emissive.setRGB(0.4 + this.heat * 0.6, 0.9 - this.heat * 0.6, 1.0 - this.heat * 0.8);
    this.glowMat.emissiveIntensity = 1.5 + (this.firing ? 2 : 0);
  }
}

let _radial = null;
function radialTexture() {
  if (_radial) return _radial;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,200,150,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _radial = new THREE.CanvasTexture(c);
  return _radial;
}
export { radialTexture };
