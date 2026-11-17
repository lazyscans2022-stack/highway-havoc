'use strict';
// =====================================================================
//  AUDIO: synthesized sound effects, a geared engine with road/wind noise
//  and tyre squeal, plus soft procedural background music.
//  Everything is generated with the Web Audio API - no sound files.
//  M = mute everything, N = toggle music.
// =====================================================================

const MUSIC_BPM = 68;
// soothing progression: Am9 - Fmaj7 - Cmaj7 - Em7 (MIDI note numbers)
const MUSIC_CHORDS = [
  { bass: 45, pad: [57, 60, 64, 71] },
  { bass: 41, pad: [53, 57, 60, 64] },
  { bass: 36, pad: [55, 59, 60, 64] },
  { bass: 40, pad: [55, 59, 62, 64] },
];
const ARP = [0, 2, 1, 3, 2, 1, 3, 2];
const GEARS = [170, 300, 430, 560, 700, 900];   // top speed (px/s) of each gear
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

const sfx = {
  ac: null, master: null, sfxBus: null, musicBus: null, muted: false, musicOn: true,
  noiseBuf: null, musicTimer: null, mNext: 0, mStep: 0,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = this.ac = new AC();
      this.master = ac.createGain(); this.master.gain.value = 0.55; this.master.connect(ac.destination);
      this.sfxBus = ac.createGain(); this.sfxBus.connect(this.master);
      this.musicBus = ac.createGain(); this.musicBus.gain.value = 0.55; this.musicBus.connect(this.master);
      const len = ac.sampleRate * 2;
      this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // --- engine: sawtooth + sub square through a lowpass, pitch follows RPM ---
      this.eng = ac.createOscillator(); this.eng.type = 'sawtooth';
      this.engSub = ac.createOscillator(); this.engSub.type = 'square';
      const subG = ac.createGain(); subG.gain.value = 0.5;
      this.engFilt = ac.createBiquadFilter(); this.engFilt.type = 'lowpass'; this.engFilt.Q.value = 2;
      this.engGain = ac.createGain(); this.engGain.gain.value = 0;
      this.eng.connect(this.engFilt); this.engSub.connect(subG); subG.connect(this.engFilt);
      this.engFilt.connect(this.engGain); this.engGain.connect(this.sfxBus);
      this.eng.start(); this.engSub.start();
      // --- looping noise layers: wind, road rumble, tyre squeal, gravel ---
      const loop = (type, freq, q) => {
        const s = ac.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
        const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ac.createGain(); g.gain.value = 0;
        s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start();
        return { g, f };
      };
      this.wind = loop('bandpass', 900, 0.6);
      this.rumble = loop('lowpass', 180, 0.7);
      this.squeal = loop('bandpass', 2600, 9);
      this.gravel = loop('lowpass', 500, 1);

      // --- music bus with a soft echo ---
      this.delay = ac.createDelay(1.5); this.delay.delayTime.value = 60 / MUSIC_BPM * 0.75;
      const fb = ac.createGain(); fb.gain.value = 0.35;
      const wet = ac.createGain(); wet.gain.value = 0.35;
      this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(wet); wet.connect(this.musicBus);
      this.startMusic();
    } catch (e) { this.ac = null; }
  },
  setMuted(m) { this.muted = m; if (this.ac) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ac.currentTime, 0.05); },
  toggleMusic() { this.musicOn = !this.musicOn; if (this.ac) this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.55 : 0, this.ac.currentTime, 0.3); },

  // ---------- one-shot effects ----------
  tone(f, dur, type = 'square', vol = 0.1, f2 = null) {
    if (!this.ac) return;
    const t = this.ac.currentTime, o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.3, freq = 1000, type = 'lowpass') {
    if (!this.ac) return;
    const t = this.ac.currentTime, s = this.ac.createBufferSource(), f = this.ac.createBiquadFilter(), g = this.ac.createGain();
    s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  gun() { this.tone(1000, 0.05, 'square', 0.03, 450); },
  boom(big) { this.noise(big ? 1.4 : 0.7, big ? 0.7 : 0.4, big ? 500 : 800); this.tone(big ? 90 : 130, big ? 0.8 : 0.4, 'sine', big ? 0.5 : 0.3, 30); },
  hit() { this.noise(0.06, 0.12, 2500, 'bandpass'); },
  crash() { this.noise(0.3, 0.35, 1200); this.tone(70, 0.25, 'sine', 0.2, 40); },
  pickup() { this.tone(600, 0.1, 'triangle', 0.15, 900); setTimeout(() => this.tone(900, 0.18, 'triangle', 0.15, 1500), 90); },
  rocket() { this.noise(0.7, 0.25, 2500, 'highpass'); },
  drop() { this.tone(300, 0.15, 'triangle', 0.12, 120); },
  whistle() { this.tone(1500, 1.2, 'sine', 0.04, 350); },
  rotor() { this.noise(0.05, 0.1, 260); },
  alarm() { this.tone(700, 0.18, 'square', 0.06, 700); setTimeout(() => this.tone(520, 0.18, 'square', 0.06, 520), 200); },

  // ---------- continuous driving sound ----------
  // s = { speed, on, throttle (0/1), skid (0..1), off (0..1), muffled }
  drive(s) {
    if (!this.ac) return;
    const t = this.ac.currentTime, sp = Math.max(0, s.speed || 0);
    // gearbox: RPM climbs through each gear then drops on the shift
    let g = 0; while (g < GEARS.length - 1 && sp > GEARS[g]) g++;
    const lo = g ? GEARS[g - 1] : 0, frac = Math.min(1, (sp - lo) / (GEARS[g] - lo));
    const rpm = 0.22 + 0.78 * frac * (g === 0 ? 1 : 0.75) + (g ? 0.25 : 0);
    const thr = s.throttle ? 1 : 0;
    const on = s.on && !this.muted;
    const mf = s.muffled ? 0.35 : 1;
    this.eng.frequency.setTargetAtTime(38 + rpm * 92, t, 0.06);
    this.engSub.frequency.setTargetAtTime((38 + rpm * 92) / 2, t, 0.06);
    this.engFilt.frequency.setTargetAtTime((300 + rpm * 1300 + thr * 500) * (s.muffled ? 0.4 : 1), t, 0.08);
    this.engGain.gain.setTargetAtTime(on ? (0.032 + thr * 0.02) * mf : 0, t, 0.08);
    const v = Math.min(1, sp / 720);
    this.wind.g.gain.setTargetAtTime(on ? v * v * 0.07 * mf : 0, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(500 + v * 900, t, 0.2);
    this.rumble.g.gain.setTargetAtTime(on ? v * 0.09 * mf : 0, t, 0.2);
    this.squeal.g.gain.setTargetAtTime(on && sp > 80 ? (s.skid || 0) * 0.05 : 0, t, 0.05);
    this.gravel.g.gain.setTargetAtTime(on ? (s.off || 0) * v * 0.18 : 0, t, 0.1);
  },
  engine(speed, on) { this.drive({ speed, on }); },   // used when pausing / game over

  // ---------- background music ----------
  startMusic() {
    if (!this.ac || this.musicTimer) return;
    this.mNext = this.ac.currentTime + 0.3; this.mStep = 0;
    this.musicTimer = setInterval(() => this.schedMusic(), 100);
  },
  schedMusic() {
    const ac = this.ac, eighth = 60 / MUSIC_BPM / 2;
    while (this.mNext < ac.currentTime + 0.6) {
      this.musicStep(this.mStep, this.mNext, eighth);
      this.mNext += eighth; this.mStep++;
    }
  },
  musicStep(step, t, eighth) {
    const ch = MUSIC_CHORDS[Math.floor(step / 16) % MUSIC_CHORDS.length];
    if (step % 16 === 0) {
      for (const n of ch.pad) this.pad(midiHz(n), t, eighth * 16);
      this.bass(midiHz(ch.bass), t, eighth * 7);
    }
    if (step % 16 === 8) this.bass(midiHz(ch.bass + 7 > 52 ? ch.bass : ch.bass + 7), t, eighth * 7);
    // gentle arpeggio, with breathing gaps
    const phrase = Math.floor(step / 64) % 2;
    if ((step % 2 === 0 || phrase === 1) && Math.random() < 0.85) {
      const n = ch.pad[ARP[step % 8]] + 12 + (step % 32 > 27 ? 12 : 0);
      this.pluck(midiHz(n), t, phrase ? 0.016 : 0.02);
    }
  },
  pad(f, t, dur) {
    const ac = this.ac, g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.016, t + 1.6);
    g.gain.setValueAtTime(0.016, t + dur - 0.4); g.gain.linearRampToValueAtTime(0, t + dur + 1.8);
    for (const [type, det] of [['triangle', 0], ['sine', 5], ['sine', -6]]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 2);
    }
    lp.connect(g); g.connect(this.musicBus);
  },
  bass(f, t, dur) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.05);
  },
  pluck(f, t, vol) {
    const ac = this.ac, o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = f; o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g2 = ac.createGain(); g2.gain.value = 0.25;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(this.musicBus); g.connect(this.delay);
    o.start(t); o2.start(t); o.stop(t + 1.5); o2.stop(t + 1.5);
  },
};
