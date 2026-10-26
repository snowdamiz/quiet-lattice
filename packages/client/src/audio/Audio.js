// WebAudio: recorded effects, ambiences and music where there are recordings (see Samples.js and
// public/audio), and synthesized voices for the rest: the creatures' calls, made for each species,
// and any sound left without a recording; the generative score plays if there is no music.
import { SampleBank, MusicPlayer } from './Samples.js';

function makeNoiseBuffer(ctx, seconds = 2, brown = false) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

function makeImpulse(ctx, seconds = 3.5, decay = 2.5) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const SCALES = [
  [0, 2, 3, 7, 9], // minor-ish pentatonic
  [0, 2, 4, 7, 9],
  [0, 3, 5, 7, 10],
  [0, 2, 5, 7, 9],
];

export class Audio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.musicOn = true;
  }

  start() {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.started = true;
    this.master = ctx.createGain();
    this.master.gain.value = this.settings?.volume ?? 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.noise = makeNoiseBuffer(ctx, 3);
    this.brown = makeNoiseBuffer(ctx, 4, true);

    this.loops = {};
    // ship engine
    {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 300;
      f.Q.value = 3;
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 48;
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.value = 48.7;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = 32;
      const subG = ctx.createGain();
      subG.gain.value = 0.6;
      o1.connect(f);
      o2.connect(f);
      sub.connect(subG).connect(g);
      f.connect(g);
      const n = this.noiseSource(this.brown);
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 500;
      nf.Q.value = 0.7;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      n.connect(nf).connect(ng).connect(this.sfx);
      g.connect(this.sfx);
      o1.start();
      o2.start();
      sub.start();
      this.loops.engine = { g, f, o1, o2, sub, ng, nf };
    }
    // wind
    {
      const n = this.noiseSource(this.noise);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 600;
      f.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.value = 0;
      n.connect(f).connect(g).connect(this.sfx);
      this.loops.wind = { g, f };
    }
    // pulse drive
    {
      const n = this.noiseSource(this.noise);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 2000;
      const g = ctx.createGain();
      g.gain.value = 0;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 90;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      o.connect(og).connect(g);
      n.connect(f).connect(g).connect(this.sfx);
      g.connect(this.reverb);
      o.start();
      this.loops.pulse = { g, f, o };
    }
    // jetpack
    {
      const n = this.noiseSource(this.noise);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.value = 0;
      n.connect(f).connect(g).connect(this.sfx);
      this.loops.jet = { g, f };
    }
    // mining beam
    {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 180;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 30;
      lfo.connect(lfoG).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1400;
      f.Q.value = 2;
      const g = ctx.createGain();
      g.gain.value = 0;
      const n = this.noiseSource(this.noise);
      const nf = ctx.createBiquadFilter();
      nf.type = 'highpass';
      nf.frequency.value = 3000;
      const ng = ctx.createGain();
      ng.gain.value = 0.25;
      n.connect(nf).connect(ng).connect(g);
      o.connect(f).connect(g).connect(this.sfx);
      o.start();
      lfo.start();
      this.loops.beam = { g, o };
    }

    // music bus
    this.music = ctx.createGain();
    this.music.gain.value = this.settings?.music ?? 0.32;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2400;
    this.music.connect(this.musicFilter);
    this.musicFilter.connect(this.master);
    this.musicFilter.connect(this.reverb);
    this.root = 45 + Math.floor(Math.random() * 7);
    this.scale = SCALES[Math.floor(Math.random() * SCALES.length)];
    this.nextChord = ctx.currentTime + 1.5;
    this.nextPluck = ctx.currentTime + 4;

    // recordings: effects through the sfx bus, music through its own (no reverb wash on tracks)
    this.bank = new SampleBank(ctx, this.sfx, this.reverb);
    this.tracks = ctx.createGain();
    this.tracks.connect(this.music);
    this.player = new MusicPlayer(ctx, this.tracks);
    this.bank.load('/audio/manifest.json').then(() => {
      if (!this.bank.manifest) return;
      this.player.setTracks(this.bank.manifest, '/audio/');
      if (this.player.available) this.musicFilter.disconnect(this.reverb);
    });
  }

  noiseSource(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start(0, Math.random() * buffer.duration);
    return s;
  }

  setMood(seed) {
    if (!this.ctx) return;
    this.root = 43 + (seed % 9);
    this.scale = SCALES[seed % SCALES.length];
  }

  midi(n) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  // continuous parameters each frame
  update(state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const L = this.loops;
    const set = (param, v, tc = 0.12) => param.setTargetAtTime(v, t, tc);
    // the recorded beds; a synthesized loop stays only where a recording is missing
    const rec = this.updateRecorded(state);
    // engine
    const eng = state.engine || 0;
    set(L.engine.g.gain, state.inShip && !rec.engine ? 0.05 + eng * 0.12 : 0, 0.2);
    set(L.engine.f.frequency, 180 + eng * 900 + (state.boost ? 600 : 0));
    const pitch = 42 + eng * 22 + (state.boost ? 12 : 0);
    set(L.engine.o1.frequency, pitch);
    set(L.engine.o2.frequency, pitch * 1.013);
    set(L.engine.ng.gain, state.inShip && !rec.airflow ? Math.min(0.5, (state.speed || 0) / 900) * (0.2 + (state.atmo || 0) * 0.8) : 0, 0.2);
    set(L.engine.nf.frequency, 300 + Math.min(2000, (state.speed || 0) * 2));
    // wind
    const wind = state.wind || 0;
    set(L.wind.g.gain, rec.wind ? 0 : wind * 0.35, 0.4);
    set(L.wind.f.frequency, 350 + wind * 900 + Math.sin(t * 0.3) * 120, 0.5);
    // pulse
    set(L.pulse.g.gain, state.pulse && !rec.pulse ? 0.22 : 0, 0.3);
    set(L.pulse.f.frequency, state.pulse ? 1200 + state.pulse * 3000 : 4000, 0.5);
    set(L.pulse.o.frequency, 70 + (state.pulse || 0) * 60, 0.5);
    // jetpack
    set(L.jet.g.gain, state.jet && !rec.jet ? 0.22 : 0, 0.06);
    // beam
    set(L.beam.g.gain, state.beam && !rec.beam ? 0.12 : 0, 0.04);
    set(L.beam.o.frequency, 160 + (state.beamHeat || 0) * 120, 0.1);
    // underwater muffling of music
    set(this.musicFilter.frequency, state.underwater ? 500 : this.player.available ? 18000 : 2400, 0.3);
    if (!this.musicOn) return;
    if (this.player.available) this.player.update(state.context || 'space');
    else if (state.context !== 'title') this.updateMusic(t, state);
  }

  // the recorded loops, from the game's state; returns which ones are playing (the synth stands
  // in for the rest)
  updateRecorded(st) {
    const b = this.bank;
    const on = {};
    if (!b?.ready) return on;
    const ship = st.inShip;
    const eng = st.engine || 0;
    const boost = st.boost ? 1 : 0;
    // the drive's steady hum, rising with power; its roar under thrust and boost
    on.engine = b.setLoop('engine_loop', ship ? 0.35 + eng * 0.45 : 0, 0.82 + Math.min(eng, 1.2) * 0.3, 0.25);
    b.setLoop('thrust_loop', ship ? Math.max(0, Math.min(1, (st.thrust || 0) * 0.7 + boost * 0.6)) * (st.pulse ? 0 : 1) : 0, 0.9 + boost * 0.15, 0.2);
    // air tearing past, by speed and thickness
    const rush = ship ? Math.min(1, ((st.atmo || 0) * (st.speed || 0)) / 260) : 0;
    on.airflow = b.setLoop('airflow_loop', rush, 0.8 + rush * 0.45, 0.3);
    // the VTOL jets
    b.setLoop('hover_loop', ship ? Math.min(1, (st.hover || 0) * 1.6) : 0, 0.9 + (st.hover || 0) * 0.25, 0.15);
    on.pulse = b.setLoop('pulse_loop', st.pulse ? 0.3 + st.pulse * 0.7 : 0, 0.85 + (st.pulse || 0) * 0.25, 0.4);
    on.jet = b.setLoop('jetpack_loop', st.jet ? 1 : 0, 1, 0.06);
    on.beam = b.setLoop('beam_loop', st.beam ? 1 : 0, 0.95 + (st.beamHeat || 0) * 0.15, 0.04);
    // the weather and the place
    const storm = st.weather === 'storm' ? st.weatherK || 0 : 0;
    const rain = st.weather === 'rain' || st.weather === 'storm' ? st.weatherK || 0 : 0;
    on.wind = b.setLoop('wind_loop', ship ? 0 : Math.min(1, (st.wind || 0) * 1.4), 1, 0.6);
    b.setLoop('gale_loop', storm * (ship ? 0.6 : 1), 1, 0.8);
    b.setLoop('rain_loop', rain * (ship ? 0.5 : 1), 1, 0.8);
    b.setLoop('station_loop', st.indoor ? 1 : 0, 1, 0.8);
    b.setLoop('space_loop', st.context === 'space' && !st.indoor ? 0.7 : 0, 1, 1.5);
    return on;
  }

  updateMusic(t, state) {
    if (t >= this.nextChord) {
      const deg = [0, 3, 4, 2, 1][Math.floor(Math.random() * 5)];
      const notes = [0, 2, 4].map((k) => {
        const i = deg + k;
        return this.root + this.scale[i % this.scale.length] + 12 * Math.floor(i / this.scale.length);
      });
      notes.push(this.root - 12 + this.scale[deg % this.scale.length]);
      const dur = 9 + Math.random() * 5;
      for (const n of notes) this.pad(this.midi(n), t, dur);
      this.nextChord = t + dur * 0.75;
    }
    if (t >= this.nextPluck) {
      const count = 3 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        const n = this.root + 12 + this.scale[Math.floor(Math.random() * this.scale.length)] + (Math.random() < 0.3 ? 12 : 0);
        this.pluck(this.midi(n), t + i * (0.22 + Math.random() * 0.2), 0.05);
      }
      this.nextPluck = t + 5 + Math.random() * 9;
    }
  }

  pad(freq, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.linearRampToValueAtTime(1400, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(500, t + dur);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    f.connect(g).connect(this.music);
  }

  pluck(freq, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 2.3);
  }

  tone({ type = 'sine', f0, f1, dur, vol = 0.2, delay = 0, rev = false, attack = 0.005 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    if (rev) g.connect(this.reverb);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst({ dur, vol = 0.3, type = 'lowpass', f0 = 1000, f1, q = 1, delay = 0, rev = false, brown = false }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = brown ? this.brown : this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    if (rev) g.connect(this.reverb);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  // FM creature call; size scales pitch, kind shapes the contour
  creature({ size = 1, kind = 'quad', seed = 0.5, vol = 0.12, alarm = false }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = (kind === 'flyer' ? 1400 : 380) / Math.sqrt(size) * (0.8 + seed * 0.5);
    const notes = kind === 'flyer' ? 3 + Math.floor(seed * 4) : alarm ? 1 : 1 + Math.floor(seed * 2);
    for (let i = 0; i < notes; i++) {
      const t0 = t + i * (kind === 'flyer' ? 0.11 : 0.32);
      const dur = kind === 'flyer' ? 0.09 : alarm ? 0.35 : 0.45 + seed * 0.4;
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      car.type = 'sine';
      mod.type = 'sine';
      const f = base * (1 + (i % 2) * 0.12);
      car.frequency.setValueAtTime(f, t0);
      car.frequency.exponentialRampToValueAtTime(f * (alarm ? 1.6 : kind === 'flyer' ? 1.3 : 0.7 + seed * 0.5), t0 + dur);
      mod.frequency.setValueAtTime(f * (1.5 + seed), t0);
      modGain.gain.setValueAtTime(f * (alarm ? 2.5 : 0.8 + seed), t0);
      modGain.gain.exponentialRampToValueAtTime(f * 0.05, t0 + dur);
      mod.connect(modGain).connect(car.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      car.connect(g).connect(this.sfx);
      g.connect(this.reverb);
      car.start(t0);
      mod.start(t0);
      car.stop(t0 + dur + 0.05);
      mod.stop(t0 + dur + 0.05);
    }
  }

  play(name, opts = {}) {
    if (!this.ctx) return;
    if (this.bank?.play(name, opts)) return;
    switch (name) {
      case 'step': {
        const s = opts.surface;
        const f = s === 'metal' ? 2500 : s === 'snow' ? 1800 : s === 'sand' ? 1200 : 700;
        this.noiseBurst({ dur: s === 'metal' ? 0.09 : 0.12, vol: s === 'metal' ? 0.12 : 0.18, type: 'bandpass', f0: f * (0.85 + Math.random() * 0.3), q: s === 'metal' ? 4 : 1.2 });
        if (s === 'metal') this.tone({ type: 'triangle', f0: 300 + Math.random() * 60, dur: 0.06, vol: 0.03 });
        break;
      }
      case 'jump':
        this.noiseBurst({ dur: 0.15, vol: 0.08, type: 'bandpass', f0: 600 });
        break;
      case 'land':
        this.noiseBurst({ dur: 0.25, vol: 0.3, type: 'lowpass', f0: 400, brown: true });
        break;
      case 'hurt':
        this.tone({ type: 'square', f0: 220, f1: 80, dur: 0.3, vol: 0.08 });
        break;
      case 'pickup':
        this.tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.12, vol: 0.08 });
        this.tone({ type: 'sine', f0: 1320, dur: 0.2, vol: 0.05, delay: 0.06 });
        break;
      case 'scan':
        this.tone({ type: 'sine', f0: 300, f1: 1800, dur: 1.2, vol: 0.12, rev: true });
        this.tone({ type: 'sine', f0: 1200, f1: 600, dur: 1.4, vol: 0.05, delay: 0.25, rev: true });
        break;
      case 'ui':
        this.tone({ type: 'sine', f0: 1100, dur: 0.06, vol: 0.06 });
        break;
      case 'error':
        this.tone({ type: 'square', f0: 180, dur: 0.18, vol: 0.06 });
        break;
      case 'sell':
        this.tone({ type: 'sine', f0: 660, dur: 0.15, vol: 0.08 });
        this.tone({ type: 'sine', f0: 990, dur: 0.3, vol: 0.07, delay: 0.08, rev: true });
        break;
      case 'discovery':
        [0, 4, 7, 12, 16].forEach((n, i) => this.tone({ type: 'triangle', f0: this.midi(72 + n), dur: 1.6, vol: 0.07, delay: i * 0.12, rev: true }));
        break;
      case 'shipLaser':
        this.tone({ type: 'square', f0: 1400, f1: 200, dur: 0.18, vol: 0.05 });
        break;
      case 'impact':
        this.noiseBurst({ dur: 0.6, vol: 0.5, type: 'lowpass', f0: 600, f1: 80, brown: true });
        break;
      case 'explode':
        this.noiseBurst({ dur: 1.4, vol: 0.5, type: 'lowpass', f0: 1200, f1: 60, brown: true, rev: true });
        break;
      case 'landing':
        this.noiseBurst({ dur: 2.5, vol: 0.2, type: 'bandpass', f0: 1500, f1: 300, q: 0.8 });
        this.tone({ type: 'sine', f0: 660, dur: 0.25, vol: 0.06 });
        this.tone({ type: 'sine', f0: 440, dur: 0.35, vol: 0.06, delay: 0.15 });
        break;
      case 'touchdown':
        this.noiseBurst({ dur: 0.7, vol: 0.45, type: 'lowpass', f0: 300, f1: 60, brown: true });
        this.tone({ type: 'sine', f0: 70, f1: 40, dur: 0.5, vol: 0.3 });
        break;
      case 'takeoff':
        this.noiseBurst({ dur: 3.0, vol: 0.35, type: 'bandpass', f0: 200, f1: 1600, q: 0.6, rev: true });
        this.tone({ type: 'sawtooth', f0: 40, f1: 120, dur: 2.5, vol: 0.1 });
        break;
      case 'pulse':
        this.tone({ type: 'sawtooth', f0: 60, f1: 600, dur: 1.4, vol: 0.12, rev: true, attack: 0.3 });
        this.noiseBurst({ dur: 1.6, vol: 0.25, type: 'bandpass', f0: 300, f1: 5000, q: 0.7, rev: true });
        break;
      case 'pulseExit':
        this.noiseBurst({ dur: 1.4, vol: 0.3, type: 'bandpass', f0: 4000, f1: 200, q: 0.7, rev: true });
        break;
      case 'warp':
        this.tone({ type: 'sawtooth', f0: 40, f1: 2000, dur: 5, vol: 0.12, rev: true, attack: 1 });
        this.noiseBurst({ dur: 6, vol: 0.3, type: 'bandpass', f0: 100, f1: 8000, q: 0.5, rev: true });
        break;
      case 'warpArrive':
        this.noiseBurst({ dur: 3, vol: 0.5, type: 'lowpass', f0: 6000, f1: 100, brown: false, rev: true });
        this.tone({ type: 'sine', f0: 80, f1: 30, dur: 2.5, vol: 0.4 });
        break;
      case 'dock':
        [0, 7, 12].forEach((n, i) => this.tone({ type: 'sine', f0: this.midi(67 + n), dur: 0.8, vol: 0.06, delay: i * 0.15, rev: true }));
        break;
      // hostile skies
      case 'thunder':
        this.noiseBurst({ dur: 0.25, vol: 0.5, type: 'highpass', f0: 2500, rev: true });
        this.noiseBurst({ dur: 3.2, vol: 0.55, type: 'lowpass', f0: 500, f1: 40, brown: true, rev: true, delay: 0.08 });
        break;
      case 'hiss':
        this.noiseBurst({ dur: 0.9, vol: 0.12, type: 'bandpass', f0: 5000, f1: 3000, q: 1.5 });
        break;
      case 'creak':
        this.tone({ type: 'triangle', f0: 70 + Math.random() * 30, f1: 40, dur: 1.2, vol: 0.12, rev: true });
        this.noiseBurst({ dur: 0.8, vol: 0.15, type: 'bandpass', f0: 220, f1: 120, q: 3 });
        break;
      case 'alarm':
        [0, 0.22].forEach((d) => this.tone({ type: 'square', f0: 880, dur: 0.12, vol: 0.045, delay: d }));
        break;
      case 'greet': {
        // a few warbling syllables in an alien voice (opts.pitch sets the voice)
        const p = opts.pitch || 1;
        for (let i = 0; i < 4; i++) {
          const f = (180 + Math.random() * 160) * p;
          this.tone({ type: i % 2 ? 'triangle' : 'sine', f0: f, f1: f * (0.7 + Math.random() * 0.7), dur: 0.14 + Math.random() * 0.1, vol: 0.07, delay: i * 0.17 });
        }
        break;
      }
      case 'break':
        this.noiseBurst({ dur: 0.5, vol: 0.4, type: 'bandpass', f0: 900, f1: 200, q: 1 });
        this.tone({ type: 'triangle', f0: 400, f1: 90, dur: 0.4, vol: 0.12 });
        break;
      default:
        break;
    }
  }
}
