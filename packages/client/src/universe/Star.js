// The system's star: animated emissive surface + additive corona billboard.
import * as THREE from 'three';
import { Body } from './Body.js';
import { SIMPLEX3 } from '../render/glsl.js';

export class Star extends Body {
  constructor(opts) {
    super({ ...opts, kind: 'star' });
    this.color = new THREE.Color(opts.color || 0xfff1d0);
    this.lightColor = this.color.clone().lerp(new THREE.Color(1, 1, 1), 0.55);
    this.surfaceMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: this.color.clone() },
        // bright enough to bloom a little, not so bright the bloom swallows the disc
        uIntensity: { value: 8 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vPos;
        varying vec3 vViewDir;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vNormal;
        varying vec3 vPos;
        varying vec3 vViewDir;
        #include <logdepthbuf_pars_fragment>
        ${SIMPLEX3}
        void main() {
          #include <logdepthbuf_fragment>
          vec3 p = normalize(vPos);
          float g = fbm5(p * 18.0 + vec3(uTime * 0.02));
          float spots = smoothstep(0.55, 0.75, fbm3(p * 3.0 + vec3(uTime * 0.005)));
          float mu = max(dot(normalize(vNormal), vViewDir), 0.0);
          float limb = pow(mu, 0.45);
          vec3 c = uColor * (0.85 + 0.3 * g) * (1.0 - spots * 0.5);
          c = mix(c * vec3(1.0, 0.6, 0.35), c, limb);
          gl_FragColor = vec4(c * uIntensity * (0.4 + 0.6 * limb), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(this.radius, 96, 48), this.surfaceMat);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);

    this.coronaMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.color.clone() },
        uTime: { value: 0 },
        uFade: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vUv = uv * 2.0 - 1.0;
          // camera-facing billboard
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(vec3(modelMatrix[0].x, modelMatrix[0].y, modelMatrix[0].z));
          mv.xy += position.xy * s;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uFade;
        varying vec2 vUv;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(vUv);
          float a = atan(vUv.y, vUv.x);
          // a tight inner corona so the disc keeps a crisp edge, then a faint wide halo
          float glow = exp(-r * 16.0) * 1.4 + exp(-r * 5.0) * 0.22 + exp(-r * 2.0) * 0.07;
          float rays = pow(abs(sin(a * 7.0 + 0.3)), 18.0) + pow(abs(sin(a * 11.0 - 0.7)), 30.0) * 0.6;
          glow += rays * exp(-r * 4.5) * 0.05;
          glow *= smoothstep(1.0, 0.6, r);
          gl_FragColor = vec4(uColor * glow * 3.0 * uFade, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.coronaMat);
    this.corona.scale.setScalar(this.radius * 9);
    this.corona.frustumCulled = false;
    this.corona.renderOrder = 5;
    this.root.add(this.corona);
  }

  updateVisual(time) {
    this.surfaceMat.uniforms.uTime.value = time;
    this.coronaMat.uniforms.uTime.value = time;
  }
}
