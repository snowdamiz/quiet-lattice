// Renderer + post-processing chain:
// scene (HDR, log depth, MSAA) -> atmosphere/ocean/clouds -> ship FX -> viewmodel -> bloom -> grade/tonemap
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { AtmospherePass } from '../render/AtmospherePass.js';
import { FX_LAYER, fxUniforms } from '../render/ShipFx.js';

class ViewModelPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.enabled = true;
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.scene.children.length) return;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

// The ship's glowing effects (jets, re-entry plasma), after the atmosphere so its haze does not
// wash them out: their own layer, drawn over the hazed image with the scene's depth bound for them
// to test against (see render/ShipFx.js).
class FxPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.fxCamera = new THREE.PerspectiveCamera();
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    // (the atmosphere pass has swapped: the scene and its depth are in writeBuffer now)
    fxUniforms.tSceneDepth.value = writeBuffer.depthTexture;
    fxUniforms.uFxFar.value = this.camera.far;
    const cam = this.fxCamera;
    cam.copy(this.camera);
    cam.layers.set(FX_LAYER);
    const bg = this.scene.background;
    this.scene.background = null;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.render(this.scene, cam);
    renderer.autoClear = ac;
    this.scene.background = bg;
  }
}

class GradePass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      uExposure: { value: 1.2 },
      uTime: { value: 0 },
      uVignette: { value: 0.2 },
      uFlash: { value: new THREE.Vector4(0, 0, 0, 0) },
      uWarp: { value: 0 },
      uDamage: { value: 0 },
      tDepth: { value: null },
      uSunUV: { value: new THREE.Vector2(-1, -1) },
      uSunVis: { value: 0 },
      tCloud: { value: null },
      uCloudOn: { value: 0 },
      uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
      uAspect: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uTime;
        uniform float uVignette;
        uniform vec4 uFlash;
        uniform float uWarp;
        uniform float uDamage;
        uniform sampler2D tDepth;
        uniform vec2 uSunUV;
        uniform float uSunVis;
        uniform sampler2D tCloud;
        uniform float uCloudOn;
        uniform vec3 uSunCol;
        uniform float uAspect;
        varying vec2 vUv;
        vec3 flare(vec2 uv) {
          if (uSunVis <= 0.001) return vec3(0.0);
          // occlusion from the scene depth around the sun
          float occ = 0.0;
          for (int i = 0; i < 9; i++) {
            vec2 o = vec2(float(i % 3) - 1.0, float(i / 3) - 1.0) * 0.006;
            occ += step(0.9999999, texture2D(tDepth, uSunUV + o).x);
          }
          float vis = (occ / 9.0) * uSunVis;
          // and by the nearby cloud deck (its half-res transmittance)
          if (uCloudOn > 0.5) {
            float tr = 0.0;
            for (int i = 0; i < 5; i++) {
              vec2 o = vec2(float(i % 3) - 1.0, float(i / 3) - 0.5) * 0.008;
              tr += texture2D(tCloud, clamp(uSunUV + o, 0.0, 1.0)).a;
            }
            vis *= smoothstep(0.15, 0.9, tr / 5.0);
          }
          if (vis <= 0.001) return vec3(0.0);
          vec2 asp = vec2(uAspect, 1.0);
          vec2 d = (uv - uSunUV) * asp;
          vec3 c = vec3(0.0);
          // anamorphic streak, a fine six-point starburst and a tight core glare
          float dl = length(d);
          float ang = atan(d.y, d.x);
          float spikes = pow(abs(cos(ang * 3.0 + 0.3)), 220.0) + 0.5 * pow(abs(cos(ang * 3.0 + 0.82)), 400.0);
          c += uSunCol * exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 7.0) * 0.16;
          c += uSunCol * spikes * exp(-dl * 5.0) * 0.14;
          c += uSunCol * (exp(-dl * 45.0) * 0.7 + exp(-dl * 9.0) * 0.16);
          // ghosts along the axis through the screen centre
          vec2 axis = vec2(0.5) - uSunUV;
          for (int i = 0; i < 5; i++) {
            float k = 0.5 + float(i) * 0.38;
            vec2 gp = uSunUV + axis * k * 2.0;
            float r = 0.025 + float(i) * 0.018;
            float gd = length((uv - gp) * asp);
            vec3 tint = mix(vec3(0.4, 0.7, 1.0), vec3(1.0, 0.6, 0.3), fract(float(i) * 0.37));
            c += tint * smoothstep(r, r * 0.4, gd) * 0.035;
          }
          return c * vis;
        }
        vec3 aces(vec3 x) {
          const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          vec2 cc = uv - 0.5;
          float r2 = dot(cc, cc);
          // chromatic aberration only as an effect (warp, damage): at rest it fringes every star
          float ca = uWarp * 0.005 + uDamage * 0.01;
          vec3 col;
          col.r = texture2D(tDiffuse, uv - cc * ca * r2 * 4.0).r;
          col.g = texture2D(tDiffuse, uv).g;
          col.b = texture2D(tDiffuse, uv + cc * ca * r2 * 4.0).b;
          col *= uExposure;
          col += flare(uv);
          col = aces(col);
          col = pow(col, vec3(1.0 / 2.2));
          // a touch more colour: the physical sky and haze alone leave the scene greyish
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(lum), col, 1.08);
          // split tone: cool shade, warm light
          col *= mix(vec3(0.96, 0.99, 1.05), vec3(1.025, 1.0, 0.97), smoothstep(0.08, 0.65, lum));
          // vignette
          col *= mix(1.0, smoothstep(0.85, 0.2, r2 * 2.0), uVignette);
          col = mix(col, uFlash.rgb, uFlash.a);
          col += (hash(uv * 1000.0 + uTime) - 0.5) * 0.006;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}

const _size = new THREE.Vector2();

// Exported models carry their textures as KTX2 (Basis Universal, KHR_texture_basisu: P1.E14.T12), transcoded in a
// worker to whatever compressed format this GPU reads (ASTC, BC7, ETC2, BC1/3) and left compressed on the GPU. The Basis
// transcoder is served from public/basis/ (a copy of three's examples/jsm/libs/basis, kept equal by a unit test). Their
// geometry is quantized and meshopt-compressed (KHR_mesh_quantization, EXT_meshopt_compression), which three's
// MeshoptDecoder (WebAssembly inlined in the module) unpacks.
export const BASIS_TRANSCODER_PATH = '/basis/';
let ktx2Loader = null;

/** The one KTX2 loader, set up for `renderer`'s compressed formats (the Engine does this once, at startup). */
export function initTextureLoaders(renderer) {
  ktx2Loader ??= new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH);
  ktx2Loader.detectSupport(renderer);
  return ktx2Loader;
}

/** A GLTFLoader that reads KTX2 textures and meshopt-compressed geometry. Every model load goes through one: before the
 * Engine exists, a model with KTX2 textures fails to load (GLTFLoader asks for setKTX2Loader), one without loads as
 * before. */
export function gltfLoader() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  if (ktx2Loader) loader.setKTX2Loader(ktx2Loader);
  return loader;
}

export class Engine {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.maxPixelRatio = Math.min(window.devicePixelRatio, 1.5);
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    initTextureLoaders(renderer);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1e9);
    this.scene.add(this.camera);

    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.01, 50);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
    });
    rt.depthTexture.format = THREE.DepthFormat;
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.atmoPass = new AtmospherePass();
    this.fxPass = new FxPass(this.scene, this.camera);
    this.viewPass = new ViewModelPass(this.viewScene, this.viewCamera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.55, 1.2);
    this.gradePass = new GradePass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.atmoPass);
    this.composer.addPass(this.fxPass);
    this.composer.addPass(this.viewPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gradePass);

    window.addEventListener('resize', () => this.resize());
  }

  // Adaptive resolution: keep frame time near the target by scaling the pixel ratio.
  adapt(dt) {
    this._acc = (this._acc || 0) + dt;
    this._frames = (this._frames || 0) + 1;
    if (this._acc < 1.5) return;
    const avg = this._acc / this._frames;
    this._acc = 0;
    this._frames = 0;
    let pr = this.pixelRatio;
    if (avg > 1 / 45) pr -= 0.1;
    else if (avg < 1 / 75) pr += 0.1;
    pr = Math.min(this.maxPixelRatio, Math.max(0.55, pr));
    if (Math.abs(pr - this.pixelRatio) > 0.01) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.resize();
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
  }

  render(dt) {
    const cam = this.camera;
    const u = this.atmoPass.uniforms;
    u.uCamWorld.value.copy(cam.matrixWorld);
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    u.uTanFov.value.set(tanY * cam.aspect, tanY);
    // angle covered by one pixel, for picking noise mip levels in the cloud march
    u.uPixelAngle.value = (2 * tanY) / Math.max(1, this.renderer.getDrawingBufferSize(_size).y);
    u.uFar.value = cam.far;
    this.renderer.info.reset();
    this.composer.render(dt);
  }
}
