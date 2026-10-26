import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { WorkerPool } from './terrain/WorkerPool.js';
import { SolarSystem } from './universe/SolarSystem.js';
import { Station, HANGAR } from './universe/Station.js';
import { FrameState } from './universe/Body.js';
import { UniverseSky } from './render/UniverseSky.js';
import { Weather } from './render/Weather.js';
import { SpeedLines } from './render/SpeedLines.js';
import { Lightning } from './render/Lightning.js';
import { MAX_PLANETS } from './render/AtmospherePass.js';
import { Ship, GEAR_HEIGHT } from './entities/Ship.js';
import { Player } from './entities/Player.js';
import { Multitool } from './entities/Multitool.js';
import { Traffic } from './entities/Traffic.js';
import { Pirates } from './entities/Pirates.js';
import { Flora } from './gameplay/Flora.js';
import { Fauna } from './gameplay/Fauna.js';
import { Structures } from './gameplay/Structures.js';
import { Cities } from './gameplay/Cities.js';
import { streetPlan, cityFrame, cityPoint, Galaxy, GALAXY_SEED, LY, describeGalaxySystem, mistHazard } from '@astra/shared/world';
import { detects, sensorRange } from '@astra/shared/ships';
import { Objectives } from './gameplay/Objectives.js';
import { Asteroids } from './universe/Asteroids.js';
import { Inventory } from './gameplay/Inventory.js';
import { HUD } from './ui/HUD.js';
import { Menus } from './ui/Menus.js';
import { Audio } from './audio/Audio.js';
import { loadLibrary } from './gameplay/modelLibrary.js';
import { Universe } from './universe/Universe.js';
import { saveGame, loadSave, applySave, clearSave } from './gameplay/Save.js';
import { collectResources, disposeTree } from './core/dispose.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _c1 = new THREE.Color();
const _m4 = new THREE.Matrix4();
// in ship space: moves into or out of the seat drop vertically through the canopy glass above
// the pilot (between the frame bars), and from the chase view they first rise over the hull
const SEAT_ABOVE = new THREE.Vector3(0, 5.6, -0.6);
const HULL_ABOVE = new THREE.Vector3(0, 9, 7);
const _v2b = new THREE.Vector2();

export class Game {
  constructor(container, hudEl) {
    this.engine = new Engine(container);
    this.input = new Input(this.engine.renderer.domElement);
    this.hudEl = hudEl;
    const workers = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
    this.pool = new WorkerPool(workers);
    this.sky = new UniverseSky(this.engine.renderer);
    this.engine.scene.add(this.sky.group);
    this.bolts = new Lightning(this);
    this.speedLines = new SpeedLines();
    this.engine.scene.add(this.speedLines.mesh);
    this.audio = new Audio();
    this.inventory = new Inventory();
    this.galaxy = new Galaxy(GALAXY_SEED);
    this.sky.setSystems(this.galaxy.systems);
    this.universe = new Universe(this);
    this.time = 0;
    this.camWorld = new THREE.Vector3();
    this.camWorldQuat = new THREE.Quaternion();
    this.camWorldQuatInv = new THREE.Quaternion();
    this.cam = new FrameState();
    this.mode = 'title';
    this.overlay = null;
    this.discovered = new Set();
    this.discoveredNames = new Set();
    this.saveTimer = 0;
    this.navTarget = null;
    this.scanMarkers = [];
    this.scanCooldown = 0;
    this.speedEffect = 0;
    this.fov = 70;

    this.setupLights();
    this.pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    this.envScene = this.buildEnvScene();

    this.ship = new Ship(this);
    this.engine.scene.add(this.ship.group);
    this.player = new Player(this);
    this.multitool = new Multitool(this);
    this.traffic = new Traffic(this);
    this.pirates = new Pirates(this);
    this.flora = new Flora(this);
    this.engine.scene.add(this.flora.group);
    this.fauna = new Fauna(this);
    this.structures = new Structures(this);
    this.cities = new Cities(this);
    this.asteroids = new Asteroids(this);
    this.engine.scene.add(this.asteroids.group);

    this.weather = new Weather(this);
    this.objectives = new Objectives(this);
    this.hud = new HUD(this, hudEl);
    this.menus = new Menus(this);

    this.debugEl = document.createElement('div');
    this.debugEl.id = 'debug';
    this.debugEl.style.display = 'none';
    document.body.appendChild(this.debugEl);

    this.loadSystem(this.galaxy.current);
    this.engine.renderer.domElement.addEventListener('click', () => {
      if ((this.mode === 'ship' || this.mode === 'foot') && !this.overlay) this.input.lock();
    });
    document.addEventListener('pointerlockchange', () => this.menus.updatePauseHint());
  }

  setupLights() {
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 1;
    sc.far = 1600;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.04;
    this.engine.scene.add(this.sunLight, this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0x8fb4ff, 0x302820, 0.6);
    this.engine.scene.add(this.hemi);
    // viewmodel lights mirror the world lights
    this.vmSun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.6);
    this.engine.viewScene.add(this.vmSun, this.vmSun.target, this.vmHemi);
  }

  buildEnvScene() {
    const scene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uSky: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uSun; uniform vec3 uSunCol; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = mix(uGround, uSky, smoothstep(-0.15, 0.25, h));
        c += uSunCol * pow(max(dot(normalize(vDir), uSun), 0.0), 64.0) * 4.0;
        gl_FragColor = vec4(c, 1.0); }`,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
    this.envMat = mat;
    return scene;
  }

  // ---------- systems ----------
  // A system and its station, built a step at a time (a planet or moon, a section of the
  // station per step), so the next one can be readied over frames while the ship approaches it.
  // `out` holds whatever is built so far, so an abandoned one can be freed.
  *buildSystem(sysInfo, out = {}) {
    // (described as the server describes it: the three peoples' home systems round their home worlds and capitals)
    const system = (out.system = new SolarSystem(describeGalaxySystem(sysInfo), this.pool, { staged: true }));
    system.info = sysInfo;
    yield;
    while (!system.step()) yield;
    // the Waystation, in low orbit round the home world, as the system's description places it
    const spec = system.description.station;
    const station = (out.station = new Station({
      name: spec.name,
      parent: system.planets[spec.parent],
      radius: spec.radius,
      orbitRadius: spec.orbitRadius,
      orbitPeriod: spec.orbitPeriod,
      orbitPhase: spec.orbitPhase,
      orbitTilt: new THREE.Quaternion().fromArray(spec.orbitTilt),
      soi: spec.soi,
      seed: spec.seed,
      staged: true,
    }));
    yield;
    while (!station.step()) yield;
    return { system, station };
  }

  // frees a system and its station (terrain chunks go back to the shared pool; everything else is
  // freed, except resources shared with the player's ship: NPC clones, wrecks). Deferred, it is
  // taken out of the scene now and freed a few frames later, once its successor has drawn: freed
  // first, its shader programs went with it and the next system's identical ones were compiled
  // again, a tenth of a second on the frame of arrival.
  disposeSystem(system, station, deferred = false) {
    if (deferred) {
      if (system) for (const b of system.bodies) this.engine.scene.remove(b.root);
      if (station) this.engine.scene.remove(station.root);
      (this.graveyard ||= []).push({ system, station, frames: 4 });
      return;
    }
    const keep = this.ship.model ? collectResources(this.ship.model) : new Set();
    if (system) {
      system.dispose();
      for (const b of system.bodies) {
        this.engine.scene.remove(b.root);
        disposeTree(b.root, keep);
      }
    }
    if (station) {
      this.engine.scene.remove(station.root);
      disposeTree(station.root, keep);
    }
  }

  // swaps in a system: built here and now, or handed over ready (flown into from deep space,
  // `seamless`: the camera has not jumped, so the sky need not be redrawn)
  loadSystem(sysInfo, { built = null, seamless = false } = {}) {
    // (readied during the approach, if it was)
    if (!built) built = this.universe.takePrep(sysInfo);
    if (!built) {
      const it = this.buildSystem(sysInfo);
      let r;
      while (!(r = it.next()).done);
      built = r.value;
    }
    if (this.system) this.disposeSystem(this.system, this.station, true);
    this.flora.reset();
    this.pirates?.clear();
    this.fauna.setPlanet(null);
    this.structures.setPlanet(null);
    this.cities.setPlanet(null);
    this.system = built.system;
    this.station = built.station;
    this.universe.reset(sysInfo);
    for (const b of this.system.bodies) this.engine.scene.add(b.root);
    this.engine.scene.add(this.station.root);
    if (this.ship.model) this.traffic.attach(this.station);
    // after a jump the sky is redrawn from the new place before the next frame; flown into, the
    // planets wake over the next few frames instead
    if (!seamless) this.sky.reset();
    else this.system.waking = 0;
    this.asteroids.configure(this.system);
    this.system.update(this.time);
    this.station.update(this.time);
    this.audio.setMood(sysInfo.seed);
    this.envKey = 'space';
  }

  // image light for open space, from the sky as it now stands
  refreshSpaceEnv() {
    if (this.spaceEnvRT) this.spaceEnvRT.dispose();
    this.spaceEnvRT = this.pmrem.fromCubemap(this.sky.texture);
    this.spaceEnv = this.spaceEnvRT.texture;
    this.spaceEnvTime = this.time;
    if (this.envKey === 'space') {
      this.engine.scene.environment = this.spaceEnv;
      this.engine.viewScene.environment = this.spaceEnv;
    }
  }

  placeShipNearStation() {
    const s = this.ship.state;
    s.frame = this.station;
    // above and in front of the hangar, pitched down so the planet's limb frames the station
    s.pos.set(250, 1200, 2400);
    s.vel.set(0, 0, 0);
    _m4.lookAt(s.pos, new THREE.Vector3(0, -700, 0), new THREE.Vector3(0, 1, 0));
    s.quat.setFromRotationMatrix(_m4);
    this.ship.mode = 'flying';
    this.ship.speed = 0;
    this.cam.frame = undefined;
  }

  startGame(continueSave = false) {
    this.audio.start();
    if (continueSave) {
      const data = loadSave();
      if (data) applySave(this, data);
    } else clearSave();
    this.placeShipNearStation();
    if (continueSave && this.pendingDeep) this.universe.restore(this.pendingDeep);
    this.pendingDeep = null;
    this.mode = 'ship';
    this.hud.setVisible(true);
    this.input.lock();
    setTimeout(() => {
      this.hud.showBanner(this.system.name.toUpperCase(), 'Star System');
      this.audio.play('discovery');
    }, 600);
  }

  start() {
    this.last = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = (now - this.last) / 1000;
      this.last = now;
      dt = Math.min(dt, 0.066);
      this.frame(dt);
      if (!document.hidden) this.engine.adapt(dt);
    };
    // ship and model libraries load together; planets build their flora from the libraries
    Promise.all([this.ship.load(), loadLibrary('flora', '/models/flora.glb'), loadLibrary('creatures', '/models/creatures.glb'), loadLibrary('structures', '/models/structures.glb')]).then(() => {
      this.traffic.attach(this.station);
      this.menus.onLoaded();
    });
    loop();
  }

  // ---------- frame selection ----------
  chooseFrame(state) {
    const wp = state.worldPosition(_v1);
    const cur = state.frame;
    // hysteresis: stay in current frame until 5% beyond its SOI
    if (cur && cur.distanceTo(wp) < cur.soi * 1.05) {
      const inner = this.system.frameFor(wp, [this.station]);
      if (inner && inner !== cur && inner.soi < cur.soi) return inner;
      return cur;
    }
    return this.system.frameFor(wp, [this.station]);
  }

  // ---------- main loop ----------
  frame(dt) {
    const inp = this.input;
    const playing = (this.mode === 'ship' || this.mode === 'foot') && !this.overlay;
    inp.enabled = playing && inp.locked;
    this.time += dt;
    this.universe.update();
    this.system.update(this.time);
    this.station.update(this.time);

    if (this.mode === 'title') {
      this.updateTitleCamera(dt);
    } else {
      this.ship.update(dt, inp, this.mode === 'ship' && inp.enabled);
      this.ship.state.setFrame(this.chooseFrame(this.ship.state));
      this.pirates.update(dt);
      if (this.mode === 'foot') {
        this.player.update(dt, inp);
        this.player.state.setFrame(this.chooseFrame(this.player.state));
        this.updateSurvival(dt);
      }
      // during a glide the views compute their own pose, and the glide places the real camera
      const camOut = this.poseBlend ? this.poseBlend.target : this.cam;
      if (this.mode === 'ship') this.ship.updateCamera(dt, inp, camOut);
      else this.player.cameraState(camOut, this.time);
      this.handleInteractions(dt);
      this.checkDiscoveries();
      this.applyCamBlend(dt);
      this.applyPoseBlend(dt);
    }

    this.cam.worldPosition(this.camWorld);
    this.cam.worldQuaternion(this.camWorldQuat);
    this.camWorldQuatInv.copy(this.camWorldQuat).invert();
    this.focusFrame = this.mode === 'foot' ? this.player.state.frame : this.ship.state.frame;
    this.renderFrame(dt);
    if (this.mode !== 'title') this.multitool.update(dt, inp, this.mode === 'foot' && inp.enabled);
    this.hud.update(dt);
    this.menus.update(dt);
    this.updateAudio();
    this.updateDebugText();
    this.objectives.update(dt);
    if (this.mode !== 'title') {
      this.saveTimer += dt;
      if (this.saveTimer > 45) this.save();
    }
    inp.endFrame();
  }

  // The title shot: the ship parked in high orbit over the half-lit home planet, the camera
  // drifting slowly round it with the ship on the right of the frame (the menu has the left).
  updateTitleCamera() {
    const home = this.system.homePlanet;
    const R = home.radius;
    const Y = _v4.set(0, 1, 0);
    const sunDir = _v2.copy(this.system.star.position).sub(home.position).normalize();
    const side = _v3.crossVectors(sunDir, Y).normalize();
    // over the terminator, a little sunward: the planet half day, half night behind the ship
    const dir = _v5.copy(side).multiplyScalar(0.82).addScaledVector(sunDir, 0.42).addScaledVector(Y, 0.38).normalize();
    const s = this.ship.state;
    s.frame = null;
    s.pos.copy(home.position).addScaledVector(dir, R * 1.32);
    s.vel.set(0, 0, 0);
    // nose along the orbit, belly to the planet
    const fwd = _v1.crossVectors(dir, Y).normalize();
    const up = _v6.copy(dir);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    _m4.makeBasis(right, up, fwd.clone().negate());
    s.quat.setFromRotationMatrix(_m4);
    // the camera circles slowly, a little above the ship and behind its quarter
    const a = this.time * 0.035 + 2.4;
    const dist = 27;
    const camPos = new THREE.Vector3()
      .copy(s.pos)
      .addScaledVector(right, Math.cos(a) * dist)
      .addScaledVector(fwd, Math.sin(a) * dist)
      .addScaledVector(up, 7.5);
    this.cam.frame = null;
    this.cam.pos.copy(camPos);
    // look past the ship toward the planet, offset so the ship sits right of centre
    const toShip = s.pos.clone().sub(camPos).normalize();
    const camRight = new THREE.Vector3().crossVectors(toShip, up).normalize();
    const look = s.pos.clone().addScaledVector(camRight, -9.5).addScaledVector(up, -2.5);
    _m4.lookAt(this.cam.pos, look, up);
    this.cam.quat.setFromRotationMatrix(_m4);
  }

  // ---------- gameplay interactions ----------
  handleInteractions() {
    const inp = this.input;
    const ship = this.ship;
    let prompt = '';
    if (this.mode === 'ship') {
      if (ship.mode === 'landed') {
        prompt = '<kbd>F</kbd>Exit ship &nbsp; <kbd>Space</kbd>Take off';
        if (inp.hit('KeyF')) this.exitShip();
        else if (inp.hit('Space') || inp.hit('KeyE')) ship.takeOff();
      } else if (ship.mode === 'flying') {
        // no landing prompts while climbing away after take-off
        const climbing = ship.state.vel.dot(_v1.copy(ship.state.pos).normalize()) > 3;
        const low = ship.frame?.sampler && ship.altitude < 350 && !climbing;
        if (low && ship.overWater()) prompt = 'Over water';
        else if (low && ship.canLand()) prompt = '<kbd>E</kbd>Land';
        else if (low) prompt = '<kbd>S</kbd>Slow down to land';
        // (offered only where it will engage: out of the air and clear of anything close)
        else if ((!ship.frame?.sampler || ship.altitude > 2500) && ship.atmoDensity <= 0.001 && ship.pulseLimit().dist >= 600) prompt = '<kbd>J</kbd>Pulse drive';
      } else if (ship.mode === 'pulse') {
        prompt = '<kbd>J</kbd>Disengage pulse';
      }
    } else if (this.mode === 'foot') {
      const p = this.player;
      if (ship.state.frame === p.state.frame && p.state.pos.distanceTo(ship.state.pos) < 9) {
        prompt = '<kbd>F</kbd>Board ship';
        if (inp.hit('KeyF')) this.boardShip();
      }
      const f = p.state.frame;
      if (f && f.kind === 'station') {
        for (const t of f.terminals) {
          if (p.state.pos.distanceTo(t.pos) < 3.2) {
            prompt = `<kbd>E</kbd>${t.label}`;
            if (inp.hit('KeyE')) this.menus.openTrade(t.label);
          }
        }
      }
      // in a city: its trade post, and its people
      if (!prompt && f && this.cities.planet === f) {
        const kiosk = this.cities.nearKiosk(p.state.pos);
        if (kiosk) {
          prompt = `<kbd>E</kbd>${kiosk.name} trade post`;
          if (inp.hit('KeyE')) this.menus.openTrade('City market', kiosk.name);
        }
        const who = !prompt && this.cities.citizens.facing();
        if (who) {
          prompt = `<kbd>E</kbd>Greet the ${this.cities.species.name}`;
          if (inp.hit('KeyE')) this.cities.citizens.greet(who);
        }
      }
      const site = this.structures.nearestInteract(p.state.pos);
      if (!prompt && site) {
        prompt = `<kbd>E</kbd>${this.structures.promptFor(site)}`;
        if (inp.hit('KeyE')) this.structures.interact(site);
      }
      // whichever is nearer along the aim ray gets the prompt: a creature in front of a
      // tree can be analyzed, a rock in front of a creature can be mined
      let pc = null;
      if (!prompt && f && f.sampler) pc = this.fauna.pick(this.cam.pos, new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quat), 70);
      const tool = this.multitool.target;
      if (!prompt && tool && !(pc && pc.t < tool.t)) prompt = `<kbd>LMB</kbd>Mine ${tool.label}`;
      if (!prompt && pc) {
        const sp = pc.c.sp;
        const known = this.fauna.scanned.has(sp) || this.fauna.scannedNames.has(sp.name);
        prompt = known ? `${sp.name}` : `<kbd>E</kbd>Analyze ${sp.name}`;
        if (!known && inp.hit('KeyE')) {
          this.fauna.scanned.add(sp);
          this.fauna.scannedNames.add(sp.name);
          const reward = 400 + Math.floor(Math.random() * 500);
          this.inventory.units += reward;
          this.audio.play('discovery');
          this.hud.showBanner(sp.name.toUpperCase(), 'New Species Discovered', [`${sp.kind === 'flyer' ? 'Airborne' : sp.kind === 'biped' ? 'Bipedal' : 'Quadruped'} · ${sp.skittish ? 'Skittish' : 'Docile'} · ${(sp.size * 1.2).toFixed(1)} m`, `+${reward} units`]);
        }
        if (this.multitool.firing && pc.t < 35) this.fauna.scare(pc.c);
      }
      if (inp.hit('KeyC')) this.scan();
    }
    if (inp.hit('KeyM')) this.menus.openMap();
    if (inp.hit('KeyH')) this.menus.toggleHelp();
    if (inp.hit('KeyV') && this.mode === 'ship') {
      // chase -> far chase -> cockpit -> chase. Into or out of the seat it is a straight cut (a
      // glide in through the canopy read as a whip-pan through the hull, and a fade up from black
      // as a glitch); between the two chase distances it eases.
      const next = ((this.camView || 0) + 1) % 3;
      if (next === 2 || this.camView === 2) {
        this.camBlend = null;
        this.poseBlend = null;
        this.cam.frame = undefined;
      } else this.startCamBlend(0.7);
      this.camView = next;
      ship.setCockpit(this.camView === 2);
      ship.camDistance = this.camView === 1 ? 1.8 : 1;
    }
    this.currentPrompt = prompt;
  }

  // Ease the camera from where it was to the new viewpoint (between the near and far chase
  // views) instead of cutting. The start pose is kept relative to the ship, so a switch at speed
  // does not leave it behind.
  startCamBlend(dur = 0.9) {
    const s = this.ship.state;
    if (!this.cam.frame || this.cam.frame !== s.frame) return;
    const inv = s.quat.clone().invert();
    this.camBlend = {
      pos: this.cam.pos.clone().sub(s.pos).applyQuaternion(inv),
      quat: inv.multiply(this.cam.quat),
      frame: s.frame, t: 0, dur,
    };
  }

  // Glide the camera from where it is now to a new viewpoint in the same frame (the seat, the
  // chase view, the pilot's eyes on foot), arcing up and over things instead of cutting. The
  // destination keeps being computed as usual, into poseBlend.target. With `seat` the path drops
  // through the canopy glass, and the cockpit interior shows only while the camera is inside.
  startPoseBlend(dur, seat = false) {
    // (between frames, in open space, it falls back to the fade)
    if (!this.cam.frame || this.cam.frame !== this.ship.state.frame) {
      this.startDip(0.45);
      return;
    }
    this.camBlend = null;
    this.dip = null;
    this.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, 0);
    const target = this.poseBlend?.target || new FrameState();
    target.frame = this.cam.frame;
    target.pos.copy(this.cam.pos);
    target.quat.copy(this.cam.quat);
    // the start is held in ship space, so a glide into the seat at speed keeps up with the ship
    const s = this.ship.state;
    const inv = s.quat.clone().invert();
    const pos = this.cam.pos.clone().sub(s.pos).applyQuaternion(inv);
    const quat = inv.multiply(this.cam.quat);
    this.poseBlend = { frame: this.cam.frame, pos, quat, t: 0, dur, seat, target, fromFoot: this.mode === 'foot' };
  }

  applyPoseBlend(dt) {
    const b = this.poseBlend;
    if (!b) return;
    const ship = this.ship;
    const tg = b.target;
    b.t += dt / b.dur;
    if (b.t >= 1 || tg.frame !== b.frame || ship.state.frame !== b.frame) {
      this.poseBlend = null;
      this.cam.frame = tg.frame;
      this.cam.pos.copy(tg.pos);
      this.cam.quat.copy(tg.quat);
      ship.setCockpitVisual(ship.inCockpit && this.mode === 'ship');
      for (const m of ship.canopyParts || []) m.visible = true;
      return;
    }
    const k = b.t * b.t * (3 - 2 * b.t);
    const s = ship.state;
    const from = _v4.copy(b.pos).applyQuaternion(s.quat).add(s.pos);
    const to = tg.pos;
    const up = b.frame.sampler ? _v2.copy(to).normalize() : _v2.set(0, 1, 0);
    let c1;
    let c2;
    if (b.seat) {
      const into = this.mode === 'ship' && ship.inCockpit;
      const seat = _v3.copy(SEAT_ABOVE).applyQuaternion(s.quat).add(s.pos);
      const far = b.fromFoot || this.mode === 'foot'
        ? _v5.copy(into ? from : to).addScaledVector(up, 3)
        : _v5.copy(HULL_ABOVE).applyQuaternion(s.quat).add(s.pos);
      c1 = into ? far : seat;
      c2 = into ? seat : far;
    } else {
      // round the ship's side, bowing out (away from the side the walker stands on) at about the
      // height of the ends: craning up and over the hull read as a whip, and a straight line, or a
      // bow towards the tail, skimmed the wing
      const away = _v6.copy(b.fromFoot ? from : to).sub(s.pos);
      away.addScaledVector(up, -away.dot(up));
      if (away.lengthSq() < 1) away.set(1, 0, 0).applyQuaternion(s.quat);
      away.normalize();
      const bow = Math.max(3, from.distanceTo(to) * 0.3);
      c1 = _v5.copy(from).addScaledVector(away, bow).addScaledVector(up, 1);
      c2 = _v3.copy(to).addScaledVector(away, bow).addScaledVector(up, 1);
    }
    const u = 1 - k;
    const p = _v1.copy(from).multiplyScalar(u * u * u).addScaledVector(c1, 3 * u * u * k).addScaledVector(c2, 3 * u * k * k).addScaledVector(to, k * k * k);
    if (b.seat) {
      const l = _v4.copy(p).sub(s.pos).applyQuaternion(_q1.copy(s.quat).invert());
      // passing through the canopy: the glass and its frame go (seen from a hand's width away they
      // were an opaque slab filling the view) and the cockpit shows below
      const over = Math.abs(l.x) < 1.6 && l.z < 2.2 && l.z > -4.0;
      const inside = over && l.y < 1.95;
      const near = over && !inside && l.y < 5.8;
      ship.setCockpitVisual(inside || near);
      for (const m of ship.canopyParts || []) m.visible = !near;
      // and the plasma sheath round the hull dims while the camera is inside it
      const close = 1 - THREE.MathUtils.smoothstep(l.length(), 5, 16);
      if (ship.reentryMat) ship.reentryMat.uniforms.uPower.value *= 1 - 0.85 * close;
    }
    this.cam.frame = b.frame;
    this.cam.pos.copy(p);
    this.cam.quat.slerpQuaternions(_q1.copy(s.quat).multiply(b.quat), tg.quat, k);
    if (!b.seat) {
      // keep the ship in frame on the way: turn towards it through the middle of the move
      const at = _v4.copy(s.pos).addScaledVector(up, 1.5);
      _m4.lookAt(p, at, up);
      _q2.setFromRotationMatrix(_m4);
      this.cam.quat.slerp(_q2, Math.sin(Math.PI * k) * 0.5);
    }
    // look down at the canopy while passing over it
    if (b.seat) this.cam.quat.multiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0), -Math.sin(Math.PI * k) * 0.18));
  }

  // Cut to the new viewpoint behind a short fade from black.
  startDip(dur = 0.35) {
    this.camBlend = null;
    this.poseBlend = null;
    this.dip = { t: 0, dur };
    this.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, 1);
  }

  updateDip(dt) {
    const d = this.dip;
    if (!d) return;
    d.t += dt / d.dur;
    const a = Math.max(0, 1 - d.t);
    this.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, a * a);
    if (d.t >= 1) this.dip = null;
  }

  applyCamBlend(dt) {
    this.updateDip(dt);
    const b = this.camBlend;
    if (!b) return;
    const s = this.ship.state;
    b.t += dt / b.dur;
    if (b.t >= 1 || this.cam.frame !== b.frame || s.frame !== b.frame) {
      this.camBlend = null;
      return;
    }
    const k = b.t * b.t * (3 - 2 * b.t);
    const from = _v1.copy(b.pos).applyQuaternion(s.quat).add(s.pos);
    const fromQ = s.quat.clone().multiply(b.quat);
    this.cam.pos.lerpVectors(from, this.cam.pos, k);
    this.cam.quat.slerpQuaternions(fromQ, this.cam.quat, k);
  }

  exitShip() {
    const ship = this.ship;
    // from the ship view down to the pilot's eyes beside it
    this.startPoseBlend(4.0, ship.inCockpit);
    const f = ship.state.frame;
    const left = _v1.set(-1, 0, 0).applyQuaternion(ship.state.quat).clone();
    const fwd = _v2.set(0, 0, -1).applyQuaternion(ship.state.quat).clone();
    let feet;
    if (f && f.kind === 'station') {
      feet = ship.state.pos.clone().addScaledVector(left, 8);
      feet.y = 2;
    } else if (f && f.sampler) {
      // clear of the wing tip, which sits right at eye height
      const dir = ship.state.pos.clone().addScaledVector(left, 11).addScaledVector(fwd, 3).normalize();
      feet = dir.clone().multiplyScalar(f.surfaceRadius(dir) + 0.3);
    } else return;
    // on a planet, turned towards the ship's nose: the glide down ends with the ship in view
    // (facing along it, the first sight on foot was empty hillside)
    const face = f.sampler ? ship.state.pos.clone().addScaledVector(fwd, 3).sub(feet) : fwd;
    this.player.spawn(f, feet, face);
    ship.setCockpit(false);
    this.player.lifeSupport = Math.max(this.player.lifeSupport, 30);
    this.mode = 'foot';
    this.audio.play('ui');
  }

  boardShip() {
    this.startPoseBlend(4.2, this.camView === 2);
    const glide = !!this.poseBlend;
    this.mode = 'ship';
    this.ship.setCockpit(this.camView === 2);
    const out = glide ? this.poseBlend.target : this.cam;
    out.frame = undefined;
    // snap now: the rest of this frame (streaming, culling) already reads the ship camera
    this.ship.updateCamera(0, { enabled: false }, out);
    if (glide) this.ship.setCockpitVisual(false);
    this.audio.play('ui');
    this.player.lifeSupport = 100;
    this.player.hazard = 100;
  }

  save(announce = false) {
    this.saveTimer = 0;
    if (saveGame(this) && announce) this.hud.toast('Progress saved', 'good');
  }

  onDocked() {
    this.objectives.flags.docked = true;
    this.save(true);
    this.audio.play('dock');
    this.hud.showBanner(this.station.name.toUpperCase(), 'Docked');
    if (this.ship.shield < 100) {
      this.ship.shield = 100;
      this.hud.toast('Shields recharged', 'good');
    }
  }

  scan() {
    if (this.scanCooldown > this.time) return;
    this.scanCooldown = this.time + 3;
    this.hud.scanPulse();
    this.audio.play('scan');
    const found = this.flora.scan(this.player.state, 180);
    this.scanMarkers = found.map((f) => ({ ...f, expires: this.time + 25 }));
    this.hud.toast(found.length ? `${found.length} deposits nearby` : 'Nothing nearby');
    const { nearest } = this.structures.scanReveal(this.player.state.pos, 3000);
    if (nearest) {
      const km = nearest.d < 1000 ? `${nearest.d.toFixed(0)} m` : `${(nearest.d / 1000).toFixed(1)} km`;
      setTimeout(() => this.hud.toast(`${nearest.s.label} · ${km}`, 'good'), 900);
    }
  }

  onShipFire(ship) {
    this.asteroids.shipFired(ship);
    this.pirates.shipFired(ship);
  }

  updateSurvival(dt) {
    const p = this.player;
    const f = p.state.frame;
    if (!f || f.kind === 'station') {
      p.lifeSupport = Math.min(100, p.lifeSupport + dt * 5);
      p.hazard = Math.min(100, p.hazard + dt * 10);
      return;
    }
    p.lifeSupport = Math.max(0, p.lifeSupport - dt * 0.35);
    const type = f.params.type;
    // (worlds hostile to ships are far worse on foot: protection lasts seconds, not minutes)
    const FOOT = { heat: 9, pressure: 6, acid: 3, radiation: 3.5, storm: 1.5, cryo: 2.5 };
    const hz = f.params.hazard;
    const mist = f.params.mist;
    // (a mild world's lowlands are breathable: only above its mist line does the air eat at the suit)
    const harsh = mist
      ? mistHazard(mist, p.state.pos.length() - f.radius).foot
      : Math.max({ frozen: 1, desert: 1, toxic: 1.2, volcanic: 1.5, barren: 0.6, dead: 0.8 }[type] || 0, hz ? FOOT[hz.kind] * (hz.dps / 5) : 0);
    const night = this.isDark ? 1.4 : 1;
    if (harsh) p.hazard = Math.max(0, p.hazard - dt * harsh * night * 0.6);
    else p.hazard = Math.min(100, p.hazard + dt * 2);
    for (const [key, label] of [['hazard', 'Hazard protection low'], ['lifeSupport', 'Life support low']]) {
      const low = p[key] < 30;
      if (low && !p[`_warned_${key}`]) {
        p[`_warned_${key}`] = true;
        this.hud.toast(`${label} low — mine ${key === 'hazard' ? 'sodium' : 'oxygen'}`, 'warn');
        this.audio.play('error');
      }
      if (p[key] > 45) p[`_warned_${key}`] = false;
    }
    if (p.lifeSupport <= 0 || p.hazard <= 0) {
      p.health = Math.max(0, p.health - dt * 4);
      if (!this._warnT || this.time - this._warnT > 6) {
        this._warnT = this.time;
        this.hud.toast(p.lifeSupport <= 0 ? 'Life support depleted!' : 'Hazard protection failing!', 'warn');
      }
    } else p.health = Math.min(100, p.health + dt * 1.5);
    if (p.health <= 0) this.playerDied();
    if (p.lifeSupport < 25 && this.inventory.take('oxygen', 10)) {
      p.lifeSupport = Math.min(100, p.lifeSupport + 40);
      this.hud.toast('Life support recharged', 'good');
    }
    if (p.hazard < 25 && this.inventory.take('sodium', 10)) {
      p.hazard = Math.min(100, p.hazard + 40);
      this.hud.toast('Hazard protection recharged', 'good');
    }
  }

  playerDied() {
    this.hud.showBanner('SUIT FAILURE', 'Emergency recall to ship', []);
    this.hud.flash('damage');
    const p = this.player;
    p.health = 60;
    p.lifeSupport = 60;
    p.hazard = 60;
    this.boardShip();
  }

  checkDiscoveries() {
    const f = this.focusFrame;
    if (!f || f.kind === 'station' || !f.params) return;
    const near = this.mode === 'ship' ? this.ship.seaAltitude < f.radius * 0.35 : true;
    if (near && !this.discovered.has(f)) {
      this.discovered.add(f);
      if (this.discoveredNames.has(f.name)) return;
      this.discoveredNames.add(f.name);
      const p = f.params;
      const lines = [`Weather: ${p.weather}`, `Gravity: ${(f.gravity / 9.8).toFixed(2)} g`];
      if (p.hazard) lines.push(`Warning: ${p.hazard.label.toLowerCase()} below ${Math.round(p.hazard.ceiling / 1000)} km`);
      else if (p.mist) lines.push(`Breathable below ${Math.round(p.mist.line / 10) * 10} m · caustic air above`);
      else if (f.isGas) lines.push('Warning: not landable');
      this.hud.showBanner(f.name.toUpperCase(), `${p.label}${f.kind === 'moon' ? ' Moon' : ' Planet'}`, lines);
      this.audio.play('discovery');
      const reward = 250 + Math.floor(Math.random() * 400);
      this.inventory.units += reward;
    }
  }

  // ---------- markers ----------
  getMarkers() {
    const out = [];
    if (this.mode === 'title') return out;
    const cam = this.camWorld;
    const add = (kind, label, world, extra = {}) => {
      const rel = new THREE.Vector3().copy(world).sub(cam);
      out.push({ kind, label, rel, dist: rel.length(), ...extra });
    };
    const focus = this.focusFrame;
    if (focus && focus.sampler && this.structures.planet === focus) {
      const camLocal = focus.worldToLocal(cam, new THREE.Vector3());
      for (const m of this.structures.markers(camLocal)) add('poi', m.label, focus.localToWorld(m.pos, new THREE.Vector3()));
    }
    if (this.mode === 'ship') {
      this.addSystemMarkers(add);
    }
    if (this.mode === 'ship' && this.cities.planet && !this.universe.dormant) {
      const P = this.cities.planet;
      for (const m of this.cities.markers(P.worldToLocal(cam, new THREE.Vector3()))) add('city', m.label, P.localToWorld(m.pos, new THREE.Vector3()));
    }
    if (this.mode === 'ship' && !this.universe.dormant) {
      for (const p of this.system.planets) {
        if (p === focus && this.ship.seaAltitude < p.radius * 0.6) continue;
        if (p.kind === 'moon' && p.distanceTo(cam) > p.parent.soi * 2 && p.parent !== focus) continue;
        add('planet', p.name, p.position, { target: this.navTarget === p });
      }
      if (focus !== this.station || !this.station.inHangar(this.ship.state.pos)) {
        add('station', this.station.name, this.station.position, { target: this.navTarget === this.station });
      }
    }
    if (this.mode === 'ship') {
      // other ships show only within the ship's detection distance for each (DESIGN 10.1): its sensors' range × their signature
      const here = this.ship.state.worldPosition(new THREE.Vector3());
      const range = sensorRange('ship', this.ship.stats.scanRange);
      for (const pm of this.pirates.markers()) if (detects(range, pm.signature, pm.world.distanceTo(here))) add('enemy', pm.label, pm.world);
    } else if (this.mode === 'foot') {
      add('ship', 'Starship', this.ship.state.worldPosition(new THREE.Vector3()));
      // the nearest few scanned deposits only: all of them sprayed labels across the view
      const found = [];
      for (const m of this.scanMarkers) {
        if (m.expires < this.time || m.frame !== this.player.state.frame) continue;
        const w = m.frame.localToWorld(m.pos, new THREE.Vector3());
        const d = w.distanceTo(cam);
        if (d < 300) found.push({ m, w, d });
      }
      found.sort((a, b) => a.d - b.d);
      for (const { m, w } of found.slice(0, 5)) add('resource', m.label, w);
      const f = this.player.state.frame;
      if (f && f.kind === 'station') {
        for (const t of f.terminals) add('station', t.label, f.localToWorld(_v3.copy(t.pos).add(new THREE.Vector3(0, 2, 0)), new THREE.Vector3()));
      }
    }
    return out;
  }

  // other star systems: the one you set course for, and out between the stars the nearest few
  addSystemMarkers(add) {
    const here = this.universe.toLy(this.camWorld, _v4);
    const gal = this.galaxy;
    const list = [];
    for (const s of gal.systems) {
      if (s === gal.current && !this.universe.deep) continue;
      const target = this.navTarget === s;
      if (target || this.universe.deep) list.push({ s, d: gal.distance(s, here), target });
    }
    list.sort((a, b) => b.target - a.target || a.d - b.d);
    for (const { s, d, target } of list.slice(0, 4)) {
      const dir = new THREE.Vector3(s.x - here.x, s.y - here.y, s.z - here.z).normalize().multiplyScalar(1e12);
      add('system', s.name, dir.add(this.camWorld), { target, dist: d * LY });
    }
  }

  // ---------- rendering ----------
  renderFrame(dt) {
    const cam = this.engine.camera;
    cam.position.set(0, 0, 0);
    cam.quaternion.copy(this.camWorldQuat);
    let targetFov = 70;
    if (this.mode === 'ship') {
      targetFov = this.ship.inCockpit ? 72 : 64;
      // widen with speed so pace reads even without a reference close by
      targetFov += Math.min(1, Math.abs(this.ship.speed) / 1400) * 4;
      if (this.ship.mode === 'pulse') targetFov = 80;
      else if (this.ship.boosting) targetFov = Math.max(targetFov, 68);
      // and kick wider while the ship is surging forward (the camera is falling back then too)
      if (!this.ship.inCockpit) targetFov += THREE.MathUtils.clamp((this.ship.camLag || 0) * 0.9, -2, 5);
      // (short of the pulse drive, kept under ~72 degrees: wider, the small world's horizon bent
      // into a fishbowl on the way down)
      if (this.ship.mode !== 'pulse') targetFov = Math.min(targetFov, this.ship.inCockpit ? 76 : 72);
    }
    this.fov = THREE.MathUtils.damp(this.fov, targetFov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    const sp = this.ship.mode === 'pulse' ? Math.min(1, this.ship.pulse.speed / 30000) : this.ship.boosting ? Math.min(0.5, Math.abs(this.ship.speed) / 1200) : 0;
    this.speedEffect = THREE.MathUtils.damp(this.speedEffect, this.mode === 'ship' ? sp : 0, 4, dt);
    // streaks of dust or vapour racing past the ship
    const ship = this.ship;
    let streak = 0;
    if (this.mode === 'ship' && ship.mode === 'flying' && !this.indoor) {
      const v = Math.abs(ship.speed);
      // a space effect: low over the ground white streaks read as cracks in the picture (the
      // terrain rushing past and the re-entry glow carry the speed there)
      streak = THREE.MathUtils.smoothstep(v, 150, 800) * 0.35 * (1 - THREE.MathUtils.smoothstep(ship.atmoDensity, 0.002, 0.04));
      ship.state.worldDir(ship.state.vel, _v5);
    } else _v5.set(0, 0, 0);
    this.speedLines.update(dt, _v5, streak, _c1.setRGB(0.7, 0.75, 0.9));

    const sun = this.system.star;
    sun.syncRoot(this.camWorld);
    sun.updateVisual(this.time);
    const focus = this.mode === 'title' ? null : this.focusFrame;
    const current = focus && focus.sampler ? focus : null;
    if (!this.universe.dormant) {
      // a system flown into wakes its planets one a frame (each one's first update sets up its
      // terrain; all at once they made a hitch), hidden until then: they are still far out of sight
      const sys = this.system;
      const waking = sys.waking;
      sys.planets.forEach((p, i) => {
        const awake = waking === undefined || i < waking;
        if (waking !== undefined) p.root.visible = awake;
        if (awake) p.updateRender(this.camWorld, cam, sun, p === current, this.time);
      });
      if (sys.waking !== undefined && (sys.waking += 1) > sys.planets.length) sys.waking = undefined;
    }
    this.station.syncRoot(this.camWorld);
    const camLocalStation = this.station.worldToLocal(this.camWorld, _v3);
    this.indoor = this.cam.frame === this.station && this.station.inHangar(camLocalStation, -2);
    // flying out, the hangar's light gives way to the sun over the last stretch before the force
    // field, so the ship (ahead of the camera) is already sunlit when it clears the mouth (fading
    // after the camera was out left it dark against the stars for a second)
    const depth = this.indoor ? HANGAR.z1 - camLocalStation.z : 0;
    this.indoorK = THREE.MathUtils.damp(this.indoorK ?? 0, THREE.MathUtils.smoothstep(depth, 2, 45), 6, dt);
    this.station.updateVisual(this.time, this.indoor || camLocalStation.length() < 400);
    this.traffic.update(dt);
    this.pirates.syncVisual();
    this.ship.syncVisual(this.camWorld);
    this.ship.group.visible = true;
    this.flora.update(dt, current);
    this.fauna.update(dt, current);
    this.structures.update(dt, current);
    // (cities' lights show from orbit, and from the station above their world)
    this.cities.update(dt, focus?.sampler ? focus : focus?.kind === 'station' && !this.indoor ? focus.parent : null);
    this.weather.update(dt, current);
    this.asteroids.update(dt);
    this.updateSky();
    this.pool.update();
    this.updateLighting(current);
    this.updateAtmosphereUniforms();
    this.engine.gradePass.uniforms.uTime.value = this.time;
    this.engine.gradePass.uniforms.uWarp.value = this.speedEffect;
    this.updateFlare(cam, sun);
    this.updateHazardFx(dt);
    this.bolts.update(dt);
    // the navigation map takes the screen over: the game's own frame would only be hidden under it
    if (this.overlay === 'map') this.menus.renderMap(dt);
    else {
      this.engine.render(dt);
      this.hud.edgeCompass.render(this.engine.renderer);
    }
    if (this.graveyard?.length) {
      for (const g of this.graveyard) if (--g.frames <= 0) this.disposeSystem(g.system, g.station);
      this.graveyard = this.graveyard.filter((g) => g.frames > 0);
    }
  }

  // the sky from the camera's true galactic position
  updateSky() {
    const eye = this.universe.toLy(this.camWorld, _v4);
    const sun = this.system.star;
    const done = this.sky.update(eye, {
      time: this.time,
      pixelRatio: this.engine.renderer.getPixelRatio(),
      vis: this.engine.atmoPass.uniforms.uStarVis.value,
      visited: this.system.info,
      starRel: this.universe.deep ? null : _v5.copy(sun.position).sub(this.camWorld),
    });
    this.engine.scene.background = this.sky.texture;
    // (the image light follows the sky, but at most every few seconds: it costs a few ms)
    if (done && (!this.spaceEnv || this.time - this.spaceEnvTime > 4 || this.mode === 'title')) this.refreshSpaceEnv();
  }

  // A lightning flash (k 0..1): the sky whites out for an instant, flickering; `near`, the bolt
  // itself comes down close by (it hit the ship).
  lightning(k = 1, near = false) {
    this.bolt = { t: 0, k };
    if (near) this.bolts.strike(this.focusFrame, true);
  }

  // What hostile skies do to the picture: lightning over storm worlds (seen from the ground too),
  // radiation's fringing static, a sickly tint in acid air, frost-blue in cryogenic cold.
  updateHazardFx(dt) {
    const u = this.engine.gradePass.uniforms;
    const ship = this.ship;
    const f = this.focusFrame;
    const hz = f?.params?.hazard;
    // storms flicker with distant lightning wherever you are under them
    if (hz?.kind === 'storm' && this.mode !== 'title' && !this.indoor) {
      const alt = f.worldToLocal(this.camWorld, _v1).length() - f.radius;
      if (alt < hz.ceiling * 1.5) {
        this.nextBolt = (this.nextBolt ?? 4) - dt;
        if (this.nextBolt <= 0) {
          this.nextBolt = 3 + Math.random() * 9;
          // a bolt you can see, a flash, then the thunder (later the further off it fell)
          const d = this.bolts.strike(f) || 3000;
          this.lightning(0.25 + 0.4 * (1 - Math.min(1, d / 7000)));
          setTimeout(() => this.audio.play('thunder', { dist: d }), Math.min(6000, (d / 340) * 1000));
        }
      }
    }
    const level = this.mode === 'ship' ? ship.hazardLevel : 0;
    const kind = ship.hazard?.kind;
    u.uDamage.value = THREE.MathUtils.damp(u.uDamage.value, kind === 'radiation' ? level * 0.8 : 0, 4, dt);
    if (this.dip) return;
    if (this.bolt) {
      const b = this.bolt;
      b.t += dt;
      const a = b.k * Math.exp(-b.t * 7) * (0.6 + 0.4 * Math.sin(b.t * 70));
      u.uFlash.value.set(0.82, 0.88, 1.0, Math.max(0, a) * 0.6);
      if (b.t > 0.7) this.bolt = null;
      return;
    }
    const tint = kind === 'acid' ? [0.55, 0.85, 0.1, 0.1] : kind === 'cryo' ? [0.6, 0.85, 1.0, 0.12] : kind === 'heat' ? [1.0, 0.4, 0.1, 0.08] : null;
    if (tint && level > 0) u.uFlash.value.set(tint[0], tint[1], tint[2], tint[3] * level * (0.8 + 0.2 * Math.sin(this.time * 3)));
    else u.uFlash.value.set(0, 0, 0, 0);
  }

  // The hull gave out: the ship is rebuilt at the station, at a price.
  shipDestroyed(hz) {
    if (this.destroying) return;
    this.destroying = true;
    const cause = {
      heat: 'Burned up in the atmosphere',
      cryo: 'Frozen and shattered',
      pressure: 'Crushed by the pressure',
      acid: 'Hull dissolved by acid',
      radiation: 'Systems fried by radiation',
      storm: 'Torn apart by the storm',
    }[hz?.kind] || 'Hull failure';
    this.audio.play('explode');
    this.hud.flash('damage');
    this.lightning(1);
    const loss = Math.floor(this.inventory.units * 0.2);
    this.inventory.units -= loss;
    this.pirates.clear();
    this.placeShipNearStation();
    this.ship.hull = 100;
    this.ship.shield = 100;
    this.ship.wind.set(0, 0, 0);
    this.hud.showBanner('SHIP DESTROYED', cause, [`Rebuilt at ${this.station.name} · -${loss} units`]);
    this.save();
    this.destroying = false;
  }

  updateFlare(cam, sun) {
    const u = this.engine.gradePass.uniforms;
    u.tDepth.value = this.engine.atmoPass.lastDepth || null;
    // last frame's resolved deck (this frame's is written into the other history buffer)
    u.tCloud.value = this.engine.atmoPass.uniforms.tCloud.value;
    u.uCloudOn.value = this.engine.atmoPass.uniforms.uMarchPlanet.value >= 0 ? 1 : 0;
    const rel = _v1.copy(sun.position).sub(this.camWorld);
    const dist = rel.length();
    const dir = rel.clone().divideScalar(dist);
    // planets in the way (terrain/station handled by the depth test in the shader)
    let vis = this.indoor || (this.mode === 'foot' && this.player.headUnderwater) || this.universe.deep ? 0 : 1;
    // out past the planets the sun is one bright star among the rest
    vis *= Math.min(1, (this.keyK ?? 1) * 3);
    for (const p of this.system.planets) {
      const oc = _v2.copy(p.position).sub(this.camWorld);
      const t = oc.dot(dir);
      if (t <= 0 || t > dist) continue;
      const d2 = oc.lengthSq() - t * t;
      if (d2 < p.radius * p.radius) vis = 0;
    }
    const v = rel.applyQuaternion(this.camWorldQuatInv);
    if (v.z >= 0) vis = 0;
    v.applyMatrix4(cam.projectionMatrix);
    const sx = v.x * 0.5 + 0.5;
    const sy = v.y * 0.5 + 0.5;
    if (sx < -0.1 || sx > 1.1 || sy < -0.1 || sy > 1.1) vis = 0;
    u.uSunUV.value.set(sx, sy);
    // eased in and out: passing cloud edges made the flare flicker on and off
    u.uSunVis.value = THREE.MathUtils.damp(u.uSunVis.value, vis, 3, 1 / 60);
    u.uSunCol.value.copy(this.sunLightColor || sun.lightColor);
    u.uAspect.value = cam.aspect;
  }

  updateLighting(current) {
    const sun = this.system.star;
    const sunDir = _v1;
    // between the stars the light is faint and comes from whichever star is brightest
    const keyK = (this.keyK = this.universe.keyLight(this.camWorld, sunDir));
    const L = this.sunLight;
    L.target.position.set(0, 0, 0);
    L.position.copy(sunDir).multiplyScalar(800);
    const col = new THREE.Color().copy(sun.lightColor);
    let intensity = 3.6 * Math.max(0.1, keyK);
    // in open space there is little fill: sunlit sides and dark shadow sides, not evenly lit rocks
    let hemiI;
    const skyCol = new THREE.Color(0.3, 0.35, 0.45);
    const groundCol = new THREE.Color(0.12, 0.1, 0.09);
    let day = 1;
    let envKey = 'space';
    if (current) {
      const up = _v2.copy(this.camWorld).sub(current.position).normalize();
      this.hemi.position.copy(up);
      const elev = up.dot(sunDir);
      day = THREE.MathUtils.smoothstep(elev, -0.12, 0.12);
      if (current.atmo) {
        const am = 1 / (Math.max(elev, 0) + 0.12);
        const s = current.atmo.scatter;
        const fall = current.atmo.falloff;
        // vertical optical depth of the exp(-h*fall)*(1-h) density profile
        const k = (current.atmo.top - 1) * ((1 - Math.exp(-fall)) / fall - (1 - Math.exp(-fall) * (1 + fall)) / (fall * fall));
        col.r *= Math.exp(-s.x * k * am);
        col.g *= Math.exp(-s.y * k * am);
        col.b *= Math.exp(-s.z * k * am);
        const mx = Math.max(s.x, s.y, s.z);
        // sky fill: strong and only lightly tinted, so shadows read as shade rather than navy
        skyCol.setRGB(s.x / mx, s.y / mx, s.z / mx).lerp(new THREE.Color(1, 1, 1), 0.55);
        // fill kept well under the sun so shadows and shaded sides read (it was nearly as strong)
        hemiI = 0.05 + day * 0.7;
        envKey = `p${current.id}_${Math.round(elev * 20)}`;
      } else {
        hemiI = 0.05 + day * 0.15;
        envKey = `b${current.id}_${Math.round(elev * 10)}`;
      }
      intensity *= day;
      groundCol.copy(skyCol).multiplyScalar(0.22);
      const p = current.params;
      const tint = p.sunTint || [1, 1, 1];
      col.r *= tint[0];
      col.g *= tint[1];
      col.b *= tint[2];
      const baseT = { lush: 22, alien: 28, desert: 54, frozen: -48, toxic: 36, volcanic: 112, barren: -20, dead: -14, irradiated: 31, inferno: 462, storm: 9, corrosive: 47, crushing: 88 }[p.type] ?? 0;
      const temp = baseT + (day - 0.5) * 18;
      const storm = this.weatherIntensity > 0.4 ? ` · ${{ rain: 'Rain', snow: 'Snowstorm', ash: 'Ash Storm', spores: 'Spore Cloud', dust: 'Dust Storm' }[this.weatherKind] || 'Storm'}` : '';
      this.envInfo = `Temp ${temp.toFixed(0)}°C · ${day > 0.5 ? 'Day' : 'Night'}${storm}`;
    } else {
      this.hemi.position.copy(sunDir);
      // the side turned from the sun picks up a cool glow from the nebulae instead of going to
      // black: backlit ships and the station read as shapes rather than silhouettes
      groundCol.setRGB(0.2, 0.23, 0.36);
      skyCol.setRGB(0.34, 0.36, 0.42);
      hemiI = 0.45 + 0.35 * Math.min(1, keyK * 4);
      this.envInfo = '';
    }
    this.isDark = day < 0.3;
    this.daylight = day;
    // moonlight: once the sun sets, a dim bluish key light keeps the night readable
    if (current && day < 0.5 && !this.indoor) {
      const night = 1 - day * 2;
      const up = _v2.copy(this.camWorld).sub(current.position).normalize();
      const moonDir = _v3.copy(sunDir).multiplyScalar(-1).addScaledVector(up, 1.2).normalize();
      L.position.copy(moonDir).multiplyScalar(800);
      col.setRGB(0.55, 0.65, 1.0);
      intensity = Math.max(intensity, night * 0.45);
      hemiI = Math.max(hemiI, 0.1 + night * 0.08);
    }
    const ik = this.indoorK ?? (this.indoor ? 1 : 0);
    if (ik > 0.001) {
      intensity *= 1 - 0.88 * ik;
      hemiI += (0.22 - hemiI) * ik;
      skyCol.lerp(_c1.setRGB(0.9, 0.85, 0.8), ik);
      groundCol.lerp(_c1.setRGB(0.25, 0.25, 0.28), ik);
      // the hangar's image light dims with the rest instead of swapping for the dark sky's in a frame
      if (ik > 0.03) envKey = 'station';
    }
    const envI = envKey === 'station' ? ik : 1;
    this.engine.scene.environmentIntensity = envI;
    this.engine.viewScene.environmentIntensity = envI;
    L.color.copy(col);
    L.intensity = intensity;
    this.hemi.color.copy(skyCol);
    this.hemi.groundColor.copy(groundCol);
    this.hemi.intensity = hemiI;
    const tm = current?.treeMat;
    if (tm) {
      tm.uniforms.uSunCol.value.copy(col).multiplyScalar(intensity);
      tm.uniforms.uAmbCol.value.copy(skyCol).multiplyScalar(hemiI);
      const size = this.engine.renderer.getDrawingBufferSize(_v2b);
      tm.uniforms.uPixelScale.value = this.engine.camera.projectionMatrix.elements[5] * size.y * 0.5;
    }
    this.vmSun.color.copy(col);
    this.vmSun.intensity = intensity * 0.8;
    this.vmSun.position.copy(sunDir).applyQuaternion(this.camWorldQuatInv);
    this.vmHemi.color.copy(skyCol);
    this.vmHemi.groundColor.copy(groundCol);
    this.vmHemi.intensity = hemiI;
    this.vmHemi.position.set(0, 1, 0).applyQuaternion(this.camWorldQuatInv);
    this.updateEnvironment(envKey, skyCol, groundCol, sunDir, col, day);
  }

  updateEnvironment(key, sky, ground, sunDir, sunCol, day) {
    if (key === this.envKey) return;
    this.envKey = key;
    if (key === 'space') {
      this.engine.scene.environment = this.spaceEnv;
      this.engine.viewScene.environment = this.engine.scene.environment;
      return;
    }
    const u = this.envMat.uniforms;
    // the image-based light skips the shadow map, so the sun is only a faint part of it
    u.uSky.value.copy(sky).multiplyScalar(0.18 + day * 0.6);
    u.uGround.value.copy(ground).multiplyScalar(0.3 + day * 0.7);
    u.uSun.value.copy(sunDir);
    u.uSunCol.value.copy(sunCol).multiplyScalar(day * 0.35);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.engine.scene.environment = this.envRT.texture;
    this.engine.viewScene.environment = this.engine.scene.environment;
  }

  updateAtmosphereUniforms() {
    const u = this.engine.atmoPass.uniforms;
    const list = [];
    for (const p of this.system.planets) {
      if (!p.atmo && !p.ocean && !p.clouds) continue;
      const d = p.distanceTo(this.camWorld);
      const top = p.radius * (p.atmo ? p.atmo.top : 1.02);
      if (top / d < 0.0015) continue;
      list.push({ p, d });
    }
    list.sort((a, b) => a.d - b.d);
    list.length = Math.min(list.length, MAX_PLANETS);
    list.reverse();
    const sun = this.system.star;
    u.uSunPos.value.copy(sun.position).sub(this.camWorld);
    const sc = sun.lightColor;
    u.uSunLight.value.set(sc.r, sc.g, sc.b).multiplyScalar(3.2);
    u.uTime.value = this.time;
    u.uCount.value = list.length;
    // stars fade out under a daylit sky (they would otherwise show through thin cloud)
    let starVis = 1;
    const near = list.length ? list[list.length - 1].p : null;
    if (near && near.atmo) {
      const alt = list[list.length - 1].d - near.radius;
      const H = (near.atmo.top - 1) * near.radius;
      const elev = _v1.copy(this.camWorld).sub(near.position).normalize().dot(_v2.copy(sun.position).sub(near.position).normalize());
      starVis = 1 - (1 - THREE.MathUtils.smoothstep(alt, H * 0.3, H)) * THREE.MathUtils.smoothstep(elev, -0.08, 0.12);
    }
    u.uStarVis.value = starVis;
    list.forEach(({ p, d }, i) => {
      // under a hostile sky the air itself is lit dimmer and stranger (storm gloom, violet murk); from
      // outside, the sunlit tops wash some of it out, but the haze takes it on so the world looks the part
      const tint = p.atmo && p.params?.skyTint;
      if (tint) {
        const H = (p.atmo.top - 1) * p.radius;
        const out = THREE.MathUtils.smoothstep(d - p.radius, H * 0.5, H * 1.2);
        const k = 1 - out * 0.3;
        u.uAirTint.value[i].set(1 + (tint[0] - 1) * k, 1 + (tint[1] - 1) * k, 1 + (tint[2] - 1) * k, out);
      } else u.uAirTint.value[i].set(1, 1, 1, 0);
      u.uCenter.value[i].copy(p.position).sub(this.camWorld);
      u.uRadius.value[i] = p.radius;
      u.uCamDist.value[i] = d;
      u.uAtmoTop.value[i] = p.atmo ? p.atmo.top : 0;
      if (p.atmo) {
        u.uScatter.value[i].copy(p.atmo.scatter);
        u.uFalloff.value[i] = p.atmo.falloff;
        u.uMie.value[i] = p.atmo.mie;
      }
      u.uOcean.value[i] = p.ocean ? 1 : 0;
      u.uWaterShallow.value[i].copy(p.waterShallow);
      u.uWaterDeep.value[i].copy(p.waterDeep);
      u.uWaterEmissive.value[i] = p.waterEmissive;
      _m4.makeRotationFromQuaternion(p.quaternionInv);
      u.uRot.value[i].setFromMatrix4(_m4);
      u.uClouds.value[i] = p.clouds;
      u.uCloudColor.value[i].copy(p.cloudColor);
      u.uCloudBase.value[i] = p.cloudBase;
      u.uCloudTop.value[i] = p.cloudTop;
      u.uCloudSeed.value[i] = p.cloudSeed;
    });
  }

  updateAudio() {
    const ship = this.ship;
    const inShip = this.mode === 'ship';
    let wind = 0;
    if (inShip) wind = Math.min(1, (ship.atmoDensity * Math.abs(ship.speed)) / 150);
    else if (this.mode === 'foot' && this.player.state.frame?.atmo) wind = 0.25 + 0.15 * Math.sin(this.time * 0.37) + 0.1 * Math.sin(this.time * 1.3) + (this.weatherIntensity || 0) * 0.5;
    // the music's scene: the title, out in space, or down on (or close over) a world
    const f = this.focusFrame;
    const low = this.mode === 'foot' || (f?.sampler && ship.altitude < 8000);
    this.audio.update({
      context: this.mode === 'title' ? 'title' : low && !this.universe.deep ? 'planet' : 'space',
      inShip,
      engine: inShip ? (ship.mode === 'landed' ? 0.05 : ship.enginePower || 0) : 0,
      thrust: inShip ? ship.thrust : 0,
      hover: inShip ? ship.hoverOut || 0 : 0,
      rcs: inShip ? ship.rcsLevel || 0 : 0,
      rcsKick: inShip ? ship.rcsKick || 0 : 0,
      boost: ship.boosting,
      speed: Math.abs(ship.speed),
      atmo: ship.atmoDensity,
      wind,
      weather: this.weatherKind,
      weatherK: this.weatherIntensity || 0,
      indoor: this.indoor,
      pulse: inShip && ship.mode === 'pulse' ? ship.pulse.spool : 0,
      jet: this.mode === 'foot' && this.player.jetting,
      beam: this.mode === 'foot' && this.multitool.firing,
      beamHeat: this.multitool.heat,
      underwater: this.mode === 'foot' && this.player.headUnderwater,
    });
    ship.rcsKick = 0;
  }

  updateDebugText() {
    const now = performance.now();
    this._fpsN = (this._fpsN || 0) + 1;
    if (!this._fpsT) this._fpsT = now;
    if (now - this._fpsT > 500) {
      this.fps = (this._fpsN * 1000) / (now - this._fpsT);
      this._fpsN = 0;
      this._fpsT = now;
      if (this.debugEl.style.display !== 'none') {
        const info = this.engine.renderer.info;
        const f = this.focusFrame;
        this.debugEl.textContent = [
          `fps ${this.fps.toFixed(0)}  calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
          `frame ${f ? f.name : 'system'}  chunks ${f?.terrain?.visibleCount ?? '-'}  jobs ${this.pool.pending()}`,
          `ship ${this.ship.mode} alt ${isFinite(this.ship.altitude) ? this.ship.altitude.toFixed(0) : '-'}  spd ${this.ship.speed.toFixed(0)}`,
        ].join('\n');
      }
    }
    if (this.input.pressed.has('Backquote')) this.debugEl.style.display = this.debugEl.style.display === 'none' ? '' : 'none';
  }

  // ---------- warp ----------
  warpTo(sys) {
    if (this.warping || !sys || sys === this.galaxy.current) return false;
    if (this.inventory.warpCells <= 0) {
      this.hud.toast('No warp cells', 'warn');
      this.audio.play('error');
      return false;
    }
    this.inventory.warpCells--;
    this.warping = true;
    this.menus.selectedSystem = null;
    this.menus.closeAll();
    this.mode = 'ship';
    this.audio.play('warp');
    this.menus.showWarp(() => {
      this.warping = false;
      this.galaxy.setCurrent(sys);
      this.discovered.clear();
      this.navTarget = null;
      this.loadSystem(sys);
      this.placeShipNearStation();
      // arrive high above the station looking down past it at the planet
      this.ship.state.pos.set(0, 6000, 14000);
      _m4.lookAt(this.ship.state.pos, new THREE.Vector3(0, -9000, 0), new THREE.Vector3(0, 1, 0));
      this.ship.state.quat.setFromRotationMatrix(_m4);
      this.ship.speed = 300;
      this.audio.play('warpArrive');
      this.hud.flash('warp');
      this.save();
      setTimeout(() => {
        this.hud.showBanner(this.system.name.toUpperCase(), 'Star System');
        this.audio.play('discovery');
      }, 800);
    });
    return true;
  }

  // Dev: straight to a planet in any system, hovering just above it in the ship, or standing on
  // the ground beside the ship landed there. `built` is the system, if the caller already built it.
  teleport(sys, index, where = 'above', built = null) {
    this.poseBlend = null;
    this.camBlend = null;
    this.menus.selectedSystem = null;
    if (this.mode === 'foot') {
      this.mode = 'ship';
      this.player.lifeSupport = 100;
    }
    if (this.ship.mode === 'docking' || this.ship.mode === 'pulse') this.ship.mode = 'flying';
    if (sys !== this.system.info) {
      this.galaxy.setCurrent(sys);
      this.discovered.clear();
      this.navTarget = null;
      this.loadSystem(sys, { built });
    } else if (this.universe.deep) {
      this.universe.reset(sys);
      this.system.star.position.set(0, 0, 0);
    }
    this.system.update(this.time);
    this.station.update(this.time);
    const planet = this.system.planets[index];
    if (!planet) return;
    if (where === 'city' && planet.cities?.length) return this.teleportCity(planet);
    const ground = where === 'ground' && planet.landable;
    // a few hundred metres up over dry land in the morning sun (gas giants: above the cloud tops)
    this.debugGoto(planet, { sunAngle: 38, alt: ground ? 0 : planet.isGas ? 25000 : 600, azimuth: 30, land: !planet.isGas });
    this.ship.speed = 0;
    if (ground) {
      // (out at once: no glide down from the seat, no fade)
      this.exitShip();
      this.poseBlend = null;
      this.dip = null;
      this.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, 0);
    }
    this.sky.reset();
    this.cam.frame = undefined;
    this.save();
  }

  // into a city's plaza: the ship set down beside the landmark, you on foot next to it
  teleportCity(planet) {
    const c = planet.cities[0];
    const s = this.ship.state;
    const plaza = streetPlan(c).plaza;
    const frame = cityFrame(c);
    s.frame = planet;
    cityPoint(c, frame, planet.radius, -plaza * 0.55, 0, GEAR_HEIGHT, s.pos);
    const up = s.pos.clone().normalize();
    const fwd = cityPoint(c, frame, planet.radius, 0, 0, GEAR_HEIGHT, new THREE.Vector3()).sub(s.pos).normalize();
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    _m4.makeBasis(new THREE.Vector3().crossVectors(fwd, up), up, fwd.clone().negate());
    s.quat.setFromRotationMatrix(_m4);
    s.vel.set(0, 0, 0);
    this.ship.speed = 0;
    this.ship.mode = 'landed';
    this.cam.frame = undefined;
    this.exitShip();
    this.poseBlend = null;
    this.dip = null;
    this.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, 0);
    this.sky.reset();
    this.save();
  }

  // Debug helper: place camera-ship on a planet at a given sun angle (deg from zenith)
  debugGoto(planet = this.system.homePlanet, { sunAngle = 40, alt = 300, azimuth = 0, land = true } = {}) {
    const sunDir = new THREE.Vector3().copy(this.system.star.position).sub(planet.position).normalize();
    const local = sunDir.applyQuaternion(planet.quaternionInv);
    const axis = new THREE.Vector3(0, 1, 0).cross(local).normalize();
    let up = local.clone().applyAxisAngle(axis, THREE.MathUtils.degToRad(sunAngle));
    up.applyAxisAngle(local, THREE.MathUtils.degToRad(azimuth));
    if (land && planet.sampler) {
      // walk around the sun-angle ring until we find dry, not-too-high ground
      for (let k = 0; k < 72; k++) {
        const h = planet.heightAt(up);
        if (h > 15 && h < planet.params.mountainHeight * 0.3) break;
        up.applyAxisAngle(local, THREE.MathUtils.degToRad(5));
      }
    }
    const s = this.ship.state;
    s.frame = planet;
    s.pos.copy(up).multiplyScalar(planet.groundRadius(up) + alt + GEAR_HEIGHT);
    const toSun = local.clone().sub(up.clone().multiplyScalar(up.dot(local))).normalize();
    const right = new THREE.Vector3().crossVectors(toSun, up).normalize();
    _m4.makeBasis(right, up, toSun.clone().negate());
    s.quat.setFromRotationMatrix(_m4);
    s.vel.set(0, 0, 0);
    this.ship.speed = 0;
    this.ship.mode = alt < 1 ? 'landed' : 'flying';
    this.cam.frame = undefined;
  }
}

export { GEAR_HEIGHT, HANGAR };
