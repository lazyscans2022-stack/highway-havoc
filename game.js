'use strict';
// =====================================================================
//  HIGHWAY HAVOC  -  top-down highway survival / vehicular combat
// =====================================================================

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const W = 540, H = 900, STRIP = 5, PXM = 10; // 10 px = 1 metre
const STEER_RATIO = 0.75; // max sideways speed = forward speed x this (no sliding sideways while stopped)

function resize() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = (W * s) + 'px';
  cv.style.height = (H * s) + 'px';
}
addEventListener('resize', resize); resize();

// ---------- utils ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const pick = a => a[Math.floor(Math.random() * a.length)];
const sy = w => H - (w - camD);           // world distance -> screen y

// ---------- input ----------
const keys = {}; let pressed = {};
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  sfx.init();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') paused = true; });
const down = (...c) => c.some(k => keys[k]);
const tapped = (...c) => c.some(k => pressed[k]);


// =====================================================================
//  WORLD: biomes, road sections, bridges, obstacles, fog
// =====================================================================
const BIOMES = [
  { name: 'GRASSLAND', ground: [92, 156, 66], road: '#4b4c52', shoulder: '#b9ad84', water: [58, 118, 178], obst: ['tree', 'tree', 'bush'], density: 0.30, decor: 'grass' },
  { name: 'DESERT', ground: [218, 184, 124], road: '#59544d', shoulder: '#e9d7a6', water: [70, 140, 170], obst: ['cactus', 'cactus', 'rock'], density: 0.20, decor: 'sand' },
  { name: 'DEEP FOREST', ground: [44, 96, 50], road: '#45464b', shoulder: '#7d6f52', water: [40, 92, 120], obst: ['pine', 'pine', 'tree'], density: 0.75, decor: 'leaf' },
  { name: 'SNOWFIELDS', ground: [226, 233, 240], road: '#575b64', shoulder: '#c9cfd8', water: [96, 140, 180], obst: ['snowpine', 'snowpine', 'rock'], density: 0.38, decor: 'snow' },
];
const NB = BIOMES.length, BIOME_LEN = 36000; // 3.6 km per biome
const biomeAt = w => Math.floor(Math.max(0, w) / BIOME_LEN) % NB;

function groundRGB(w) {
  w = Math.max(0, w);
  const p = w % BIOME_LEN, i = Math.floor(w / BIOME_LEN) % NB, T = 2400;
  let a = i, b = i, t = 0;
  if (p > BIOME_LEN - T / 2) { b = (i + 1) % NB; t = (p - (BIOME_LEN - T / 2)) / T; }
  else if (p < T / 2 && w > T) { a = (i + NB - 1) % NB; t = 0.5 + p / T; }
  t = smooth(t);
  const A = BIOMES[a].ground, B = BIOMES[b].ground;
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

let sections = [], obstacles = [], decor = [], fogZones = [], nextFogW = 0;

function genSection() {
  const prev = sections[sections.length - 1];
  const start = prev ? prev.start + prev.len : -3000;
  const cx0 = prev ? prev.cx1 : W / 2, hw0 = prev ? prev.hw1 : 205;
  const dm = start / PXM;
  let s;
  if (prev && prev.kind === 'approach') {
    s = { kind: 'bridge', len: randi(1500, 2600), cx1: cx0, hw1: hw0, wallL: true, wallR: true };
  } else if (prev && prev.kind === 'normal' && dm > 500 && Math.random() < 0.17) {
    s = { kind: 'approach', len: 1100, cx1: clamp(cx0, W / 2 - 50, W / 2 + 50), hw1: 150, wallL: true, wallR: true };
  } else {
    const hw1 = rand(165, 232);
    const maxShift = Math.max(0, W / 2 - hw1 - 34);
    const walls = dm > 250;
    s = {
      kind: 'normal', len: randi(1800, 4200), hw1,
      cx1: W / 2 + rand(-1, 1) * maxShift,
      wallL: walls && Math.random() < 0.4, wallR: walls && Math.random() < 0.4
    };
  }
  s.start = start; s.cx0 = cx0; s.hw0 = hw0;
  s.trans = s.kind === 'bridge' ? 1 : Math.min(1400, s.len * 0.7);
  sections.push(s);
  populate(s);
}

function sectionAt(w) {
  let lo = 0, hi = sections.length - 1;
  if (w < sections[0].start) return sections[0];
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (sections[m].start <= w) lo = m; else hi = m - 1; }
  return sections[lo];
}
function roadAt(w) {
  const s = sectionAt(w);
  const e = smooth(clamp((w - s.start) / s.trans, 0, 1));
  return { cx: s.cx0 + (s.cx1 - s.cx0) * e, hw: s.hw0 + (s.hw1 - s.hw0) * e, wallL: s.wallL, wallR: s.wallR, bridge: s.kind === 'bridge', s };
}
const laneCount = hw => Math.max(2, Math.round(2 * hw / 82));
const laneX = (r, i, n) => r.cx - r.hw + (2 * r.hw / n) * (i + 0.5);

const OBST_R = { tree: 19, bush: 0, pine: 15, cactus: 10, rock: 13, snowpine: 15 };

function populate(s) {
  if (s.kind === 'bridge') return;
  for (let w = s.start; w < s.start + s.len; w += rand(28, 64)) {
    const r = roadAt(w), B = BIOMES[biomeAt(w)];
    for (const side of [-1, 1]) {
      if (Math.random() < B.density) {
        const type = pick(B.obst), rad = OBST_R[type];
        const edge = r.cx + side * r.hw;
        const off = 30 + rad + (Math.random() < 0.3 ? rand(0, 12) : rand(14, 170));
        const x = edge + side * off;
        if (x < -20 || x > W + 20) continue;
        let ok = true;
        for (const dw of [-40, 0, 40]) { const q = roadAt(w + dw); if (Math.abs(x - q.cx) < q.hw + 26 + rad) ok = false; }
        if (ok) obstacles.push({ x, w, type, r: rad, seed: Math.random(), dead: false });
      }
    }
    for (let k = 0; k < 2; k++) {
      const x = rand(0, W), ww = w + rand(0, 40);
      if (Math.abs(x - r.cx) > r.hw + 16) decor.push({ x, w: ww, type: B.decor, seed: Math.random() });
    }
    // road wear: patches, cracks, old oil stains
    if (Math.random() < 0.09) {
      decor.push({ x: r.cx + rand(-r.hw + 14, r.hw - 14), w: w + rand(0, 30), type: pick(['patch', 'crack', 'crack', 'stain']), seed: Math.random() });
    }
  }
}

function genFog() {
  const len = rand(6000, 10000);
  fogZones.push({ start: nextFogW, end: nextFogW + len });
  nextFogW += len + rand(14000, 28000);
}
function fogAt(w) {
  const RAMP = 1500;
  for (const z of fogZones) {
    if (w > z.start - RAMP && w < z.end + RAMP) {
      if (w < z.start) return smooth((w - (z.start - RAMP)) / RAMP);
      if (w > z.end) return smooth(1 - (w - z.end) / RAMP);
      return 1;
    }
  }
  return 0;
}

function ensureGen() {
  while (!sections.length || sections[sections.length - 1].start + sections[sections.length - 1].len < camD + H + 3000) genSection();
  while (fogZones.length === 0 || fogZones[fogZones.length - 1].end < camD + H + 30000) genFog();
  while (sections.length > 3 && sections[1].start + sections[1].len < camD - 1500) sections.shift();
  if (obstacles.length && obstacles[0].w < camD - 200) obstacles = obstacles.filter(o => o.w > camD - 100);
  if (decor.length && decor[0].w < camD - 200) decor = decor.filter(o => o.w > camD - 100);
  while (fogZones.length > 1 && fogZones[0].end + 3000 < camD) fogZones.shift();
}

// =====================================================================
//  GAME STATE
// =====================================================================
let state = 'title', paused = false;
let camD = 0, camSpeed = 0, time = 0, shake = 0;
let player, cars, bullets, rockets, bombs, craters, oils, smokes, particles, popups, heli;
let score = 0, killScore = 0, lives = 3, best = 0;
let civT = 0, enemyT = 0, nextSupplyM = 0, nextHeliM = 0, heliSupplySent = false;
let banner = null, curBiome = 0, fogWarned = -1, fogLevel = 0, hurtFlash = 0;

try { best = +localStorage.getItem('hh_best') || 0; } catch (e) { best = 0; }

const CIV_COLORS = ['#e8e8e8', '#3a6fd8', '#e3c22b', '#7a7f87', '#2f9e61', '#d8742a', '#8b4fc9', '#b8d8e8', '#f0a0b8', '#6b4a2e'];

function newPlayer() {
  return {
    type: 'player', color: '#e9edf2', style: 'sport', ai: null, x: W / 2, w: 300, speed: 280, vx: 0, angle: 0, spin: 0, spinDir: 1, knock: 0,
    hw: 15, hl: 28, mass: 1.2, hp: 100, inv: 0, dead: false, deadT: 0, off: 0, gunCD: 0,
    oil: 2, smoke: 1, rockets: 0, smokeT: 0, smokeEmit: 0, oilImmune: 0, dustT: 0
  };
}

function resetGame() {
  sections = []; obstacles = []; decor = []; fogZones = []; nextFogW = BIOME_LEN * NB;   // fog only after every biome has been driven once
  player = newPlayer();
  cars = []; bullets = []; rockets = []; bombs = []; craters = []; oils = []; smokes = []; particles = []; popups = []; skids = [];
  heli = null;
  camD = player.w - 260 + player.speed * 0.16; camSpeed = player.speed;
  time = 0; shake = 0; score = 0; killScore = 0; lives = 3;
  civT = 0.5; enemyT = 6; nextSupplyM = rand(700, 1000); nextHeliM = rand(2200, 2700); heliSupplySent = false;
  banner = null; curBiome = 0; fogWarned = -1; fogLevel = 0; hurtFlash = 0;
  ensureGen();
  for (let i = 0; i < 5; i++) spawnCiv(true);
  showBanner('GRASSLAND', 'Survive as long as you can', '#9be37a');
}

function showBanner(text, sub = '', color = '#fff', t = 2.6) { banner = { text, sub, color, t, max: t }; }
function popup(text, x, y, color = '#fff') { popups.push({ text, x, y, color, life: 1.2 }); }

// ---------- vehicle factory ----------
function makeCar(type, x, w, speed) {
  const c = {
    type, x, w, speed, vx: 0, angle: 0, spin: 0, spinDir: 1, hp: 4, mass: 1, hw: 15, hl: 28,
    color: '#fff', ai: { cd: 0, align: 0, lunge: 0, push: 0, side: Math.random() < 0.5 ? -1 : 1, lcd: 0, bdir: 1 },
    blind: 0, oilImmune: 0, flash: 0, accel: 300, brake: 600, latMax: 150, grip: 5, maxSp: 800,
    cruise: speed, lane: 0, style: 'sedan', dead: false, wreckT: 0, age: 0,
    heading: 0, steerV: 0, slip: 0, knock: 0, turnRate: 1.6
  };
  switch (type) {
    case 'civ':
      c.style = pick(['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'pickup', 'truck']);
      c.color = pick(CIV_COLORS); c.accel = 160; c.brake = 520; c.latMax = 110; c.grip = 5; c.turnRate = 1.1;
      if (c.style === 'truck') { c.hw = 18; c.hl = 42; c.mass = 2.6; c.hp = 9; }
      if (c.style === 'hatch') { c.hl = 24; }
      break;
    case 'rammer':
      c.color = '#c3282d'; c.hp = 7; c.mass = 1.5; c.hw = 16; c.hl = 30;
      c.accel = 380; c.brake = 650; c.latMax = 220; c.grip = 6; c.maxSp = 900; c.turnRate = 2.0;
      c.ai.phase = 'stalk'; c.ai.t = 0; break;
    case 'puncture':
      c.color = '#1d1d22'; c.hp = 5; c.mass = 2.6; c.accel = 340; c.brake = 480;
      c.latMax = 220; c.grip = 7; c.maxSp = 780; c.turnRate = 2.2; break;
    case 'van':
      c.color = '#4d5b3c'; c.hp = 16; c.mass = 3.2; c.hw = 19; c.hl = 37;
      c.accel = 300; c.brake = 520; c.latMax = 175; c.grip = 4; c.maxSp = 720; c.turnRate = 1.5; break;
    case 'supply':
      c.color = '#d9a21b'; c.hp = 1e9; c.mass = 4; c.hw = 20; c.hl = 46;
      c.accel = 220; c.brake = 400; c.latMax = 90; c.grip = 4; c.maxSp = 1000; c.turnRate = 0.9; break;
  }
  return c;
}

function laneFree(c, r, i, n, w0 = c.w) {
  const lx = laneX(r, i, n);
  for (const o of cars) {
    if (o === c) continue;
    const dw = o.w - w0;
    if (dw > -90 && dw < 190 && Math.abs(o.x - lx) < 36) return false;
  }
  if (player && !player.dead && c) { const dw = player.w - w0; if (dw > -90 && dw < 140 && Math.abs(player.x - lx) < 36) return false; }
  for (const k of craters) { const dw = k.w - w0; if (dw > -60 && dw < 240 && Math.abs(k.x - lx) < k.r + 24) return false; }
  return true;
}

function spawnCiv(initial = false) {
  const p = player;
  const ahead = initial || p.speed > 300 || Math.random() < 0.6;
  const w = initial ? camD + rand(300, H + 400) : ahead ? camD + H + rand(60, 200) : camD - 120;
  const r = roadAt(w), n = laneCount(r.hw);
  const c = makeCar('civ', 0, w, 0);
  const lanes = [...Array(n).keys()].sort(() => Math.random() - 0.5);
  for (const i of lanes) {
    if (laneFree(null, r, i, n, w)) {
      c.lane = i; c.x = laneX(r, i, n);
      c.cruise = ahead ? rand(210, 360) : rand(Math.max(380, p.speed + 60), Math.max(440, p.speed + 140));
      if (c.style === 'truck') c.cruise = Math.min(c.cruise, 300);
      c.speed = c.cruise;
      cars.push(c);
      return;
    }
  }
}

function spawnEnemy(dm) {
  const p = player;
  // enemies unlock by region: rammers from the start (grassland), tyre busters
  // from the desert onwards, vans from the deep forest onwards
  const types = ['rammer'];
  if (p.w >= BIOME_LEN) types.push('puncture', 'puncture');
  if (p.w >= BIOME_LEN * 2) types.push('van', 'van');
  const type = pick(types);
  let behind = type === 'rammer' ? true : Math.random() < 0.55;
  const w = behind ? camD - rand(90, 160) : camD + H + rand(80, 160);
  const r = roadAt(w);
  const x = clamp(p.x + rand(-80, 80), r.cx - r.hw + 25, r.cx + r.hw - 25);
  const c = makeCar(type, x, w, behind ? p.speed + 90 : Math.max(120, p.speed - 120));
  cars.push(c);
  if (behind && type !== 'puncture') sfx.alarm();
}

function spawnSupply(cargo) {
  const p = player;
  const w = camD + H + 120;
  const r = roadAt(w), n = laneCount(r.hw);
  const c = makeCar('supply', laneX(r, Math.floor(n / 2), n), w, clamp(p.speed * 0.6, 170, 330));
  c.cruise = c.speed; c.lane = Math.floor(n / 2); c.ai.cargo = cargo; c.ai.state = 'cruise'; c.ai.ramp = 0; c.ai.msgT = 0;
  cars.push(c);
  showBanner('SUPPLY TRUCK AHEAD', 'Slow down, line up and drive into its trailer for ' + cargoName(cargo), '#ffd34d', 2.8);
  sfx.pickup();
}
const cargoName = c => ({ rockets: 'ROCKETS', oil: 'OIL SLICKS', smoke: 'SMOKE SCREEN' })[c];

function spawnHeli() {
  heli = { x: player.x, w: camD + H + 120, off: H + 120, state: 'enter', t: 0, bombCD: 2.5, rotor: 0, fallT: 0, ang: 0, rotorT: 0 };
  showBanner('HELICOPTER INCOMING!', 'Dodge its bombs - or shoot it down with a rocket [C]', '#ff6b4a', 3);
  sfx.alarm();
}

// =====================================================================
//  EFFECTS
// =====================================================================
function addParticle(o) { particles.push(Object.assign({ vx: 0, vw: 0, life: 1, max: 1, size: 4, color: '#fff', grow: 0, kind: 'dot' }, o)); }
function explode(x, w, big = false) {
  const n = big ? 46 : 26;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(40, big ? 420 : 300);
    addParticle({ x, w, vx: Math.cos(a) * s, vw: Math.sin(a) * s + camSpeed * 0.6, life: rand(0.4, 0.9), max: 0.9, size: rand(3, big ? 11 : 8), color: pick(['#ffdf6b', '#ff9c2a', '#ff5a1f', '#fff1b0']), kind: 'fire' });
  }
  for (let i = 0; i < (big ? 18 : 10); i++) {
    addParticle({ x: x + rand(-15, 15), w: w + rand(-15, 15), vx: rand(-40, 40), vw: rand(-40, 40) + camSpeed * 0.3, life: rand(0.8, 1.6), max: 1.6, size: rand(8, 16), grow: 22, color: '#333', kind: 'smoke' });
  }
  for (let i = 0; i < 8; i++) {
    addParticle({ x, w, vx: rand(-260, 260), vw: rand(-260, 260) + camSpeed * 0.5, life: rand(0.5, 1), max: 1, size: rand(2, 4), color: '#222', kind: 'debris' });
  }
  // bright flash + shockwave ring
  addParticle({ x, w, vw: camSpeed * 0.5, life: 0.18, max: 0.18, size: big ? 75 : 48, color: '#fff3c0', kind: 'flash' });
  addParticle({ x, w, vw: camSpeed * 0.5, life: 0.4, max: 0.4, size: 12, grow: big ? 330 : 220, color: '#ffffff', kind: 'ring' });
  shake = Math.max(shake, big ? 14 : 7);
  sfx.boom(big);
}
function sparks(x, w, n = 6, color = '#ffe08a') {
  for (let i = 0; i < n; i++) addParticle({ x, w, vx: rand(-200, 200), vw: rand(-150, 150) + camSpeed * 0.8, life: rand(0.15, 0.35), max: 0.35, size: rand(1.5, 3), color, kind: 'spark' });
}

// =====================================================================
//  PLAYER
// =====================================================================
function hurt(d) {
  const p = player;
  if (p.inv > 0 || p.dead || p.inTruck || d <= 0) return;
  p.hp -= d; hurtFlash = Math.min(0.6, hurtFlash + d * 0.02);
  if (p.hp <= 0) { p.hp = 0; killPlayer('YOUR CAR WAS WRECKED'); }
}
function killPlayer(reason) {
  const p = player;
  if (p.dead || p.inv > 0 || p.inTruck) return;
  p.dead = true; p.deadT = 2.2; p.spin = 0; lives--;
  explode(p.x, p.w, true);
  showBanner(reason, lives > 0 ? lives + (lives === 1 ? ' car' : ' cars') + ' left' : 'No cars left', '#ff5a4a', 2.2);
}
function respawn() {
  const p = player;
  if (lives <= 0) { gameOver(); return; }
  p.dead = false; p.inv = 3; p.hp = 100; p.spin = 0; p.vx = 0; p.knock = 0; p.angle = 0;
  p.w = camD + 240; p.speed = 300;
  const r = roadAt(p.w); p.x = r.cx;
  cars = cars.filter(c => Math.abs(c.w - p.w) > 260 || c.type === 'supply');
  craters = craters.filter(k => Math.abs(k.w - p.w) > 200);
}
function gameOver() {
  state = 'over';
  score = Math.floor(player.w / PXM) + killScore;
  if (score > best) { best = score; try { localStorage.setItem('hh_best', String(best)); } catch (e) { } }
  sfx.engine(0, false);
}

function offFactor(c, r) {
  const L = r.cx - r.hw - 6, R = r.cx + r.hw + 6;
  const l = clamp((L - (c.x - c.hw)) / (2 * c.hw), 0, 1);
  const rr = clamp(((c.x + c.hw) - R) / (2 * c.hw), 0, 1);
  return Math.max(l, rr);
}

// ---------- riding inside the supply truck ----------
const BOARD_T = 0.8, RIDE_T = 3.5, EXIT_T = 0.9;
const SUPPLY_ALIGN = 11;        // px of sideways error allowed when driving into the trailer
const SUPPLY_MAX_CLOSE = 170;   // max closing speed (px/s, ~50 km/h) when you drive in
function updateInTruck(p, dt) {
  const T = p.inTruck, c = T.truck;
  T.t += dt;
  const parked = -6, outside = -(c.hl + p.hl + 16);   // offsets from the truck's centre
  p.vx = 0; p.speed = c.speed; p.spin = 0; p.knock = 0;
  if (T.phase === 'in') {                     // roll up the ramp into the trailer
    const k = smooth(Math.min(1, T.t / BOARD_T));
    p.w = c.w + lerp(T.rel0, parked, k); p.x = lerp(T.x0, c.x, k); p.angle = lerp(T.a0, 0, k);
    if (T.t >= BOARD_T) { T.phase = 'ride'; T.t = 0; c.ai.state = 'load'; sfx.tone(160, 0.3, 'square', 0.08, 90); }
  } else if (T.phase === 'ride') {            // hidden inside while the crew re-arms you
    p.w = c.w + parked; p.x = c.x; p.angle = 0;
    if (T.t >= RIDE_T) {
      T.phase = 'out'; T.t = 0; c.ai.state = 'unload';
      const amt = { rockets: heli || heliSupplySent ? 3 : 2, oil: 3, smoke: 2 }[c.ai.cargo];
      p[c.ai.cargo] += amt; p.hp = Math.min(100, p.hp + 40);
      popup('+' + amt + ' ' + cargoName(c.ai.cargo), c.x, sy(c.w) - 30, '#ffd34d');
      popup('+40 REPAIR', c.x, sy(c.w) - 6, '#8cf58c');
      sfx.pickup();
    }
  } else {                                    // reverse down the ramp, then drive on
    const k = smooth(Math.min(1, T.t / EXIT_T));
    p.w = c.w + lerp(parked, outside, k); p.x = c.x; p.angle = 0;
    p.speed = c.speed - 40 * k;
    if (T.t >= EXIT_T) {
      p.inTruck = null; p.inv = 0.8; p.speed = c.speed - 40;
      c.ai.state = 'leave'; c.ai.leaveSp = c.speed;
    }
  }
}

function updatePlayer(dt) {
  const p = player;
  if (p.dead) {
    p.deadT -= dt; p.speed = Math.max(0, p.speed - 420 * dt); p.w += p.speed * dt;
    if (p.deadT <= 0) respawn();
    return;
  }
  if (p.inTruck) { updateInTruck(p, dt); return; }
  p.inv = Math.max(0, p.inv - dt); p.knock = Math.max(0, p.knock - dt); p.oilImmune = Math.max(0, p.oilImmune - dt);
  const r = roadAt(p.w);
  p.off = r.bridge ? 0 : offFactor(p, r);
  const maxSp = 620 + Math.min(110, p.w / PXM / 60);

  if (p.spin > 0) {
    p.spin -= dt; p.angle += p.spinDir * 11 * dt;
    p.speed = Math.max(140, p.speed - 300 * dt); p.vx *= Math.pow(0.4, dt);
    if (p.spin <= 0) p.angle = Math.atan2(Math.sin(p.angle), Math.cos(p.angle));   // straighten out smoothly, no snap
  } else {
    const up = down('ArrowUp', 'KeyW'), dn = down('ArrowDown', 'KeyS');
    const steer = (down('ArrowRight', 'KeyD') ? 1 : 0) - (down('ArrowLeft', 'KeyA') ? 1 : 0);
    if (up) p.speed += 380 * clamp(1.15 - p.speed / maxSp, 0.2, 1) * dt;
    else if (dn) p.speed -= 680 * dt;
    else if (p.speed > 260) p.speed -= 30 * dt;
    if (p.off > 0 && p.speed > 240) p.speed -= 520 * p.off * dt;
    p.speed = clamp(p.speed, 0, maxSp);

    const steerMax = Math.min(290, p.speed * STEER_RATIO);
    let grip = lerp(9, 1.3, p.off);
    if (p.knock > 0) grip = Math.min(grip, 1.8);
    let target = steer * steerMax;
    if (p.off > 0.2) target += Math.sin(time * 6.3) * 110 * p.off * (p.speed / 500);   // loose, skidding on grass/sand
    p.vx += (target - p.vx) * Math.min(1, grip * dt);
    const wob = p.off > 0.2 ? Math.sin(time * 9) * 0.14 * p.off : 0;
    p.angle = lerp(p.angle, clamp(p.vx / (p.speed + 220), -0.5, 0.5) + wob, Math.min(1, dt * 10));
  }
  p.w += p.speed * dt; p.x += p.vx * dt;

  // dust when off-road
  if (p.off > 0.2 && p.speed > 100) {
    p.dustT -= dt;
    if (p.dustT <= 0) {
      p.dustT = 0.03;
      const col = ['#8a7a4a', '#c9a96a', '#4b6b33', '#f4f6fa'][biomeAt(p.w)];
      addParticle({ x: p.x + rand(-12, 12), w: p.w - p.hl, vx: rand(-30, 30), vw: p.speed * 0.6, life: 0.6, max: 0.6, size: rand(4, 8), grow: 14, color: col, kind: 'smoke' });
    }
  }

  carEnvironment(p, dt, true);

  // ---- weapons ----
  p.gunCD -= dt;
  if (down('Space') && p.gunCD <= 0 && p.spin <= 0) {
    p.gunCD = 0.085;
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    for (const ox of [-7, 7]) bullets.push({ x: p.x + ox * ca + sa * p.hl, w: p.w + p.hl * ca - ox * sa, vx: sa * 1100, vw: p.speed + 1100 * ca, life: 0.5 });
    sfx.gun();
  }
  if (tapped('KeyZ', 'Digit1') && p.oil > 0) {
    p.oil--; oils.push({ x: p.x, w: p.w - p.hl - 24, r: 30, life: 14 }); sfx.drop();
  }
  if (tapped('KeyX', 'Digit2') && p.smoke > 0 && p.smokeT <= 0) {
    p.smoke--; p.smokeT = 3.2; sfx.noise(1.5, 0.2, 600);
  }
  if (tapped('KeyC', 'Digit3') && p.rockets > 0) {
    p.rockets--;
    const tgt = heli && (heli.state === 'hover' || heli.state === 'enter' || heli.state === 'leave') ? heli : null;
    rockets.push({ x: p.x, w: p.w + p.hl, vx: 0, vw: p.speed + 350, life: 3.2, target: tgt, trailT: 0 });
    sfx.rocket();
  }
  if (p.smokeT > 0) {
    p.smokeT -= dt; p.smokeEmit -= dt;
    if (p.smokeEmit <= 0) {
      p.smokeEmit = 0.045;
      smokes.push({ x: p.x + rand(-14, 14), w: p.w - p.hl - 8, vx: rand(-25, 25), r: rand(18, 26), life: 4.5, max: 4.5 });
    }
  }
}

// Walls, water, trees, craters, oil, smoke  (shared by all vehicles)
function carEnvironment(c, dt, isPlayer) {
  const r = roadAt(c.w);
  const L = r.cx - r.hw, R = r.cx + r.hw;
  // --- walls / bridge rails ---
  let hitV = 0, hx = 0;
  if (r.wallL) {
    if (c.x - c.hw < L - 2 && c.x > L - 30) { hitV = Math.max(0, -c.vx); c.x = L - 2 + c.hw; c.vx = Math.abs(c.vx) * 0.35; hx = L; }
    else if (c.x <= L - 30 && c.x + c.hw > L - 10) { c.x = L - 10 - c.hw; c.vx = -Math.abs(c.vx) * 0.3; hitV = 200; hx = L - 10; }
  }
  if (r.wallR) {
    if (c.x + c.hw > R + 2 && c.x < R + 30) { hitV = Math.max(0, c.vx); c.x = R + 2 - c.hw; c.vx = -Math.abs(c.vx) * 0.35; hx = R; }
    else if (c.x >= R + 30 && c.x - c.hw < R + 10) { c.x = R + 10 + c.hw; c.vx = Math.abs(c.vx) * 0.3; hitV = 200; hx = R + 10; }
  }
  if (hx) {
    if (hitV > 60) { sparks(hx, c.w, 5); }
    c.speed *= Math.pow(0.6, dt * 3);
    if (isPlayer) { if (hitV > 150) { hurt((hitV - 150) * 0.07); sfx.crash(); } }
    else if (c.type !== 'wreck' && ((c.spin > 0 && hitV > 120) || (c.knock > 0 && hitV > 170))) destroyCar(c);
  }
  // screen bounds
  if (c.x < c.hw) { c.x = c.hw; c.vx = Math.abs(c.vx) * 0.3; }
  if (c.x > W - c.hw) { c.x = W - c.hw; c.vx = -Math.abs(c.vx) * 0.3; }
  // --- water under bridges ---
  if (r.bridge && (c.x < L - 14 || c.x > R + 14)) {
    for (let i = 0; i < 16; i++) addParticle({ x: c.x, w: c.w, vx: rand(-120, 120), vw: rand(-120, 120) + camSpeed * 0.5, life: 0.7, max: 0.7, size: rand(3, 7), color: '#cfe8ff', kind: 'dot' });
    if (isPlayer) killPlayer('PLUNGED INTO THE RIVER'); else removeCar(c);
    return;
  }
  // --- trees / rocks / cacti ---
  for (const o of obstacles) {
    if (o.r === 0 || o.w < c.w - 80) continue;
    if (o.w > c.w + 80) break;
    const px = clamp(o.x, c.x - c.hw, c.x + c.hw), pw = clamp(o.w, c.w - c.hl, c.w + c.hl);
    const dx = o.x - px, dw = o.w - pw;
    if (dx * dx + dw * dw < o.r * o.r) {
      const front = o.w > c.w + c.hl * 0.55;
      const what = { tree: 'TREE', pine: 'TREE', snowpine: 'TREE', cactus: 'CACTUS', rock: 'ROCK' }[o.type];
      if (isPlayer) {
        if (c.inv > 0) continue;
        if (front && c.speed > 230) { killPlayer('CRASHED INTO A ' + what); return; }
        if (front) { c.w = o.w - o.r - c.hl - 1; hurt(18); c.speed = 0; sfx.crash(); }
        else { const s = Math.sign(c.x - o.x) || 1; c.x += s * 4; c.vx = s * 160; hurt(6); c.speed *= 0.8; sparks(px, pw, 4); sfx.crash(); }
      } else if (c.type !== 'wreck') {
        if ((front && c.speed > 150) || (c.knock > 0 && Math.abs(c.vx) > 120)) { destroyCar(c); return; }
        const s = Math.sign(c.x - o.x) || 1; c.x += s * 4; c.vx = s * 140;
      } else { c.speed = 0; }
    }
  }
  // --- craters ---
  for (const k of craters) {
    const dx = c.x - k.x, dw = c.w - k.w;
    if (dx * dx + dw * dw < (k.r * 0.72) ** 2) {
      if (isPlayer) { if (c.inv <= 0) { killPlayer('DROVE INTO A BOMB CRATER'); return; } }
      else if (c.type !== 'wreck') { destroyCar(c); return; }
    }
  }
  // --- oil slicks ---
  c.oilImmune = Math.max(0, (c.oilImmune || 0) - dt);
  if (c.spin <= 0 && c.oilImmune <= 0 && c.type !== 'wreck' && c.type !== 'supply') {
    for (const o of oils) {
      const dx = c.x - o.x, dw = c.w - o.w;
      if (dx * dx + dw * dw < o.r * o.r) {
        c.spin = isPlayer ? 0.9 : 1.6; c.spinDir = Math.random() < 0.5 ? -1 : 1;
        c.vx += rand(-220, 220); c.oilImmune = 2;
        sfx.tone(300, 0.4, 'sawtooth', 0.05, 150);
        break;
      }
    }
  }
  // --- smoke blinds enemies ---
  if (!isPlayer && c.type !== 'wreck' && c.type !== 'supply' && c.blind <= 0) {
    for (const s of smokes) {
      const dx = c.x - s.x, dw = c.w - s.w;
      if (dx * dx + dw * dw < s.r * s.r) {
        if (c.type === 'van') {         // blinded van loses control and spins out
          if (c.spin <= 0) { c.spin = 1.4; c.spinDir = Math.random() < 0.5 ? -1 : 1; c.vx += rand(-200, 200); }
        } else { c.blind = rand(1.3, 2); c.ai.bdir = Math.random() < 0.5 ? -1 : 1; }
        break;
      }
    }
  }
}

// =====================================================================
//  AI VEHICLES
// =====================================================================
const POINTS = { rammer: 150, puncture: 200, van: 300 };
const isEnemy = c => c.type === 'rammer' || c.type === 'puncture' || c.type === 'van';

function destroyCar(c) {
  if (c.type === 'wreck' || c.type === 'supply' || c.dead) return;   // supply truck is indestructible
  explode(c.x, c.w, c.type === 'van' || c.style === 'truck');
  if (isEnemy(c)) {
    killScore += POINTS[c.type];
    popup('+' + POINTS[c.type], c.x, sy(c.w), '#ffe066');
  } else if (c.type === 'civ' && c.killedByPlayer) {
    killScore -= 100;
    popup('CIVILIAN -100', c.x, sy(c.w), '#ff7a7a');
  }
  // wrecks are light debris with a smaller footprint, easy to shove aside
  c.prevType = c.type; c.type = 'wreck'; c.hp = 1e9; c.wreckT = 0; c.mass = 0.6; c.spin = 0;
  c.hw *= 0.85; c.hl *= 0.8;
  c.vx *= 0.3;
}
function removeCar(c) { c.dead = true; }

function moveAI(c, tx, ts, dt, keepOnRoad) {
  const r = roadAt(c.w);
  const L = r.cx - r.hw, R = r.cx + r.hw;
  if (keepOnRoad) tx = clamp(tx, L + c.hw + 4, R - c.hw - 4);
  const off = r.bridge ? 0 : offFactor(c, r);
  // Anything that changed vx since last frame (collisions, bombs, shoves) is "slip":
  // the car slides that way and the tyres slowly bleed it off.
  c.slip = c.vx - c.steerV;
  c.knock = Math.max(0, c.knock - dt);
  const slipGrip = (c.knock > 0 ? 0.9 : 3.5) * (1 - off * 0.6);
  c.slip *= Math.exp(-slipGrip * dt);
  // Steering: the car turns its nose at a limited rate, and sideways motion
  // comes only from heading x forward speed - no instant sideways jumps.
  const attack = c.ai.lunge > 0 || c.ai.push > 0;
  const maxH = attack ? (c.type === 'van' ? 0.4 : 0.6) : 0.42;
  const dvx = clamp((tx - c.x) * 2.2, -c.latMax * (attack ? 1.6 : 1), c.latMax * (attack ? 1.6 : 1));
  const want = Math.asin(clamp(dvx / Math.max(c.speed, 1), -Math.sin(maxH), Math.sin(maxH)));
  // a car can only change heading while rolling: turn rate scales with speed
  const tr = c.turnRate * clamp(c.speed / 160, 0, 1) * (attack ? 1.5 : 1) * (c.knock > 0 ? 0.35 : 1) * (1 - off * 0.5);
  c.heading += clamp(want - c.heading, -tr * dt, tr * dt);
  // engines pull hard at low speed and run out of breath near top speed
  const pull = clamp(1.15 - c.speed / c.maxSp, 0.15, 1);
  c.speed += clamp(ts - c.speed, -c.brake * dt, c.accel * pull * dt);
  if (off > 0.4 && c.speed > 200) c.speed -= 300 * dt;
  c.speed = clamp(c.speed, 0, c.maxSp);
  c.steerV = c.speed * Math.sin(c.heading);
  c.vx = c.steerV + c.slip;
  c.angle = lerp(c.angle, c.heading + clamp(c.slip / 700, -0.35, 0.35), Math.min(1, dt * 10));
}

function civAI(c, r, dt) {
  const n = laneCount(r.hw);
  if (c.lane >= n) c.lane = n - 1;
  const lx = laneX(r, c.lane, n);
  let blocked = false, bs = Infinity;
  for (const o of cars) {
    if (o === c) continue;
    const dw = o.w - c.w;
    if (dw > 0 && dw < 170 && Math.abs(o.x - lx) < 32) { blocked = true; bs = Math.min(bs, o.speed); }
  }
  if (!player.dead) { const dw = player.w - c.w; if (dw > 0 && dw < 150 && Math.abs(player.x - lx) < 32) { blocked = true; bs = Math.min(bs, player.speed); } }
  for (const k of craters) { const dw = k.w - c.w; if (dw > 0 && dw < 240 && Math.abs(k.x - lx) < k.r + 22) { blocked = true; bs = 0; } }
  c.ai.lcd -= dt;
  if (blocked && c.ai.lcd <= 0) {
    const opts = [c.lane - 1, c.lane + 1].filter(i => i >= 0 && i < n && laneFree(c, r, i, n));
    if (opts.length) { c.lane = pick(opts); c.ai.lcd = 1.2; blocked = false; }
  }
  return { tx: laneX(r, c.lane, n), ts: blocked ? Math.max(0, Math.min(c.cruise, bs - 15)) : c.cruise };
}

function updateCar(c, dt) {
  const p = player;
  c.age += dt; c.flash = Math.max(0, c.flash - dt); c.ai.cd -= dt;
  c.blind = Math.max(0, c.blind - dt);
  const r = roadAt(c.w);

  if (c.type === 'wreck') {
    c.speed = Math.max(0, c.speed - 300 * dt); c.vx *= Math.pow(0.15, dt);
    c.wreckT += dt;
    if (Math.random() < dt * 14) addParticle({ x: c.x + rand(-8, 8), w: c.w + rand(-10, 10), vx: rand(-10, 10), vw: rand(10, 40), life: 1.2, max: 1.2, size: rand(5, 9), grow: 16, color: c.wreckT < 4 ? '#3a3a3a' : '#555', kind: 'smoke' });
    if (c.wreckT < 3 && Math.random() < dt * 20) addParticle({ x: c.x + rand(-8, 8), w: c.w + rand(-12, 12), vx: 0, vw: rand(20, 60), life: 0.4, max: 0.4, size: rand(3, 6), color: pick(['#ffb02e', '#ff6a1f']), kind: 'fire' });
    c.w += c.speed * dt; c.x += c.vx * dt;
    carEnvironment(c, dt, false);
    return;
  }

  if (c.spin > 0) {
    c.spin -= dt; c.angle += c.spinDir * 10 * dt;
    c.speed = Math.max(0, c.speed - 320 * dt); c.vx *= Math.pow(0.6, dt);
    if (c.spin <= 0) {
      c.angle = Math.atan2(Math.sin(c.angle), Math.cos(c.angle)); c.heading = 0; c.steerV = 0;
      // vans are top-heavy: once they lose control they always crash
      if (isEnemy(c) && (c.type === 'van' || Math.random() < 0.55)) destroyCar(c);
    }
  } else {
    let tx = c.x, ts = c.cruise, keep = true;
    const pAlive = !p.dead && !p.inTruck;   // enemies lose you while you hide in the truck
    const dw = p.w - c.w;               // >0 : player is ahead of this car
    switch (c.type) {
      case 'civ': ({ tx, ts } = civAI(c, r, dt)); break;

      case 'supply': {
        const n = laneCount(r.hw); if (c.lane >= n) c.lane = n - 1;
        const laneXc = laneX(r, c.lane, n);
        const gap = c.w - p.w;                       // > 0 : you are behind the truck
        const st = c.ai.state;
        c.ai.msgT -= dt;
        if (st === 'cruise') {
          ({ tx, ts } = civAI(c, r, dt)); ts = c.cruise;
          c.ai.ramp = Math.max(0, c.ai.ramp - dt * 1.5);
          if (pAlive && gap > 0 && gap < 520) c.ai.state = 'wait';
        } else if (st === 'wait') {                  // slows down, lowers the ramp, holds its lane dead straight
          tx = laneXc; ts = 250;
          c.ai.ramp = Math.min(1, c.ai.ramp + dt * 1.5);
          if (!pAlive || gap < -40 || gap > 800) c.ai.state = 'cruise';
        } else if (st === 'load' || st === 'board') { // you're inside: steady drive
          tx = laneXc; ts = 330;
          c.ai.ramp = st === 'board' ? 1 : Math.max(0, c.ai.ramp - dt * 2);
        } else if (st === 'unload') {
          tx = laneXc; ts = 330; c.ai.ramp = Math.min(1, c.ai.ramp + dt * 3);
        } else {                                      // leave: back on its route
          ({ tx } = civAI(c, r, dt));
          ts = Math.min(560, Math.max(c.ai.leaveSp || 0, 380)); c.ai.leaveSp = ts;
          c.ai.ramp = Math.max(0, c.ai.ramp - dt * 1.5);
        }
        break;
      }

      case 'rammer': {
        // Real-world tailgater: catches up gradually, sits on your bumper mirroring
        // your lane, flashes its lights, then accelerates into your rear (a bump,
        // not a rocket). Off-centre bumps swing your tail out (PIT manoeuvre).
        if (!pAlive) { ts = p.speed + 50; break; }
        const TAIL = p.hl + c.hl + 40;          // tailgating distance, centre to centre
        if (c.ai.wait === undefined) c.ai.wait = rand(1.2, 2.6);
        if (dw <= -20) {          // ended up ahead of you: ease off and drop back
          tx = c.x + (c.x < p.x ? -50 : 50); ts = p.speed - 110; c.ai.phase = 'stalk'; c.ai.t = 0;
        } else if (c.ai.cd > 0) { // just bumped you: back off a little, pick a new line
          tx = p.x + (c.ai.offset || 0); ts = p.speed - 60; c.ai.phase = 'stalk'; c.ai.t = 0;
        } else if (c.ai.phase === 'stalk') {    // close the gap and tailgate
          tx = p.x + Math.sin(time * 1.1 + c.age) * 8;
          ts = p.speed + clamp((dw - TAIL) * 1.3, -150, 150);
          if (Math.abs(dw - TAIL) < 30 && Math.abs(c.x - p.x) < 30) c.ai.t += dt;
          if (c.ai.t > c.ai.wait) {
            c.ai.phase = 'warn'; c.ai.t = 0; c.ai.pit = rand(-14, 14);
            sfx.tone(380, 0.35, 'sawtooth', 0.06, 360);
          }
        } else if (c.ai.phase === 'warn') {     // flashes high beams for ~0.7s
          tx = p.x; ts = p.speed + clamp((dw - TAIL) * 1.3, -150, 150);
          c.ai.t += dt;
          if (c.ai.t > 0.7) { c.ai.phase = 'charge'; c.ai.t = 0; }
        } else {                                // bump: aims at a rear corner, closes ~40 km/h faster
          tx = p.x + c.ai.pit; ts = p.speed + 130; c.ai.t += dt;
          if (c.ai.t > 2.2) { c.ai.phase = 'stalk'; c.ai.t = 0; c.ai.wait = rand(1.2, 2.6); }
        }
        break;
      }

      case 'puncture': { // matches the player side-by-side, then lunges with spiked wheels
        if (!pAlive) { ts = p.speed; break; }
        const gap = p.hw + c.hw + 26;
        let want = p.x + c.ai.side * gap;
        if (want < r.cx - r.hw + c.hw + 4 || want > r.cx + r.hw - c.hw - 4) { c.ai.side *= -1; want = p.x + c.ai.side * gap; }
        tx = want;
        ts = p.speed + clamp(dw * 3, -320, 320);
        const aligned = Math.abs(dw) < 24 && Math.abs(c.x - want) < 45;
        c.ai.align = aligned ? c.ai.align + dt : Math.max(0, c.ai.align - dt * 2);
        if (c.ai.align > 0.5 && c.ai.cd <= 0 && c.ai.lunge <= 0) { c.ai.lunge = 0.5; c.ai.cd = 2.4; }
        if (c.ai.lunge > 0) { c.ai.lunge -= dt; tx = p.x; ts = p.speed + dw * 3; }
        break;
      }

      case 'van': { // pulls alongside and shoves the player off the road
        if (!pAlive) { ts = p.speed; break; }
        const gap = p.hw + c.hw + 8;
        let want = p.x + c.ai.side * gap;
        if (want < r.cx - r.hw + c.hw + 4 || want > r.cx + r.hw - c.hw - 4) { c.ai.side *= -1; want = p.x + c.ai.side * gap; }
        ts = p.speed + clamp((dw + 8) * 2.5, -300, 300);
        tx = want;
        if (Math.abs(dw) < 40 && Math.abs(c.x - want) < 40 && c.ai.cd <= 0 && c.speed > 120) { c.ai.push = 1.3; c.ai.cd = 2.6; }
        if (c.ai.push > 0) { c.ai.push -= dt; tx = p.x - c.ai.side * 40; keep = false; }
        break;
      }
    }
    if (c.blind > 0) { tx = c.x + c.ai.bdir * 160; ts = c.speed - 40; keep = false; c.ai.lunge = 0; c.ai.push = 0; }
    moveAI(c, tx, ts, dt, keep);
  }
  c.w += c.speed * dt; c.x += c.vx * dt;
  carEnvironment(c, dt, false);
}

// ---------- collisions ----------
function resolve(a, b) {
  const dx = b.x - a.x, dw = b.w - a.w;
  const ox = a.hw + b.hw - Math.abs(dx), ow = a.hl + b.hl - Math.abs(dw);
  if (ox <= 0 || ow <= 0) return null;
  const ma = a.mass, mb = b.mass, tot = ma + mb, e = 0.35;
  if (ox < ow * 0.8) {
    const n = Math.sign(dx) || 1;
    a.x -= n * ox * mb / tot; b.x += n * ox * ma / tot;
    const vrel = (a.vx - b.vx) * n;
    if (vrel > 0) { const j = (1 + e) * vrel / (1 / ma + 1 / mb); a.vx -= j / ma * n; b.vx += j / mb * n; }
    return { axis: 'x', impact: Math.max(0, vrel), n };
  } else {
    const n = Math.sign(dw) || 1;
    a.w -= n * ow * mb / tot; b.w += n * ow * ma / tot;
    const vrel = (a.speed - b.speed) * n;
    if (vrel > 0) { const j = (1 + e) * vrel / (1 / ma + 1 / mb); a.speed -= j / ma * n; b.speed += j / mb * n; }
    return { axis: 'w', impact: Math.max(0, vrel), n };
  }
}
function aiImpactDamage(c, impact) {
  if (c.type === 'wreck' || c.type === 'supply') return;
  if (impact > 200) {
    c.hp -= (impact - 200) * 0.02;
    if (c.hp <= 0) destroyCar(c);
    else if (impact > 320 && c.type === 'civ') { c.spin = 0.8; c.spinDir = Math.random() < 0.5 ? -1 : 1; }
  }
}

function collisions(dt) {
  const p = player;
  // AI vs AI
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i]; if (a.dead) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j]; if (b.dead) continue;
      if (Math.abs(a.w - b.w) > 100) continue;
      const res = resolve(a, b);
      if (res && res.impact > 60) {
        aiImpactDamage(a, res.impact); aiImpactDamage(b, res.impact);
        if (res.impact > 150) sparks((a.x + b.x) / 2, (a.w + b.w) / 2, 4);
      }
    }
  }
  if (p.dead || p.inv > 0 || p.inTruck) return;
  for (const c of cars) {
    if (c.dead) continue;
    const dx = c.x - p.x, dw = c.w - p.w;
    if (Math.abs(dx) >= p.hw + c.hw || Math.abs(dw) >= p.hl + c.hl) continue;

    // supply truck: with its ramp down, drive straight in from behind - lined up and not too fast.
    // Miss the line or come in hot and it's just a 4-tonne truck you crashed into.
    if (c.type === 'supply' && c.ai.state === 'wait' && c.ai.ramp > 0.9 && dw > c.hl * 0.6) {
      const closing = p.speed - c.speed;
      const aligned = Math.abs(dx) < SUPPLY_ALIGN && Math.abs(p.angle) < 0.15 && p.spin <= 0;
      if (aligned && closing < SUPPLY_MAX_CLOSE) {
        p.inTruck = { truck: c, t: 0, phase: 'in', rel0: p.w - c.w, x0: p.x, a0: p.angle };
        c.ai.state = 'board';
        popup('LOADING...', c.x, sy(c.w) + c.hl + 30, '#9fe8ff');
        sfx.tone(220, 0.25, 'triangle', 0.1, 330);
        continue;
      }
      if (c.ai.msgT <= 0) {
        c.ai.msgT = 1.2;
        popup(closing >= SUPPLY_MAX_CLOSE ? 'TOO FAST!' : 'NOT LINED UP!', p.x, sy(p.w) - 40, '#ff8a6a');
      }
    }
    // puncture car: perfectly side by side = slashed tyres
    if (c.type === 'puncture' && c.spin <= 0 && Math.abs(dw) < 30 && c.blind <= 0) {
      sparks(p.x, p.w, 14, '#ffffff');
      killPlayer('TYRES SLASHED!');
      return;
    }
    const pvx = p.vx, pspd = p.speed, cvx = c.vx;
    const res = resolve(p, c);
    if (!res) continue;
    const imp = res.impact;

    // Wreck debris is light: you bulldoze it out of the way instead of getting stuck
    if (c.type === 'wreck') {
      const away = Math.sign(c.x - p.x) || (Math.random() < 0.5 ? -1 : 1);
      if (dw > 0) c.speed = Math.max(c.speed, pspd + 70);
      c.vx += away * (90 + pspd * 0.3) * dt * 8;
      p.speed = Math.max(p.speed, pspd * 0.93);
      p.vx = pvx;
      if (imp > 220) { hurt((imp - 220) * 0.015); sparks((p.x + c.x) / 2, (p.w + c.w) / 2, 4); sfx.hit(); }
      continue;
    }

    // Everything below is momentum-based: resolve() already exchanged velocity by
    // mass (player 1.2, car 1, rammer 1.5, spike car 2.6, van 3.2, truck 2.6, supply 4).
    // Here we only add the consequences: lost grip (sliding), spins, damage.
    const n = res.n;                                // +1 = other car is to your right / ahead
    if (res.axis === 'x') {
      if (c.type === 'van') {                       // heavy van follows through with its weight
        const itsRam = Math.max(0, -cvx * n), myRam = Math.max(0, pvx * n);
        if (itsRam > myRam) p.vx -= n * itsRam * 0.45;
        else c.vx += n * myRam * 0.25;
      }
      const dP = Math.abs(p.vx - pvx), dC = Math.abs(c.vx - cvx);
      if (dP > 40) p.knock = Math.max(p.knock, Math.min(0.9, dP / 350));
      if (dC > 40 && c.type !== 'supply') c.knock = Math.max(c.knock, Math.min(1, dC / 300));
      if (dC > 260 && c.type === 'civ' && c.style !== 'truck') { c.spin = 0.6; c.spinDir = n; }
      if (imp > 80) {
        hurt((imp - 80) * (c.type === 'van' ? 0.05 : 0.025));
        shake = Math.max(shake, Math.min(8, imp / 40)); sfx.crash();
      }
    } else if (dw < 0) {                            // something hit you from behind
      if (c.type === 'rammer') {
        const off = p.x - c.x;                      // off-centre hits swing your tail (PIT)
        p.vx += off * imp * 0.012;
        p.knock = Math.max(p.knock, 0.25 + imp / 700);
        if (imp > 150 && Math.abs(off) > 12) { p.spin = 0.4; p.spinDir = Math.sign(off); }
        hurt(3 + imp * 0.05);
        c.ai.cd = 1.6; c.ai.offset = rand(-50, 50);
        shake = Math.max(shake, Math.min(9, 3 + imp / 40)); sfx.crash();
      } else if (imp > 100) { hurt((imp - 100) * 0.04); sfx.crash(); }
    } else {                                        // you rear-ended it
      if (imp > 60 && c.type !== 'supply') {
        const off = c.x - p.x;
        c.vx += off * imp * 0.012; c.knock = Math.max(c.knock, Math.min(0.8, imp / 400));
        if (imp > 300 && Math.abs(off) > 12 && c.type === 'civ') { c.spin = 0.6; c.spinDir = Math.sign(off); }
      }
      if (imp > 100) { hurt((imp - 100) * (c.type === 'van' ? 0.06 : 0.04)); sfx.crash(); }
    }
    if (imp > 150) sparks((p.x + c.x) / 2, (p.w + c.w) / 2, 6);
    if (isEnemy(c) || c.type === 'civ') aiImpactDamage(c, imp);
  }
}

// =====================================================================
//  HELICOPTER, BOMBS, PROJECTILES
// =====================================================================
function updateHeli(dt) {
  const h = heli;
  if (!h) return;
  const p = player;
  h.t += dt; h.rotor += dt * 30;
  h.rotorT -= dt;
  if (h.rotorT <= 0 && h.state !== 'falling') { h.rotorT = 0.11; sfx.rotor(); }
  const hoverOff = H - 150;
  if (h.state === 'enter') {
    h.off = lerp(h.off, hoverOff, Math.min(1, dt * 1.5));
    if (Math.abs(h.off - hoverOff) < 10) { h.state = 'hover'; h.t = 0; }
  } else if (h.state === 'hover') {
    h.off = hoverOff + Math.sin(h.t * 0.9) * 25;
    if (h.t > 60) { h.state = 'leave'; showBanner('THE HELICOPTER IS LEAVING', '', '#9fd3ff', 1.8); }
    h.bombCD -= dt;
    if (h.bombCD <= 0 && !p.dead && !p.inTruck) {
      const dm = p.w / PXM;
      h.bombCD = rand(2.0, 3.4) * clamp(1.15 - dm / 20000, 0.6, 1);
      const lead = p.speed * rand(0.7, 1.25) + rand(40, 160);
      const tw = p.w + lead, rr = roadAt(tw);
      const tx = clamp(p.x + rand(-55, 55), rr.cx - rr.hw + 20, rr.cx + rr.hw - 20);
      bombs.push({ x0: h.x, w0: h.w, x: tx, w: tw, t: 0, T: 1.35 });
      sfx.whistle();
    }
  } else if (h.state === 'leave') {
    h.off += 260 * dt;
    if (h.off > H + 200) heli = null;
  } else if (h.state === 'falling') {
    h.fallT += dt; h.ang += dt * 7; h.off -= 120 * dt; h.x += Math.sin(h.fallT * 5) * 60 * dt;
    if (Math.random() < dt * 40) addParticle({ x: h.x, w: h.w, vx: rand(-20, 20), vw: rand(0, 40) + camSpeed * 0.5, life: 1, max: 1, size: rand(6, 12), grow: 20, color: '#333', kind: 'smoke' });
    if (h.fallT > 1.6) {
      explode(h.x, h.w, true); explode(h.x + 20, h.w - 20, false);
      craters.push({ x: h.x, w: h.w, r: 38, t: 0 });
      heli = null; return;
    }
  }
  if (h.state !== 'falling') {
    const tx = p.dead ? W / 2 : p.x + Math.sin(h.t * 0.7) * 60;
    h.x = lerp(h.x, tx, Math.min(1, dt * 0.9));
  }
  if (heli) h.w = camD + h.off;
}

function updateBombs(dt) {
  for (const b of bombs) {
    b.t += dt;
    if (b.t >= b.T) {
      b.done = true;
      explode(b.x, b.w, true);
      craters.push({ x: b.x, w: b.w, r: 34, t: 0 });
      const p = player;
      if (!p.dead && p.inv <= 0 && !p.inTruck) {
        const d = Math.hypot(p.x - b.x, p.w - b.w);
        if (d < 40) killPlayer('DIRECT HIT FROM A BOMB');
        else if (d < 95) { hurt(30 * (1 - (d - 40) / 55) + 5); p.vx += Math.sign(p.x - b.x) * 220; p.knock = 0.4; }
      }
      for (const c of cars) {
        const d = Math.hypot(c.x - b.x, c.w - b.w);
        if (d < 70) destroyCar(c);
        else if (d < 110) c.vx += Math.sign(c.x - b.x) * 200;
      }
    }
  }
  bombs = bombs.filter(b => !b.done);
}

function updateProjectiles(dt) {
  for (const b of bullets) {
    b.life -= dt; b.x += b.vx * dt; b.w += b.vw * dt;
    for (const c of cars) {
      if (c.dead) continue;
      if (Math.abs(b.x - c.x) < c.hw && Math.abs(b.w - c.w) < c.hl) {
        b.life = 0;
        if (c.type === 'supply' || c.type === 'van') {   // armoured: bullets ricochet
          sparks(b.x, b.w, 3, '#ffffff');
          if (c.type === 'van' && Math.random() < 0.3) sfx.tone(2400, 0.04, 'triangle', 0.03, 1800);
          break;
        }
        if (c.type === 'wreck') break;
        c.hp -= 1; c.flash = 0.06; sparks(b.x, b.w, 3);
        sfx.hit();
        if (c.hp <= 0) { c.killedByPlayer = true; destroyCar(c); }
        break;
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0);

  for (const r of rockets) {
    r.life -= dt;
    const t = r.target && heli === r.target && heli.state !== 'falling' ? heli : null;
    if (t) {
      const dx = t.x - r.x, dw = t.w - r.w, d = Math.hypot(dx, dw) || 1;
      const dvx = dx / d * 780, dvw = dw / d * 780 + camSpeed;
      r.vx += (dvx - r.vx) * Math.min(1, dt * 7); r.vw += (dvw - r.vw) * Math.min(1, dt * 7);
      if (d < 36) {
        r.life = 0;
        t.state = 'falling'; t.fallT = 0;
        killScore += 1000; popup('HELICOPTER DOWN! +1000', t.x, sy(t.w) + 40, '#ffe066');
        explode(t.x, t.w, false); sfx.boom(true);
      }
    } else {
      for (const c of cars) {
        if (c.dead || c.type === 'wreck' || c.type === 'supply') continue;
        if (Math.abs(r.x - c.x) < c.hw + 4 && Math.abs(r.w - c.w) < c.hl) { r.life = 0; break; }
      }
      if (r.life <= 0) {
        explode(r.x, r.w, true);
        for (const c of cars) {
          const d = Math.hypot(c.x - r.x, c.w - r.w);
          if (d < 85 && c.type !== 'supply' && c.type !== 'wreck') { c.hp -= d < 50 ? 20 : 10; if (c.hp <= 0) { c.killedByPlayer = true; destroyCar(c); } }
        }
      }
    }
    r.x += r.vx * dt; r.w += r.vw * dt;
    r.trailT -= dt;
    if (r.trailT <= 0) { r.trailT = 0.015; addParticle({ x: r.x, w: r.w - 8, vx: rand(-15, 15), vw: rand(-15, 15), life: 0.5, max: 0.5, size: rand(3, 5), grow: 10, color: '#cfcfcf', kind: 'smoke' }); }
  }
  rockets = rockets.filter(r => r.life > 0);
}

// =====================================================================
//  DIRECTOR (spawns & difficulty)
// =====================================================================
function director(dt) {
  const p = player;
  const dm = p.w / PXM;
  const diff = Math.min(1, dm / 9000);
  civT -= dt;
  if (civT <= 0) {
    civT = lerp(1.25, 0.85, diff) * rand(0.6, 1.4);
    if (cars.filter(c => c.type === 'civ').length < 8) spawnCiv();
  }
  enemyT -= dt;
  if (enemyT <= 0 && dm > 150 && !p.dead) {
    // never more than 3 attackers at once during the first two trips through all
    // the biomes (28.8 km); after that up to 4
    const loop = Math.floor(p.w / (BIOME_LEN * NB));
    const max = Math.min(loop < 2 ? 3 : 4, 1 + Math.floor(diff * 3.6));
    if (cars.filter(isEnemy).length < max) spawnEnemy(dm);
    enemyT = lerp(7, 2.6, diff) * rand(0.7, 1.3);
  }
  if (dm > nextSupplyM && !p.dead) {
    spawnSupply(pick(['oil', 'oil', 'smoke', 'smoke', 'rockets']));
    nextSupplyM = dm + rand(900, 1500);
  }
  if (!heli && !heliSupplySent && dm > nextHeliM - 380) {
    spawnSupply('rockets'); heliSupplySent = true;
    nextSupplyM = Math.max(nextSupplyM, dm + 700);
  }
  if (!heli && dm > nextHeliM) {
    spawnHeli(); nextHeliM = dm + rand(2600, 3600); heliSupplySent = false;
  }
}

// =====================================================================
//  UPDATE
// =====================================================================
function update(dt) {
  time += dt;
  const p = player;
  updatePlayer(dt);

  const prevCam = camD;
  const target = p.w - 260 + p.speed * 0.16;
  camD += p.speed * dt;
  camD += (target - camD) * Math.min(1, dt * 2.5);
  camSpeed = (camD - prevCam) / dt;

  ensureGen();
  director(dt);

  for (const c of cars) if (!c.dead) updateCar(c, dt);
  collisions(dt);
  trackVehicleFx(p, dt, true);
  for (const c of cars) trackVehicleFx(c, dt, false);
  pruneSkids();
  updateHeli(dt);
  updateBombs(dt);
  updateProjectiles(dt);

  for (const o of oils) o.life -= dt;
  oils = oils.filter(o => o.life > 0 && o.w > camD - 100);
  for (const s of smokes) { s.life -= dt; s.r += 14 * dt; s.x += s.vx * dt; }
  smokes = smokes.filter(s => s.life > 0);
  for (const k of craters) k.t += dt;
  craters = craters.filter(k => k.w > camD - 100);
  for (const q of particles) {
    q.life -= dt; q.x += q.vx * dt; q.w += q.vw * dt; q.size += q.grow * dt;
    q.vx *= Math.pow(0.15, dt); q.vw = lerp(q.vw, 0, Math.min(1, dt * 1.5));
  }
  particles = particles.filter(q => q.life > 0);
  if (particles.length > 900) particles.splice(0, particles.length - 900);
  for (const q of popups) { q.life -= dt; q.y -= 40 * dt; }
  popups = popups.filter(q => q.life > 0);

  // despawn vehicles far away
  for (const c of cars) {
    const back = c.type === 'rammer' ? 800 : 350;
    if ((c.w < camD - back || c.w > camD + H + 1200) && !(p.inTruck && p.inTruck.truck === c)) c.dead = true;
  }
  cars = cars.filter(c => !c.dead);

  // biome / fog banners
  const b = biomeAt(p.w);
  if (b !== curBiome) { curBiome = b; showBanner(BIOMES[b].name, 'Entering a new region', '#e8f4ff'); }
  const fz = fogZones.find(z => p.w > z.start - 3500 && p.w < z.start);
  if (fz && fogWarned !== fz.start) { fogWarned = fz.start; showBanner('FOG AHEAD', 'Slow down - watch for tail lights', '#cfd8e3', 3); }
  fogLevel = fogAt(p.w + 200);

  if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  shake = Math.max(0, shake - dt * 30);
  hurtFlash = Math.max(0, hurtFlash - dt);
  score = Math.floor(p.w / PXM) + killScore;
  sfx.drive({ speed: p.speed, on: !p.dead, muffled: !!p.inTruck, throttle: down('ArrowUp', 'KeyW') && !p.inTruck,
    skid: p.spin > 0 || p.knock > 0.2 || (p.braking && p.speed > 260) ? 1 : 0, off: p.off > 0.2 ? p.off : 0 });
}

// =====================================================================
//  RENDER
// =====================================================================
const rgbStr = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function drawRoad() {
  for (let y = 0; y < H; y += STRIP) {
    const w = camD + (H - y) - STRIP * 0.5;
    const r = roadAt(w), B = BIOMES[biomeAt(w)];
    const L = r.cx - r.hw, R = r.cx + r.hw;
    const band = Math.floor(w / 70) % 2 === 0 ? 1 : 0.955;
    if (r.bridge) {
      const wc = B.water, wv = 0.92 + 0.08 * Math.sin(w * 0.05 + time * 2);
      ctx.fillStyle = rgbStr([wc[0] * wv, wc[1] * wv, wc[2] * wv]);
      ctx.fillRect(0, y, W, STRIP);
      ctx.fillStyle = '#3d3a36'; ctx.fillRect(L - 16, y, R - L + 32, STRIP);
    } else {
      const g = groundRGB(w);
      ctx.fillStyle = rgbStr([g[0] * band, g[1] * band, g[2] * band]);
      ctx.fillRect(0, y, W, STRIP);
      ctx.fillStyle = B.shoulder; ctx.fillRect(L - 11, y, R - L + 22, STRIP);
    }
    ctx.fillStyle = B.road; ctx.fillRect(L, y, R - L, STRIP);
    // edge lines
    ctx.fillStyle = '#e4e2d6'; ctx.fillRect(L + 4, y, 3, STRIP); ctx.fillRect(R - 7, y, 3, STRIP);
    // lane dashes
    if (((w % 90) + 90) % 90 < 46) {
      const n = laneCount(r.hw), lw = (R - L) / n;
      ctx.fillStyle = '#f1efe4';
      for (let k = 1; k < n; k++) ctx.fillRect(L + k * lw - 1.5, y, 3, STRIP);
    }
    // walls / rails
    if (r.wallL || r.wallR) {
      const post = ((w % 40) + 40) % 40 < 6;
      if (r.bridge) {
        ctx.fillStyle = post ? '#5d6670' : '#a9b4bf';
        if (r.wallL) ctx.fillRect(L - 10, y, 7, STRIP);
        if (r.wallR) ctx.fillRect(R + 3, y, 7, STRIP);
      } else {
        ctx.fillStyle = post ? '#8e8e8e' : '#c8c8c4';
        if (r.wallL) ctx.fillRect(L - 10, y, 8, STRIP);
        if (r.wallR) ctx.fillRect(R + 2, y, 8, STRIP);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        if (r.wallL) ctx.fillRect(L - 2, y, 2, STRIP);
        if (r.wallR) ctx.fillRect(R + 2, y, 2, STRIP);
      }
    }
  }
}

function drawDecor() {
  for (const d of decor) {
    const y = sy(d.w); if (y < -10 || y > H + 10) continue;
    switch (d.type) {
      case 'grass':
        ctx.strokeStyle = 'rgba(40,90,30,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(d.x, y); ctx.lineTo(d.x - 3, y - 6); ctx.moveTo(d.x, y); ctx.lineTo(d.x + 3, y - 6); ctx.moveTo(d.x, y); ctx.lineTo(d.x, y - 7); ctx.stroke();
        if (d.seed > 0.85) { ctx.fillStyle = d.seed > 0.93 ? '#ffe45c' : '#f6f6f6'; ctx.beginPath(); ctx.arc(d.x + 4, y - 3, 2, 0, 7); ctx.fill(); }
        break;
      case 'sand':
        ctx.fillStyle = 'rgba(150,110,60,0.35)'; ctx.beginPath(); ctx.ellipse(d.x, y, 6 + d.seed * 8, 2, 0, 0, 7); ctx.fill(); break;
      case 'leaf':
        ctx.fillStyle = d.seed > 0.5 ? 'rgba(120,80,30,0.6)' : 'rgba(25,60,28,0.7)'; ctx.beginPath(); ctx.arc(d.x, y, 2.5 + d.seed * 2, 0, 7); ctx.fill(); break;
      case 'snow':
        ctx.fillStyle = 'rgba(160,180,205,0.45)'; ctx.beginPath(); ctx.ellipse(d.x, y, 8 + d.seed * 6, 3, 0, 0, 7); ctx.fill(); break;
      case 'patch':
        ctx.fillStyle = 'rgba(0,0,0,0.13)'; rr(d.x - 10 - d.seed * 10, y - 8, 20 + d.seed * 20, 16 + d.seed * 10, 3); ctx.fill(); break;
      case 'stain':
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(d.x, y, 7 + d.seed * 6, 10 + d.seed * 8, 0, 0, 7); ctx.fill(); break;
      case 'crack': {
        ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(d.x, y);
        let cx = d.x, cy = y;
        for (let k = 0; k < 4; k++) { cx += ((d.seed * 7919 * (k + 1)) % 1 - 0.5) * 16; cy -= 6 + k * 2; ctx.lineTo(cx, cy); }
        ctx.stroke(); break;
      }
    }
  }
}

function drawObstacles() {
  for (const o of obstacles) {
    const y = sy(o.w); if (y < -60 || y > H + 60) continue;
    const x = o.x, s = o.seed;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x + 7, y + 8, (o.r || 10) * 1.1, (o.r || 10) * 0.9, 0, 0, 7); ctx.fill();
    switch (o.type) {
      case 'tree':
        ctx.fillStyle = '#5a3b1e'; ctx.fillRect(x - 3, y - 2, 6, 8);
        ctx.fillStyle = '#2f7a2e'; ctx.beginPath(); ctx.arc(x, y, o.r, 0, 7); ctx.fill();
        ctx.fillStyle = '#3f9a3a'; ctx.beginPath(); ctx.arc(x - 5, y - 5, o.r * 0.6, 0, 7); ctx.fill();
        ctx.fillStyle = '#58b84d'; ctx.beginPath(); ctx.arc(x - 7, y - 8, o.r * 0.3, 0, 7); ctx.fill();
        break;
      case 'bush':
        ctx.fillStyle = '#3d8a35'; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.arc(x + 7, y + 2, 6, 0, 7); ctx.fill(); break;
      case 'pine': case 'snowpine': {
        const snow = o.type === 'snowpine';
        for (let k = 0; k < 3; k++) {
          const rad = o.r * (1 - k * 0.28);
          ctx.fillStyle = snow ? ['#2c5a3c', '#3a6d4b', '#e9f0f5'][k] : ['#1d4d26', '#276332', '#357a3f'][k];
          ctx.beginPath();
          for (let a = 0; a < 8; a++) {
            const ang = a / 8 * Math.PI * 2 + s * 3, rr2 = a % 2 ? rad * 0.7 : rad;
            ctx.lineTo(x + Math.cos(ang) * rr2, y + Math.sin(ang) * rr2 - k * 2);
          }
          ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'cactus':
        ctx.fillStyle = '#3f8a42'; rr(x - 5, y - 14, 10, 28, 5); ctx.fill();
        rr(x - 14, y - 6, 9, 6, 3); ctx.fill(); rr(x - 14, y - 13, 5, 10, 3); ctx.fill();
        rr(x + 5, y - 2, 9, 6, 3); ctx.fill(); rr(x + 9, y - 10, 5, 12, 3); ctx.fill();
        ctx.fillStyle = '#58a85a'; ctx.fillRect(x - 1, y - 12, 2, 24); break;
      case 'rock':
        ctx.fillStyle = '#7d7a75'; ctx.beginPath();
        for (let a = 0; a < 7; a++) { const ang = a / 7 * Math.PI * 2 + s * 2, rad = o.r * (0.8 + ((s * 97 * (a + 1)) % 1) * 0.35); ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#a19e98'; ctx.beginPath(); ctx.arc(x - 3, y - 3, o.r * 0.45, 0, 7); ctx.fill();
        break;
    }
  }
}

function drawBombs() {
  for (const b of bombs) {
    const t = b.t / b.T;
    const ty = sy(b.w);
    // growing shadow / target marker
    ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.35 * t})`;
    ctx.beginPath(); ctx.ellipse(b.x, ty, 6 + 18 * t, 4 + 12 * t, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(255,40,40,${0.5 + 0.5 * Math.sin(time * 20)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, ty, 30, 0, 7); ctx.stroke();
    // bomb falling from helicopter towards target
    const bx = lerp(b.x0, b.x, t), bw = lerp(b.w0, b.w, t);
    const by = sy(bw) - Math.sin(t * Math.PI) * 30, s = 1.6 - t * 0.6;
    ctx.save(); ctx.translate(bx, by); ctx.scale(s, s);
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#555'; ctx.fillRect(-5, -12, 10, 3);
    ctx.restore();
  }
}

function drawCraters() {
  for (const k of craters) {
    const y = sy(k.w); if (y < -60 || y > H + 60) continue;
    ctx.fillStyle = '#5a4a3a'; ctx.beginPath(); ctx.arc(k.x, y, k.r + 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#1e1813'; ctx.beginPath(); ctx.arc(k.x, y, k.r, 0, 7); ctx.fill();
    ctx.fillStyle = '#0c0a08'; ctx.beginPath(); ctx.arc(k.x + 3, y + 3, k.r * 0.6, 0, 7); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + k.x;
      ctx.fillStyle = '#6e5b47'; ctx.beginPath(); ctx.arc(k.x + Math.cos(a) * (k.r + 8), y + Math.sin(a) * (k.r + 8), 4, 0, 7); ctx.fill();
    }
    const glow = 0.4 + 0.25 * Math.sin(time * 5 + k.x);
    ctx.fillStyle = `rgba(255,110,30,${glow})`; ctx.beginPath(); ctx.arc(k.x, y, k.r * 0.35, 0, 7); ctx.fill();
  }
}

function drawOils() {
  for (const o of oils) {
    const y = sy(o.w); if (y < -50 || y > H + 50) continue;
    const a = Math.min(1, o.life / 2);
    ctx.fillStyle = `rgba(8,8,12,${0.85 * a})`;
    ctx.beginPath(); ctx.ellipse(o.x, y, o.r, o.r * 0.8, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(o.x + 14, y + 10, o.r * 0.5, o.r * 0.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(90,60,160,${0.35 * a})`; ctx.beginPath(); ctx.ellipse(o.x - 6, y - 6, o.r * 0.4, o.r * 0.2, -0.5, 0, 7); ctx.fill();
  }
}

function drawSmokes() {
  for (const s of smokes) {
    const y = sy(s.w); if (y < -80 || y > H + 80) continue;
    const a = Math.min(1, s.life / s.max * 1.4) * 0.75;
    ctx.fillStyle = `rgba(215,215,220,${a})`; ctx.beginPath(); ctx.arc(s.x, y, s.r, 0, 7); ctx.fill();
  }
}

function drawParticles() {
  for (const q of particles) {
    const y = sy(q.w); if (y < -40 || y > H + 40) continue;
    const a = clamp(q.life / q.max, 0, 1);
    if (q.kind === 'ring') {
      ctx.globalAlpha = a * 0.6; ctx.strokeStyle = q.color; ctx.lineWidth = 2 + 5 * a;
      ctx.beginPath(); ctx.arc(q.x, y, q.size, 0, 7); ctx.stroke(); continue;
    }
    if (q.kind === 'flash') {
      ctx.globalAlpha = 1; glow(q.x, y, q.size * (1.4 - a * 0.4), '255,240,190', a); continue;
    }
    ctx.globalAlpha = q.kind === 'smoke' ? a * 0.5 : a;
    ctx.fillStyle = q.color;
    if (q.kind === 'debris' || q.kind === 'spark') ctx.fillRect(q.x - q.size / 2, y - q.size / 2, q.size, q.size);
    else { ctx.beginPath(); ctx.arc(q.x, y, q.size, 0, 7); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

function drawProjectiles() {
  ctx.fillStyle = '#ffe680';
  for (const b of bullets) { const y = sy(b.w); ctx.fillRect(b.x - 1.5, y - 6, 3, 10); }
  for (const r of rockets) {
    const y = sy(r.w), a = Math.atan2(r.vx, r.vw - camSpeed * 0.5);
    ctx.save(); ctx.translate(r.x, y); ctx.rotate(a);
    ctx.fillStyle = '#ddd'; ctx.fillRect(-2.5, -9, 5, 16);
    ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.moveTo(-2.5, -9); ctx.lineTo(0, -14); ctx.lineTo(2.5, -9); ctx.fill();
    ctx.fillStyle = '#ffb030'; ctx.beginPath(); ctx.arc(0, 9, 3 + Math.random() * 2, 0, 7); ctx.fill();
    ctx.restore();
  }
}

// ---------- fog & lights ----------
const fogCv = document.createElement('canvas'); fogCv.width = W; fogCv.height = H;
const fctx = fogCv.getContext('2d');

function drawFog(f) {
  if (f <= 0.01) return;
  fctx.globalCompositeOperation = 'source-over';
  fctx.clearRect(0, 0, W, H);
  fctx.fillStyle = `rgba(196,202,210,${0.97 * f})`;
  fctx.fillRect(0, 0, W, H);
  // drifting denser patches
  for (let i = 0; i < 6; i++) {
    const x = (i * 131 + time * 20 * (i % 2 ? 1 : -1)) % (W + 200) - 100;
    const y = ((i * 197 - (camD * 0.9) % (H + 300)) % (H + 300) + H + 300) % (H + 300) - 150;
    const g = fctx.createRadialGradient(x, y, 10, x, y, 160);
    g.addColorStop(0, `rgba(225,228,232,${0.35 * f})`); g.addColorStop(1, 'rgba(225,228,232,0)');
    fctx.fillStyle = g; fctx.fillRect(x - 160, y - 160, 320, 320);
  }
  fctx.globalCompositeOperation = 'destination-out';
  const p = player;
  if (!p.dead) {
    const px = p.x, py = sy(p.w);
    let g = fctx.createRadialGradient(px, py, 20, px, py, 110);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g; fctx.fillRect(px - 110, py - 110, 220, 220);
    // headlight beam
    fctx.save(); fctx.translate(px, py - p.hl); fctx.rotate(p.angle);
    const len = 290;
    g = fctx.createLinearGradient(0, 0, 0, -len);
    g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.6, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.moveTo(-14, 0); fctx.lineTo(14, 0); fctx.lineTo(95, -len); fctx.lineTo(-95, -len); fctx.closePath(); fctx.fill();
    fctx.restore();
  }
  ctx.drawImage(fogCv, 0, 0);
}

function glow(x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Tail lights shine through the fog. Enemy types have their own light colours.
function drawLights(f) {
  if (f <= 0.05) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.6 + 0.4 * Math.sin(time * 8);
  for (const c of cars) {
    if (c.type === 'wreck') continue;
    const y = sy(c.w); if (y < -40 || y > H + 40) continue;
    let col = '255,40,30', a = 0.9 * f, spread = c.hw - 5, rad = 16;
    if (c.type === 'puncture') { col = '255,40,200'; a *= pulse; }
    if (c.type === 'van') { col = '255,150,20'; spread = c.hw + 2; rad = 18; }
    if (c.type === 'rammer') { col = '255,30,30'; rad = 20; }
    if (c.type === 'supply') { col = '80,255,110'; }
    const ry = y + c.hl;
    glow(c.x - spread, ry, rad, col, a); glow(c.x + spread, ry, rad, col, a);
    if (c.w < player.w) {   // cars behind: headlights glare forward
      glow(c.x - spread, y - c.hl, 22, '255,245,200', 0.55 * f);
      glow(c.x + spread, y - c.hl, 22, '255,245,200', 0.55 * f);
    }
    if (c.type === 'rammer' && Math.floor(time * 6) % 2) glow(c.x, y, 26, '255,0,0', 0.5 * f);
  }
  for (const k of craters) { const y = sy(k.w); glow(k.x, y, 40, '255,100,20', 0.55 * f); }
  for (const b of bombs) { const y = sy(b.w); glow(b.x, y, 34, '255,30,30', (0.4 + 0.4 * Math.sin(time * 20)) * f); }
  if (heli) { const y = sy(heli.w); glow(heli.x, y - 66, 26, '255,40,40', (Math.floor(time * 3) % 2 ? 0.9 : 0.2) * f); glow(heli.x, y, 60, '220,230,255', 0.25 * f); }
  for (const q of particles) if (q.kind === 'fire') glow(q.x, sy(q.w), q.size * 3, '255,140,40', 0.4 * f * clamp(q.life / q.max, 0, 1));
  ctx.restore();
}

// ---------- HUD ----------
function drawHUD() {
  const p = player;
  ctx.fillStyle = 'rgba(10,12,16,0.72)'; ctx.fillRect(0, 0, W, 62);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 24px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(Math.floor(p.w / PXM) + ' m', 14, 22);
  ctx.font = '13px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText(Math.round(p.speed * 0.3) + ' km/h   ·   ' + BIOMES[biomeAt(p.w)].name, 14, 46);
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffe066'; ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(String(score), W / 2, 22);
  ctx.font = '11px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = '#9fb0c0'; ctx.fillText('SCORE', W / 2, 44);
  // health
  const hx = W - 150, hy = 14;
  ctx.fillStyle = '#333'; rr(hx, hy, 136, 14, 4); ctx.fill();
  const hp = p.hp / 100;
  ctx.fillStyle = hp > 0.5 ? '#4cd964' : hp > 0.25 ? '#ffcc00' : '#ff3b30';
  if (hp > 0) { rr(hx, hy, 136 * hp, 14, 4); ctx.fill(); }
  // lives
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < lives ? '#f2f5f8' : 'rgba(255,255,255,0.15)';
    rr(W - 26 - i * 22, 36, 12, 20, 3); ctx.fill();
    if (i < lives) { ctx.fillStyle = '#1f6fe0'; ctx.fillRect(W - 21 - i * 22, 36, 2, 20); }
  }
  // weapons
  const slots = [['GUN', 'SPACE', '∞', true], ['OIL', 'Z', p.oil, p.oil > 0], ['SMOKE', 'X', p.smokeT > 0 ? 'ON' : p.smoke, p.smoke > 0 || p.smokeT > 0], ['ROCKET', 'C', p.rockets, p.rockets > 0]];
  const sw = 112, sx0 = (W - sw * 4 - 18) / 2, syy = H - 50;
  slots.forEach((s, i) => {
    const x = sx0 + i * (sw + 6);
    ctx.fillStyle = s[3] ? 'rgba(10,12,16,0.75)' : 'rgba(10,12,16,0.4)'; rr(x, syy, sw, 38, 7); ctx.fill();
    ctx.strokeStyle = s[3] ? (i === 3 && heli ? '#ff6b4a' : 'rgba(255,255,255,0.35)') : 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1.5; rr(x, syy, sw, 38, 7); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = s[3] ? '#fff' : '#777'; ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(s[0], x + 9, syy + 14);
    ctx.fillStyle = '#8899aa'; ctx.font = '10px "Segoe UI", system-ui, sans-serif'; ctx.fillText('[' + s[1] + ']', x + 9, syy + 29);
    ctx.textAlign = 'right'; ctx.fillStyle = s[3] ? '#ffe066' : '#666'; ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(String(s[2]), x + sw - 10, syy + 20);
  });
  // helicopter timer
  if (heli && heli.state === 'hover') {
    const left = Math.max(0, 60 - heli.t);
    ctx.fillStyle = 'rgba(120,20,10,0.75)'; rr(W / 2 - 90, 70, 180, 24, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('HELICOPTER  ' + Math.ceil(left) + 's', W / 2, 82);
  }
  // warnings for enemies chasing from behind (off-screen)
  for (const c of cars) {
    if (!isEnemy(c)) continue;
    const y = sy(c.w);
    if (y > H + c.hl - 10) {
      const a = 0.5 + 0.5 * Math.sin(time * 12);
      ctx.fillStyle = `rgba(255,60,40,${a})`;
      ctx.beginPath(); ctx.moveTo(c.x, H - 66); ctx.lineTo(c.x - 12, H - 56 + 4); ctx.lineTo(c.x + 12, H - 56 + 4); ctx.closePath(); ctx.fill();
    }
  }
  // supply truck: docking guidance + re-arm progress
  if (p.inTruck) {
    const T = p.inTruck;
    const prog = T.phase === 'in' ? 0 : T.phase === 'ride' ? T.t / RIDE_T : 1;
    ctx.fillStyle = 'rgba(10,12,16,0.8)'; rr(W / 2 - 120, 104, 240, 44, 8); ctx.fill();
    ctx.fillStyle = '#ffd34d'; ctx.textAlign = 'center'; ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(T.phase === 'out' ? 'BACKING OUT...' : 'RE-ARMING & REPAIRING', W / 2, 118);
    ctx.fillStyle = '#333'; rr(W / 2 - 100, 128, 200, 10, 4); ctx.fill();
    ctx.fillStyle = '#ffd34d'; rr(W / 2 - 100, 128, 200 * clamp(prog, 0.02, 1), 10, 4); ctx.fill();
  } else {
    const t = cars.find(c => c.type === 'supply' && c.ai.state === 'wait' && c.w > p.w && c.w - p.w < 520);
    if (t && !p.dead) {
      const dx = p.x - t.x, closing = p.speed - t.speed;
      const okX = Math.abs(dx) < SUPPLY_ALIGN, okA = Math.abs(p.angle) < 0.15, okS = closing < SUPPLY_MAX_CLOSE;
      ctx.fillStyle = 'rgba(10,12,16,0.8)'; rr(W / 2 - 130, 104, 260, 46, 8); ctx.fill();
      ctx.textAlign = 'center'; ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffd34d'; ctx.fillText('DRIVE INTO THE TRAILER', W / 2, 117);
      ctx.font = '12px "Segoe UI", system-ui, sans-serif';
      const item = (txt, ok, x) => { ctx.fillStyle = ok ? '#7dff9a' : '#ff8a6a'; ctx.fillText((ok ? '✔ ' : '✖ ') + txt, x, 138); };
      item(okX ? 'LINED UP' : (dx < 0 ? 'MOVE RIGHT' : 'MOVE LEFT'), okX, W / 2 - 80);
      item(okA ? 'STRAIGHT' : 'STRAIGHTEN', okA, W / 2);
      item(okS ? 'SPEED OK' : 'SLOW DOWN', okS, W / 2 + 80);
    }
  }
  // popups
  ctx.textAlign = 'center'; ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
  for (const q of popups) {
    ctx.globalAlpha = clamp(q.life, 0, 1);
    ctx.fillStyle = '#000'; ctx.fillText(q.text, q.x + 1, q.y + 1);
    ctx.fillStyle = q.color; ctx.fillText(q.text, q.x, q.y);
  }
  ctx.globalAlpha = 1;
  // banner
  if (banner) {
    const a = clamp(Math.min(banner.t, banner.max - banner.t) * 3, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 170, W, banner.sub ? 78 : 56);
    ctx.fillStyle = banner.color; ctx.textAlign = 'center'; ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(banner.text, W / 2, 200);
    if (banner.sub) { ctx.fillStyle = '#dde4ea'; ctx.font = '14px "Segoe UI", system-ui, sans-serif'; ctx.fillText(banner.sub, W / 2, 230); }
    ctx.globalAlpha = 1;
  }
  if (hurtFlash > 0) { ctx.fillStyle = `rgba(255,0,0,${hurtFlash * 0.35})`; ctx.fillRect(0, 0, W, H); }
}

function panel(lines, y0) {
  ctx.fillStyle = 'rgba(8,10,14,0.82)'; rr(30, y0, W - 60, lines.length * 24 + 30, 12); ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.fillStyle = l[1] || '#dfe7ef'; ctx.font = (l[2] || '') + ' 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(l[0], 50, y0 + 27 + i * 24);
  });
}

function drawTitle() {
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000'; ctx.font = 'bold 56px "Segoe UI", system-ui, sans-serif'; ctx.fillText('HIGHWAY HAVOC', W / 2 + 3, 113);
  ctx.fillStyle = '#ffcf3a'; ctx.fillText('HIGHWAY HAVOC', W / 2, 110);
  ctx.fillStyle = '#e8eef4'; ctx.font = '16px "Segoe UI", system-ui, sans-serif'; ctx.fillText('How far can you make it?', W / 2, 155);
  panel([
    ['CONTROLS', '#ffcf3a', 'bold'],
    ['Arrows / WASD  - steer, speed up, brake'],
    ['Space  - front machine guns'],
    ['Z  oil slick    X  smoke screen    C  rocket'],
    ['P  pause    M  mute    N  music'],
    ['', ''],
    ['ENEMIES', '#ff6b4a', 'bold'],
    ['Spike car (black/red) - never let it sit beside you'],
    ['Bruiser van (green) - bulletproof! Ram it, oil or smoke it'],
    ['Rammer (red, bull bar) - hits you from behind'],
    ['Helicopter - bombs leave deadly craters'],
    ['', ''],
    ['Slow down, line up and drive INTO the yellow SUPPLY'],
    ['TRUCK to re-arm + repair. Rockets kill the helicopter.'],
    ['In fog, read the lights: pink = spikes, amber = van'],
  ], 200);
  const a = 0.6 + 0.4 * Math.sin(time * 4);
  ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 22px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('PRESS ENTER TO START', W / 2, 800); ctx.globalAlpha = 1;
  if (best > 0) { ctx.fillStyle = '#9fb0c0'; ctx.font = '14px "Segoe UI", system-ui, sans-serif'; ctx.fillText('Best score: ' + best, W / 2, 838); }
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff5a4a'; ctx.font = 'bold 52px "Segoe UI", system-ui, sans-serif'; ctx.fillText('GAME OVER', W / 2, 300);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Distance: ' + Math.floor(player.w / PXM) + ' m', W / 2, 380);
  ctx.fillStyle = '#ffe066'; ctx.fillText('Score: ' + score, W / 2, 420);
  ctx.fillStyle = '#9fb0c0'; ctx.font = '16px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(score >= best ? 'NEW BEST!' : 'Best: ' + best, W / 2, 460);
  const a = 0.6 + 0.4 * Math.sin(time * 4);
  ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('PRESS ENTER TO DRIVE AGAIN', W / 2, 540); ctx.globalAlpha = 1;
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate(Math.round(rand(-shake, shake) * 0.5), Math.round(rand(-shake, shake) * 0.5));
  drawRoad();
  drawDecor();
  drawSkids();
  drawCraters();
  drawOils();
  for (const c of cars) if (c.type === 'wreck') drawVehicle(c);
  if (state !== 'title' && player.inTruck) drawVehicle(player);   // drawn under the trailer while inside
  for (const c of cars) if (c.type !== 'wreck') drawVehicle(c);
  if (state !== 'title' && !player.dead && !player.inTruck) drawVehicle(player);
  drawProjectiles();
  drawObstacles();
  drawSmokes();
  drawParticles();
  drawBombs();
  drawHeli();
  drawFog(fogLevel);
  drawLights(fogLevel);
  ctx.restore();
  drawVignette();
  if (state === 'play' || state === 'over') drawHUD();
  if (state === 'title') drawTitle();
  if (state === 'over') drawGameOver();
  if (paused && state === 'play') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 40px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PAUSED', W / 2, H / 2); ctx.font = '16px "Segoe UI", system-ui, sans-serif'; ctx.fillText('Press P to continue', W / 2, H / 2 + 40);
  }
}

// =====================================================================
//  MAIN LOOP
// =====================================================================
resetGame(); state = 'title';
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (state === 'title') {
    time += dt; camD += 320 * dt; player.w = camD + 260; ensureGen();
    if (tapped('Enter', 'NumpadEnter', 'Space')) { resetGame(); state = 'play'; }
  } else if (state === 'play') {
    if (tapped('KeyP', 'Escape')) paused = !paused;
    if (tapped('KeyM')) sfx.setMuted(!sfx.muted);
    if (tapped('KeyN')) sfx.toggleMusic();
    if (!paused) update(dt); else sfx.engine(0, false);
  } else if (state === 'over') {
    time += dt;
    if (tapped('Enter', 'NumpadEnter')) { resetGame(); state = 'play'; }
  }
  render();
  pressed = {};
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

