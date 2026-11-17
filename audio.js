'use strict';
// =====================================================================
//  AUDIO: synthesized sound effects, a geared engine with road/wind noise
//  and tyre squeal, plus soft procedural background music.
//  Everything is generated with the Web Audio API - no sound files.
//  M = mute everything, N = toggle music.
// =====================================================================

// ---- rhythmic retro arcade driving track (original composition) ----
const MUSIC_BPM = 132;
// one chord per bar: Am - F - G - Em (MIDI note numbers)
const MUSIC_CHORDS = [
  { bass: 45, tones: [57, 60, 64] },
  { bass: 41, tones: [53, 57, 60] },
  { bass: 43, tones: [55, 59, 62] },
  { bass: 40, tones: [52, 55, 59] },
];
// 8-bar lead melody in eighth notes: MIDI note, 0 = rest, -1 = hold previous note
const MELODY = [
  69, 0, 72, 74, 76, 0, 74, 72,
  72, -1, 69, -1, 65, 67, 69, 0,
  71, 0, 74, 76, 79, -1, 76, 74,
  76, -1, -1, 0, 74, 72, 71, 0,
  81, 0, 79, 76, 74, 0, 76, 79,
  77, -1, 76, 74, 72, -1, 69, 0,
  74, 76, 79, 81, 79, -1, 76, 74,
  76, -1, -1, -1, 0, 0, 0, 0,
];
// drums per bar of 16 sixteenth-steps
const KICK = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
const ARP = [0, 1, 2, 1, 0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1];
// 32-bar song form: intro (8) -> full with melody (16) -> breakdown (8)
const SECTION = bar => { const b = bar % 32; return b < 8 ? 'intro' : b < 24 ? 'full' : 'break'; };
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

  // ---------- background music: rhythmic retro driving track ----------
  // A 16th-note step sequencer scheduled slightly ahead on the audio clock.
  startMusic() {
    if (!this.ac || this.musicTimer) return;
    this.mNext = this.ac.currentTime + 0.3; this.mStep = 0;
    this.musicTimer = setInterval(() => this.schedMusic(), 90);
  },
  schedMusic() {
    const ac = this.ac, six = 60 / MUSIC_BPM / 4;
    while (this.mNext < ac.currentTime + 0.5) {
      this.musicStep(this.mStep, this.mNext, six);
      this.mNext += six; this.mStep++;
    }
  },
  musicStep(step, t, six) {
    const s = step % 16, bar = Math.floor(step / 16);
    const sec = SECTION(bar), ch = MUSIC_CHORDS[bar % MUSIC_CHORDS.length];
    const fill = bar % 8 === 7 && s >= 12;           // drum fill into each new phrase

    // --- drums ---
    if (sec !== 'break') {
      if (KICK[s] || (fill && s % 2 === 0)) this.kick(t);
      if (sec === 'full' && (SNARE[s] || (fill && s % 2 === 1))) this.snare(t, fill ? 0.12 : 0.17);
      if (sec === 'intro' && s === 12) this.snare(t, 0.1);
    } else if (s === 0 && bar % 2 === 0) this.kick(t, 0.25);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.05 : 0.025, false);   // 8ths, accented off-beats
    else if (sec === 'full') this.hat(t, 0.012, false);                // ghost 16ths
    if (s === 14 && sec !== 'break') this.hat(t, 0.04, true);           // open hat

    // --- pumping octave bass on every 8th ---
    if (s % 2 === 0 && sec !== 'break') {
      const n = ch.bass + (s % 4 === 2 ? 12 : 0);
      this.bass(midiHz(n), t, six * 1.7, sec === 'intro' ? 0.055 : 0.07);
    } else if (sec === 'break' && s === 0) this.bass(midiHz(ch.bass), t, six * 15, 0.06);

    // --- chord pad at the start of each bar ---
    if (s === 0) for (const n of ch.tones) this.pad(midiHz(n), t, six * 16, sec === 'break' ? 0.02 : 0.01);

    // --- 16th arpeggio (quiet under the melody, louder in the breakdown) ---
    if (sec !== 'intro' || bar % 8 >= 4) {
      const n = ch.tones[ARP[s]] + 12;
      this.pluck(midiHz(n), t, sec === 'break' ? 0.022 : 0.011, 0.25);
    }

    // --- lead melody (8th notes) in the full section ---
    if (sec === 'full' && s % 2 === 0) {
      const i = ((bar - 8) % 8) * 8 + s / 2, note = MELODY[i];
      if (note > 0) {
        let len = 1; while (i + len < MELODY.length && MELODY[i + len] === -1) len++;
        this.lead(midiHz(note), t, six * 2 * len);
      }
    }
  },
  kick(t, vol = 0.55) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.3);
  },
  snare(t, vol) {
    const ac = this.ac, n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    n.buffer = this.noiseBuf; f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(f); f.connect(g); g.connect(this.musicBus); n.start(t, Math.random()); n.stop(t + 0.18);
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    og.gain.setValueAtTime(vol * 0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og); og.connect(this.musicBus); o.start(t); o.stop(t + 0.12);
  },
  hat(t, vol, open) {
    const ac = this.ac, n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    n.buffer = this.noiseBuf; f.type = 'highpass'; f.frequency.value = 7000;
    const d = open ? 0.22 : 0.035;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    n.connect(f); f.connect(g); g.connect(this.musicBus); n.start(t, Math.random()); n.stop(t + d + 0.02);
  },
  bass(f, t, dur, vol) {
    const ac = this.ac, o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(lp); lp.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.02);
  },
  pad(f, t, dur, vol) {
    const ac = this.ac, g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1100;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.3);
    g.gain.setValueAtTime(vol, t + dur - 0.2); g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    for (const det of [-7, 7]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.4);
    }
    lp.connect(g); g.connect(this.musicBus);
  },
  pluck(f, t, vol, dur = 0.3) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.02);
  },
  lead(f, t, dur) {
    const ac = this.ac, o = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = f;
    o2.type = 'square'; o2.frequency.value = f; o2.detune.value = 9;
    const vib = ac.createOscillator(), vg = ac.createGain();      // gentle vibrato
    vib.frequency.value = 5.5; vg.gain.value = 6; vib.connect(vg); vg.connect(o.detune); vg.connect(o2.detune);
    lp.type = 'lowpass'; lp.frequency.value = 2400;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.028, t + 0.01);
    g.gain.setValueAtTime(0.024, t + Math.max(0.02, dur - 0.05)); g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
    o.connect(lp); o2.connect(lp); lp.connect(g);
    g.connect(this.musicBus); g.connect(this.delay);
    for (const x of [o, o2, vib]) { x.start(t); x.stop(t + dur + 0.06); }
  },
};
