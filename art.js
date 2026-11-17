'use strict';
// =====================================================================
//  ART: vehicle + helicopter sprites (pre-rendered & cached), skid marks,
//  vignette. Loaded before game.js; functions use game.js globals at call time.
// =====================================================================

const SPR_S = 2;      // sprites are painted at 2x for crisp edges
const SPR_P = 18;     // padding around the body for mirrors, bars, spoilers
const spriteCache = new Map();

function hexRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, amt) {             // amt < 0 darkens, > 0 lightens
  const [r, g, b] = hexRgb(hex);
  const f = amt < 0 ? v => v * (1 + amt) : v => v + (255 - v) * amt;
  return `rgb(${f(r) | 0},${f(g) | 0},${f(b) | 0})`;
}
function rrp(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function bodyPath(g, hw, hl, rf, rb) {   // car outline: rounder nose (rf) than tail (rb)
  g.beginPath();
  g.moveTo(-hw + rf, -hl); g.lineTo(hw - rf, -hl); g.quadraticCurveTo(hw, -hl, hw, -hl + rf);
  g.lineTo(hw, hl - rb); g.quadraticCurveTo(hw, hl, hw - rb, hl);
  g.lineTo(-hw + rb, hl); g.quadraticCurveTo(-hw, hl, -hw, hl - rb);
  g.lineTo(-hw, -hl + rf); g.quadraticCurveTo(-hw, -hl, -hw + rf, -hl); g.closePath();
}
function sideGrad(g, hw, color, k = 1) {  // gives the body a rounded, lit look
  const gr = g.createLinearGradient(-hw, 0, hw, 0);
  gr.addColorStop(0, shade(color, -0.5 * k)); gr.addColorStop(0.16, shade(color, -0.08 * k));
  gr.addColorStop(0.45, shade(color, 0.22 * k)); gr.addColorStop(0.6, shade(color, 0.1 * k));
  gr.addColorStop(0.86, shade(color, -0.12 * k)); gr.addColorStop(1, shade(color, -0.5 * k));
  return gr;
}
function glassGrad(g, y0, y1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, '#132030'); gr.addColorStop(0.45, '#46637f'); gr.addColorStop(1, '#101a26');
  return gr;
}
function trap(g, topW, botW, y0, y1) {
  g.beginPath(); g.moveTo(-topW / 2, y0); g.lineTo(topW / 2, y0); g.lineTo(botW / 2, y1); g.lineTo(-botW / 2, y1); g.closePath();
}
function oval(g, x, y, rx, ry, fill) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); }
function tire(g, x, y, w, h) {
  g.fillStyle = '#0c0c0e'; rrp(g, x - w / 2, y - h / 2, w, h, 2.5); g.fill();
  g.fillStyle = '#2b2b30';
  for (let k = -h / 2 + 2; k < h / 2 - 1; k += 3) g.fillRect(x - w / 2 + 0.6, y + k, w - 1.2, 1);
}
function shine(g, x0, y0, x1, y1, w, a = 0.35) {
  g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
function lights(g, hw, hl) {
  g.fillStyle = '#fffbe2'; rrp(g, -hw + 2, -hl + 0.8, 6.5, 3, 1.5); g.fill(); rrp(g, hw - 8.5, -hl + 0.8, 6.5, 3, 1.5); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(-hw + 3, -hl + 1.4, 2, 1); g.fillRect(hw - 7.5, -hl + 1.4, 2, 1);
  g.fillStyle = '#a8121b'; rrp(g, -hw + 2, hl - 3.8, 7, 3, 1.5); g.fill(); rrp(g, hw - 9, hl - 3.8, 7, 3, 1.5); g.fill();
}

// ---------- passenger-car shaped vehicles (player, civ cars, rammer, spike car) ----------
function paintCar(g, o) {
  const { hw, hl, color } = o, bw = hw - 1;
  const wy = hl * 0.62;
  for (const sx of [-1, 1]) for (const yy of [-wy, wy]) tire(g, sx * (hw - 1.5), yy, 7, 12.5);
  bodyPath(g, bw, hl, o.style === 'hatch' ? 10 : 9, o.style === 'hatch' ? 8 : 6);
  g.fillStyle = sideGrad(g, bw, color); g.fill();
  g.strokeStyle = shade(color, -0.65); g.lineWidth = 1; g.stroke();

  const ws0 = -hl * 0.5, ws1 = -hl * 0.17;
  const roofEnd = o.style === 'pickup' ? hl * 0.1 : o.style === 'hatch' ? hl * 0.55 : hl * 0.36;

  // racing stripes etc. go on the paint, under the glass
  if (o.stripes) for (const s of o.stripes) { g.fillStyle = s.c; g.fillRect(s.x, -hl + 1, s.w, hl * 2 - 2); }

  // hood creases
  g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(-bw * 0.42, -hl + 5); g.lineTo(-bw * 0.5, ws0 - 1); g.moveTo(bw * 0.42, -hl + 5); g.lineTo(bw * 0.5, ws0 - 1); g.stroke();
  shine(g, -bw * 0.15, -hl + 4, -bw * 0.2, ws0 - 3, 2, 0.18);

  // windshield
  trap(g, bw * 2 - 9, bw * 2 - 3, ws0, ws1); g.fillStyle = glassGrad(g, ws0, ws1); g.fill();
  shine(g, -bw * 0.45, ws1 - 2, -bw * 0.15, ws0 + 2, 2.2, 0.3);
  // roof
  rrp(g, -(bw - 3), ws1, (bw - 3) * 2, roofEnd - ws1, 4);
  const rg = g.createLinearGradient(-bw, 0, bw, 0);
  rg.addColorStop(0, shade(color, -0.3)); rg.addColorStop(0.45, shade(color, 0.32)); rg.addColorStop(1, shade(color, -0.3));
  g.fillStyle = rg; g.fill();
  if (o.stripes) for (const s of o.stripes) { g.fillStyle = s.c; g.fillRect(s.x, ws1, s.w, roofEnd - ws1); }
  if (o.sunroof) { g.fillStyle = glassGrad(g, ws1 + 4, ws1 + 12); rrp(g, -bw * 0.45, ws1 + 4, bw * 0.9, (roofEnd - ws1) * 0.4, 2); g.fill(); }
  // side windows
  g.fillStyle = 'rgba(18,30,44,0.9)';
  g.fillRect(-bw + 0.5, ws1 + 2, 2.4, roofEnd - ws1 - 4); g.fillRect(bw - 2.9, ws1 + 2, 2.4, roofEnd - ws1 - 4);
  // rear window or pickup bed
  if (o.style === 'pickup') {
    g.fillStyle = shade(color, -0.55); rrp(g, -(bw - 3), roofEnd + 3, (bw - 3) * 2, hl - roofEnd - 6, 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    for (let k = -(bw - 6); k < bw - 5; k += 5) { g.beginPath(); g.moveTo(k, roofEnd + 5); g.lineTo(k, hl - 5); g.stroke(); }
  } else {
    trap(g, bw * 2 - 8, bw * 2 - 13, roofEnd, roofEnd + Math.min(9, (hl - roofEnd) * 0.6)); g.fillStyle = glassGrad(g, roofEnd, roofEnd + 9); g.fill();
  }
  // door seams
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 0.8;
  const dy = ws1 + (roofEnd - ws1) * 0.5;
  g.beginPath(); g.moveTo(-bw, dy); g.lineTo(-bw + 3, dy); g.moveTo(bw, dy); g.lineTo(bw - 3, dy); g.stroke();
  // mirrors
  oval(g, -bw - 1.8, ws1 + 1, 2.4, 1.8, shade(color, -0.35)); oval(g, bw + 1.8, ws1 + 1, 2.4, 1.8, shade(color, -0.35));
  lights(g, bw, hl);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-bw + 6, hl - 2, (bw - 6) * 2, 1.4);
}

function paintPlayer(g, o) {
  const { hw, hl } = o;
  paintCar(g, Object.assign({}, o, { stripes: [{ x: -6, w: 3.5, c: '#1d6ae0' }, { x: 2.5, w: 3.5, c: '#1d6ae0' }] }));
  // hood scoop
  g.fillStyle = '#1b1d22'; rrp(g, -4, -hl * 0.78, 8, 7, 2); g.fill();
  g.fillStyle = '#3a3e46'; g.fillRect(-3, -hl * 0.78 + 1.5, 6, 1); g.fillRect(-3, -hl * 0.78 + 3.5, 6, 1);
  // twin hood guns
  for (const sx of [-1, 1]) {
    const x = sx * 9;
    const gr = g.createLinearGradient(x - 2, 0, x + 2, 0);
    gr.addColorStop(0, '#2a2d33'); gr.addColorStop(0.5, '#9aa3ad'); gr.addColorStop(1, '#2a2d33');
    g.fillStyle = '#1b1d22'; rrp(g, x - 3, -hl + 2, 6, 9, 2); g.fill();
    g.fillStyle = gr; g.fillRect(x - 1.5, -hl - 7, 3, 12);
    g.fillStyle = '#111'; g.fillRect(x - 1.5, -hl - 8, 3, 1.5);
  }
  // rear wing
  g.fillStyle = '#1b1d22';
  g.fillRect(-hw - 1, hl - 5, 2.5, 6); g.fillRect(hw - 1.5, hl - 5, 2.5, 6);
  const wg = g.createLinearGradient(0, hl - 2, 0, hl + 3);
  wg.addColorStop(0, '#454a54'); wg.addColorStop(1, '#16181c');
  g.fillStyle = wg; rrp(g, -hw - 1, hl - 1, hw * 2 + 2, 4, 1.5); g.fill();
}

function paintRammer(g, o) {
  const { hw, hl } = o;
  paintCar(g, Object.assign({}, o, { stripes: [{ x: -3.5, w: 7, c: '#f1efe8' }] }));
  // black hood scoop
  g.fillStyle = '#121214'; rrp(g, -6, -hl * 0.8, 12, 10, 3); g.fill();
  g.fillStyle = '#c0c4ca'; g.fillRect(-4, -hl * 0.8 + 2, 8, 1.2); g.fillRect(-4, -hl * 0.8 + 5, 8, 1.2);
  // chrome side pipes
  for (const sx of [-1, 1]) {
    const gr = g.createLinearGradient(sx * hw - 1.5, 0, sx * hw + 1.5, 0);
    gr.addColorStop(0, '#666'); gr.addColorStop(0.5, '#eee'); gr.addColorStop(1, '#666');
    g.fillStyle = gr; rrp(g, sx * (hw + 0.5) - 1.5, -hl * 0.15, 3, hl * 0.5, 1.5); g.fill();
  }
  // bull bar
  g.fillStyle = '#0e0e10'; rrp(g, -hw - 3, -hl - 6, hw * 2 + 6, 4, 2); g.fill();
  rrp(g, -hw - 3, -hl - 6, 3, 8, 1.5); g.fill(); rrp(g, hw, -hl - 6, 3, 8, 1.5); g.fill();
  g.fillStyle = '#2c2c30';
  for (let x = -hw + 3; x < hw - 2; x += 5) g.fillRect(x, -hl - 5, 1.6, 6);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-hw - 2, -hl - 5.5, hw * 2 + 4, 0.8);
}

function paintSpiker(g, o) {
  const { hw, hl } = o;
  paintCar(g, Object.assign({}, o, { stripes: [{ x: -hw + 3, w: 2, c: '#d01830' }, { x: hw - 5, w: 2, c: '#d01830' }] }));
  // glowing red hood slits
  g.fillStyle = '#ff2a3c';
  for (const sx of [-1, 1]) { g.save(); g.translate(sx * 6, -hl * 0.72); g.rotate(sx * 0.35); g.fillRect(-3, -0.8, 6, 1.6); g.restore(); }
  // wheel hubs (blades spring out of these)
  for (const sx of [-1, 1]) for (const yy of [-hl * 0.62, hl * 0.62]) {
    oval(g, sx * (hw + 1.5), yy, 2.2, 3.5, '#9aa0a8'); oval(g, sx * (hw + 1.5), yy, 1, 1.6, '#333');
  }
}

// ---------- big vehicles ----------
function paintVan(g, o) {
  const { hw, hl, color } = o, bw = hw - 1;
  for (const sx of [-1, 1]) for (const yy of [-hl * 0.62, hl * 0.38, hl * 0.66]) tire(g, sx * (hw - 1.5), yy, 8, 13);
  bodyPath(g, bw, hl, 5, 3);
  g.fillStyle = sideGrad(g, bw, color, 0.8); g.fill();
  g.strokeStyle = shade(color, -0.65); g.lineWidth = 1; g.stroke();
  // camo blotches
  g.save(); bodyPath(g, bw, hl, 5, 3); g.clip();
  const blot = [[-8, -10, 7, 5, '#3a4630'], [6, 6, 8, 6, '#5f6b45'], [-6, 20, 6, 8, '#3a4630'], [8, -22, 5, 4, '#5f6b45'], [-4, 32, 7, 4, '#5f6b45']];
  for (const [x, y, rx, ry, c] of blot) { g.globalAlpha = 0.55; oval(g, x, y, rx, ry, c); }
  g.globalAlpha = 1; g.restore();
  // windshield (narrow armoured slit)
  const ws0 = -hl + 7, ws1 = -hl + 15;
  trap(g, bw * 2 - 8, bw * 2 - 4, ws0, ws1); g.fillStyle = glassGrad(g, ws0, ws1); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(-bw + 3, ws0 + 3.5, bw * 2 - 6, 1.2);   // armour bar over glass
  // roof
  const rg = g.createLinearGradient(-bw, 0, bw, 0);
  rg.addColorStop(0, shade(color, -0.25)); rg.addColorStop(0.5, shade(color, 0.18)); rg.addColorStop(1, shade(color, -0.25));
  g.fillStyle = rg; rrp(g, -bw + 3, ws1 + 1, bw * 2 - 6, hl * 2 - (ws1 + hl) - 4, 3); g.fill();
  // roof rack ribs
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = ws1 + 6; y < hl - 6; y += 7) g.fillRect(-bw + 5, y, bw * 2 - 10, 1.4);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  for (let y = ws1 + 7.4; y < hl - 6; y += 7) g.fillRect(-bw + 5, y, bw * 2 - 10, 0.6);
  // rivets along armour plates
  g.fillStyle = 'rgba(20,24,16,0.8)';
  for (let y = -hl + 18; y < hl - 3; y += 6) { g.fillRect(-bw + 1.2, y, 1.4, 1.4); g.fillRect(bw - 2.6, y, 1.4, 1.4); }
  // side slit windows
  g.fillStyle = '#111';
  g.fillRect(-bw + 0.6, ws1 + 3, 1.6, 7); g.fillRect(bw - 2.2, ws1 + 3, 1.6, 7);
  // rear doors seam + handles
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, hl - 10); g.lineTo(0, hl); g.stroke();
  // ram plate
  const pg = g.createLinearGradient(0, -hl - 7, 0, -hl);
  pg.addColorStop(0, '#5a5f66'); pg.addColorStop(1, '#22262a');
  g.fillStyle = pg; rrp(g, -hw - 4, -hl - 7, hw * 2 + 8, 6, 2); g.fill();
  g.fillStyle = '#1a1c20'; g.fillRect(-hw + 2, -hl - 2, 3, 4); g.fillRect(hw - 5, -hl - 2, 3, 4);
  // hazard chevrons on the plate
  g.save(); rrp(g, -hw - 4, -hl - 7, hw * 2 + 8, 6, 2); g.clip();
  g.fillStyle = '#e5b40f';
  for (let x = -hw - 8; x < hw + 8; x += 7) { g.beginPath(); g.moveTo(x, -hl - 1); g.lineTo(x + 3, -hl - 1); g.lineTo(x + 7, -hl - 7); g.lineTo(x + 4, -hl - 7); g.closePath(); g.fill(); }
  g.restore();
  lights(g, bw, hl);
}

function paintBoxTruck(g, o) {
  const { hw, hl, color } = o, bw = hw - 1;
  for (const sx of [-1, 1]) for (const yy of [-hl * 0.66, hl * 0.4, hl * 0.68]) tire(g, sx * (hw - 1.5), yy, 8, 13);
  // cab
  bodyPath(g, bw, 12, 6, 2); g.save(); g.translate(0, -hl + 12);
  bodyPath(g, bw, 12, 6, 2); g.fillStyle = sideGrad(g, bw, color); g.fill(); g.strokeStyle = shade(color, -0.6); g.lineWidth = 1; g.stroke();
  trap(g, bw * 2 - 8, bw * 2 - 4, -8, -1); g.fillStyle = glassGrad(g, -8, -1); g.fill();
  shine(g, -bw * 0.4, -2, -bw * 0.1, -7, 1.8, 0.3);
  g.restore();
  oval(g, -bw - 2.2, -hl + 8, 2.6, 1.9, '#222'); oval(g, bw + 2.2, -hl + 8, 2.6, 1.9, '#222');
  // cargo box
  const by = -hl + 25;
  const bg = g.createLinearGradient(-bw, 0, bw, 0);
  bg.addColorStop(0, '#9da3aa'); bg.addColorStop(0.5, '#f2f4f6'); bg.addColorStop(1, '#9da3aa');
  g.fillStyle = bg; rrp(g, -bw - 0.5, by, bw * 2 + 1, hl - by, 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = by + 6; y < hl - 3; y += 8) g.fillRect(-bw + 1, y, bw * 2 - 2, 1.2);
  g.fillStyle = color; g.fillRect(-bw - 0.5, by + 8, bw * 2 + 1, 4);
  g.fillStyle = '#a8121b'; g.fillRect(-bw + 1, hl - 2.5, 5, 2.5); g.fillRect(bw - 6, hl - 2.5, 5, 2.5);
  g.fillStyle = '#fffbe2'; rrp(g, -bw + 2, -hl + 0.8, 6, 3, 1.5); g.fill(); rrp(g, bw - 8, -hl + 0.8, 6, 3, 1.5); g.fill();
}

function paintSupply(g, o) {
  const { hw, hl, color } = o, bw = hw - 1;
  for (const sx of [-1, 1]) for (const yy of [-hl * 0.7, hl * 0.35, hl * 0.6]) tire(g, sx * (hw - 1.5), yy, 8, 13);
  // cab
  g.save(); g.translate(0, -hl + 13);
  bodyPath(g, bw, 13, 6, 2); g.fillStyle = sideGrad(g, bw, color); g.fill(); g.strokeStyle = shade(color, -0.6); g.lineWidth = 1; g.stroke();
  trap(g, bw * 2 - 8, bw * 2 - 4, -9, -2); g.fillStyle = glassGrad(g, -9, -2); g.fill();
  shine(g, -bw * 0.4, -3, -bw * 0.1, -8, 1.8, 0.3);
  // roof beacon bar
  g.fillStyle = '#222'; rrp(g, -8, 2, 16, 4, 2); g.fill();
  g.fillStyle = '#ff9a1a'; rrp(g, -7, 2.6, 5, 2.8, 1.2); g.fill(); rrp(g, 2, 2.6, 5, 2.8, 1.2); g.fill();
  g.restore();
  // enclosed box trailer you can drive into
  const by = -hl + 27;
  g.fillStyle = '#2a2c30'; g.fillRect(-4, by - 2, 8, 3);                 // coupling
  const tg = g.createLinearGradient(-bw, 0, bw, 0);
  tg.addColorStop(0, '#6d7279'); tg.addColorStop(0.15, '#b9bec5'); tg.addColorStop(0.5, '#e4e7ea'); tg.addColorStop(0.85, '#b9bec5'); tg.addColorStop(1, '#6d7279');
  g.fillStyle = tg; rrp(g, -bw - 1.5, by, bw * 2 + 3, hl - by, 2.5); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.09)';                                      // roof ribs
  for (let y = by + 5; y < hl - 4; y += 6) g.fillRect(-bw, y, bw * 2, 1.2);
  g.fillStyle = color; g.fillRect(-bw - 1.5, by + 3, 3, hl - by - 6); g.fillRect(bw - 1.5, by + 3, 3, hl - by - 6);   // side stripes
  // hazard band at the rear door
  g.save(); g.beginPath(); g.rect(-bw - 1.5, hl - 5, bw * 2 + 3, 5); g.clip();
  g.fillStyle = '#e5b40f'; g.fillRect(-bw - 2, hl - 5, bw * 2 + 4, 5);
  g.fillStyle = '#16181c';
  for (let x = -bw - 8; x < bw + 8; x += 7) { g.beginPath(); g.moveTo(x, hl); g.lineTo(x + 3.5, hl); g.lineTo(x + 7, hl - 5); g.lineTo(x + 3.5, hl - 5); g.closePath(); g.fill(); }
  g.restore();
  // cargo badge on the roof
  const cy = by + (hl - by) * 0.45;
  oval(g, 0, cy, 11, 11, '#16181c'); oval(g, 0, cy, 9.2, 9.2, '#ffd34d');
  g.fillStyle = '#16181c'; g.font = 'bold 12px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText({ rockets: 'R', oil: 'O', smoke: 'S' }[o.cargo] || '?', 0, cy + 0.5);
  // tail lights on the trailer
  g.fillStyle = '#a8121b'; g.fillRect(-bw, hl - 2, 4, 2); g.fillRect(bw - 4, hl - 2, 4, 2);
  g.fillStyle = '#fffbe2'; rrp(g, -bw + 2, -hl + 0.8, 6, 3, 1.5); g.fill(); rrp(g, bw - 8, -hl + 0.8, 6, 3, 1.5); g.fill();
}

function getCarSprite(kind, style, color, hw, hl, cargo, variant) {
  const key = [kind, style, color, hw.toFixed(1), hl.toFixed(1), cargo || '', variant].join('|');
  let s = spriteCache.get(key);
  if (s) return s;
  const W2 = hw * 2 + SPR_P * 2, H2 = hl * 2 + SPR_P * 2;
  const cvs = document.createElement('canvas');
  cvs.width = Math.ceil(W2 * SPR_S); cvs.height = Math.ceil(H2 * SPR_S);
  const g = cvs.getContext('2d');
  g.scale(SPR_S, SPR_S); g.translate(hw + SPR_P, hl + SPR_P);
  const o = { hw, hl, color, style, cargo };
  if (kind === 'player') paintPlayer(g, o);
  else if (kind === 'rammer') paintRammer(g, o);
  else if (kind === 'puncture') paintSpiker(g, o);
  else if (kind === 'van') paintVan(g, o);
  else if (kind === 'supply') paintSupply(g, o);
  else if (style === 'truck') paintBoxTruck(g, o);
  else paintCar(g, Object.assign(o, { sunroof: color.charCodeAt(1) % 3 === 0 }));

  if (variant === 'wreck' || variant === 'flash') {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    if (variant === 'flash') { g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, 0, cvs.width, cvs.height); }
    else {
      g.fillStyle = 'rgba(28,20,14,0.78)'; g.fillRect(0, 0, cvs.width, cvs.height);
      for (let i = 0; i < 6; i++) {           // scorch blotches
        const x = cvs.width * (0.3 + Math.random() * 0.4), y = cvs.height * (0.25 + Math.random() * 0.5), r = 8 + Math.random() * 14;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(0,0,0,0.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.fillStyle = 'rgba(255,120,40,0.35)';
      for (let i = 0; i < 4; i++) g.fillRect(cvs.width * (0.35 + Math.random() * 0.3), cvs.height * (0.3 + Math.random() * 0.4), 3, 3);
    }
    g.globalCompositeOperation = 'source-over';
  }
  s = { cv: cvs, ox: hw + SPR_P, oy: hl + SPR_P, w: W2, h: H2 };
  spriteCache.set(key, s);
  return s;
}

function drawVehicle(c) {
  const y = sy(c.w);
  if (y < -120 || y > H + 120) return;
  if (c.type === 'player' && c.inv > 0 && Math.floor(time * 12) % 2 === 0) return;
  const kind = c.type === 'wreck' ? c.prevType : c.type;
  const variant = c.type === 'wreck' ? 'wreck' : c.flash > 0 ? 'flash' : '';
  const spr = getCarSprite(kind, c.style, c.color, c.hw, c.hl, c.ai && c.ai.cargo, variant);
  const hw = c.hw, hl = c.hl;
  ctx.save();
  ctx.translate(c.x, y); ctx.rotate(c.angle);
  // soft two-layer shadow (sun from top-left)
  ctx.fillStyle = 'rgba(0,0,0,0.13)'; rr(-hw + 1, -hl + 2, hw * 2 + 8, hl * 2 + 9, 10); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(-hw + 3, -hl + 4, hw * 2 + 2, hl * 2 + 3, 8); ctx.fill();
  // spike-car blades spring out when it lines up with you
  if (kind === 'puncture' && c.type !== 'wreck') {
    const k = clamp(c.ai.align / 0.5, 0, 1), ext = 3 + 11 * k + (c.ai.lunge > 0 ? 6 : 0);
    const wy = hl * 0.62;
    for (const sx of [-1, 1]) for (const yy of [-wy, wy]) {
      for (let b = -1; b <= 1; b++) {
        const gr = ctx.createLinearGradient(sx * (hw + 2), 0, sx * (hw + 2 + ext), 0);
        gr.addColorStop(0, '#888'); gr.addColorStop(1, k > 0.3 ? '#ff3a3a' : '#e8e8e8');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(sx * (hw + 2), yy + b * 3.5 - 1.6); ctx.lineTo(sx * (hw + 2 + ext * (b === 0 ? 1 : 0.7)), yy + b * 4.5); ctx.lineTo(sx * (hw + 2), yy + b * 3.5 + 1.6); ctx.closePath(); ctx.fill();
      }
    }
  }
  // supply truck: lowered ramp + docking guide lines painted on the road behind it
  const ramp = kind === 'supply' && c.ai ? c.ai.ramp || 0 : 0;
  if (ramp > 0) {
    if (c.ai.state === 'wait') {
      const p = player;
      const ok = Math.abs(p.x - c.x) < SUPPLY_ALIGN && Math.abs(p.angle) < 0.15 && p.speed - c.speed < SUPPLY_MAX_CLOSE;
      const col = ok ? '125,255,154' : '255,200,80';
      ctx.strokeStyle = `rgba(${col},${0.6 * ramp})`; ctx.lineWidth = 2.5; ctx.setLineDash([12, 9]);
      ctx.lineDashOffset = -time * 60;
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * (c.hw - 3), hl + 26); ctx.lineTo(sx * (c.hw - 3), hl + 190); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(${col},${0.5 * ramp})`;
      for (let k = 0; k < 4; k++) {   // chevrons pointing into the trailer
        const yy = hl + 50 + k * 34 - ((time * 40) % 34);
        ctx.beginPath(); ctx.moveTo(-8, yy + 6); ctx.lineTo(0, yy); ctx.lineTo(8, yy + 6); ctx.lineTo(8, yy + 10); ctx.lineTo(0, yy + 4); ctx.lineTo(-8, yy + 10); ctx.closePath(); ctx.fill();
      }
    }
    const len = 24 * ramp;
    const rg = ctx.createLinearGradient(0, hl, 0, hl + len);
    rg.addColorStop(0, '#9aa0a8'); rg.addColorStop(1, '#5c6168');
    ctx.fillStyle = rg; ctx.fillRect(-c.hw + 4, hl - 1, (c.hw - 4) * 2, len + 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = hl + 3; y < hl + len; y += 4) ctx.fillRect(-c.hw + 5, y, (c.hw - 5) * 2, 1);
  }
  ctx.drawImage(spr.cv, -spr.ox, -spr.oy, spr.w, spr.h);
  if (ramp > 0.3) {   // rear doors swung open: dark interior visible
    ctx.fillStyle = `rgba(10,10,12,${0.9 * ramp})`; ctx.fillRect(-c.hw + 4, hl - 7, (c.hw - 4) * 2, 6);
    ctx.fillStyle = '#c9ced4';
    ctx.fillRect(-c.hw - 4 * ramp, hl - 2, 3, 3 + 9 * ramp); ctx.fillRect(c.hw + 4 * ramp - 3, hl - 2, 3, 3 + 9 * ramp);
  }
  if (c.type !== 'wreck') {
    if (c.braking) { glow(-hw + 5, hl - 2, 10, '255,40,30', 0.85); glow(hw - 5, hl - 2, 10, '255,40,30', 0.85); }
    if (kind === 'supply' && Math.floor(time * 4) % 2) glow(Math.floor(time * 8) % 2 ? -4 : 4, -hl + 17, 12, '255,160,30', 0.9);
    if (kind === 'puncture') { const a = 0.4 + 0.3 * Math.sin(time * 8); glow(-6, -hl * 0.72, 7, '255,40,60', a); glow(6, -hl * 0.72, 7, '255,40,60', a); }
    if (kind === 'rammer' && ((c.ai.phase === 'warn' && Math.floor(time * 14) % 2) || c.ai.phase === 'charge')) {
      glow(-hw + 5, -hl, 28, '255,250,210', 0.95); glow(hw - 5, -hl, 28, '255,250,210', 0.95);
    }
    if (kind === 'player' && c.gunCD > 0.05 && keys.Space) {   // muzzle flash
      glow(-9, -hl - 9, 9, '255,220,120', 0.9); glow(9, -hl - 9, 9, '255,220,120', 0.9);
    }
  }
  ctx.restore();
}

// ---------- helicopter ----------
let heliSpr = null, heliShadow = null;
function paintHeli(g) {
  const base = '#4c5a3c';
  // tail boom
  const tg = g.createLinearGradient(-6, 0, 6, 0);
  tg.addColorStop(0, shade(base, -0.5)); tg.addColorStop(0.5, shade(base, 0.2)); tg.addColorStop(1, shade(base, -0.5));
  g.fillStyle = tg; g.beginPath(); g.moveTo(-6, -16); g.lineTo(6, -16); g.lineTo(2.6, -80); g.lineTo(-2.6, -80); g.closePath(); g.fill();
  g.fillStyle = '#e5b40f'; g.fillRect(-3.4, -66, 6.8, 2); g.fillRect(-3.1, -70, 6.2, 2);
  // stabiliser + fin
  g.fillStyle = shade(base, -0.25); rrp(g, -17, -63, 34, 6, 2.5); g.fill();
  g.fillStyle = shade(base, -0.4); rrp(g, -3, -90, 6, 14, 2.5); g.fill();
  // stub wings with rocket pods
  const wgd = g.createLinearGradient(0, -6, 0, 6);
  wgd.addColorStop(0, shade(base, 0.1)); wgd.addColorStop(1, shade(base, -0.45));
  g.fillStyle = wgd; rrp(g, -40, -5, 80, 9, 3); g.fill();
  for (const sx of [-1, 1]) {
    const pg = g.createLinearGradient(sx * 30 - 5, 0, sx * 30 + 5, 0);
    pg.addColorStop(0, '#1f231a'); pg.addColorStop(0.5, '#4a5040'); pg.addColorStop(1, '#1f231a');
    g.fillStyle = pg; rrp(g, sx * 30 - 5, -12, 10, 26, 5); g.fill();
    for (const ox of [-2.2, 2.2]) for (const oy of [10, 7]) oval(g, sx * 30 + ox, oy, 1.4, 1.4, '#0a0a0a');
    g.fillStyle = '#7a7f70'; rrp(g, sx * 40 - 2, -10, 4, 20, 2); g.fill();
    g.fillStyle = '#c02020'; g.fillRect(sx * 40 - 1.5, 9, 3, 3);
  }
  // fuselage
  const fuse = () => {
    g.beginPath(); g.moveTo(0, 44);
    g.bezierCurveTo(15, 42, 18, 22, 17, 2); g.bezierCurveTo(16, -18, 10, -28, 0, -30);
    g.bezierCurveTo(-10, -28, -16, -18, -17, 2); g.bezierCurveTo(-18, 22, -15, 42, 0, 44); g.closePath();
  };
  fuse();
  const fg = g.createLinearGradient(-18, 0, 18, 0);
  fg.addColorStop(0, shade(base, -0.55)); fg.addColorStop(0.35, shade(base, 0.12)); fg.addColorStop(0.5, shade(base, 0.25)); fg.addColorStop(1, shade(base, -0.55));
  g.fillStyle = fg; g.fill(); g.strokeStyle = shade(base, -0.7); g.lineWidth = 1; g.stroke();
  g.save(); fuse(); g.clip();
  g.globalAlpha = 0.45;
  oval(g, -8, -10, 7, 5, '#2f3a24'); oval(g, 9, 2, 6, 7, '#6a7550'); oval(g, -6, 30, 5, 4, '#2f3a24'); oval(g, 10, -20, 5, 4, '#2f3a24');
  g.globalAlpha = 1; g.restore();
  // engine intakes / exhausts
  for (const sx of [-1, 1]) { oval(g, sx * 8, -16, 4, 6.5, '#1a1c18'); oval(g, sx * 8, -17.5, 2.4, 3.5, '#4a4a46'); }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-1, -26, 2, 10);
  // tandem canopy
  const glassR = (x, y, rx, ry) => {
    const gr = g.createRadialGradient(x - rx * 0.4, y - ry * 0.4, 1, x, y, Math.max(rx, ry));
    gr.addColorStop(0, '#bfe6ff'); gr.addColorStop(0.35, '#4f86ad'); gr.addColorStop(1, '#16283a');
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
    g.strokeStyle = '#1b2016'; g.lineWidth = 1.3; g.stroke();
  };
  glassR(0, 13, 10, 8.5); glassR(0, 28, 8.5, 9.5);
  shine(g, -5, 9, -2, 6, 1.5, 0.6); shine(g, -4, 24, -2, 21, 1.5, 0.6);
  // chin gun turret
  oval(g, 0, 40, 4.5, 3.5, '#1a1c18');
  g.fillStyle = '#5b5f55'; g.fillRect(-1, 41, 2, 9);
  // roundel
  oval(g, 0, -4, 4.5, 4.5, '#e9e4d0'); oval(g, 0, -4, 2.6, 2.6, '#a8121b');
}
function buildHeli() {
  const Wd = 100, Hd = 160, ox = 50, oy = 96;
  const mk = () => { const c = document.createElement('canvas'); c.width = Wd * SPR_S; c.height = Hd * SPR_S; return c; };
  heliSpr = mk();
  const g = heliSpr.getContext('2d'); g.scale(SPR_S, SPR_S); g.translate(ox, oy); paintHeli(g);
  heliShadow = mk();
  const s = heliShadow.getContext('2d'); s.drawImage(heliSpr, 0, 0);
  s.globalCompositeOperation = 'source-in'; s.fillStyle = '#000'; s.fillRect(0, 0, heliShadow.width, heliShadow.height);
  heliSpr.meta = heliShadow.meta = { w: Wd, h: Hd, ox, oy };
}

function drawRotor(h, R, shadow) {
  const col = shadow ? '0,0,0' : '22,24,20';
  // spinning disc blur
  const dg = ctx.createRadialGradient(0, 0, 4, 0, 0, R);
  dg.addColorStop(0, `rgba(${col},${shadow ? 0.05 : 0.04})`); dg.addColorStop(0.85, `rgba(${col},${shadow ? 0.1 : 0.12})`); dg.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  // blades with motion trails
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    for (let j = 3; j >= 0; j--) {
      const a = h.rotor + k * Math.PI / 2 - j * 0.11;
      ctx.strokeStyle = `rgba(${col},${(shadow ? 0.25 : 0.75) * (1 - j * 0.28)})`;
      ctx.lineWidth = 4.5 - j * 0.6;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke();
    }
    if (!shadow) {
      const a = h.rotor + k * Math.PI / 2;
      ctx.strokeStyle = 'rgba(230,190,40,0.85)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * (R - 5), Math.sin(a) * (R - 5)); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke();
    }
  }
  if (!shadow) { ctx.fillStyle = '#2a2c28'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill(); ctx.fillStyle = '#777'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill(); }
}

function drawHeli() {
  const h = heli; if (!h) return;
  if (!heliSpr) buildHeli();
  const m = heliSpr.meta;
  const y = sy(h.w);
  // bank into turns
  const tgt = clamp(((h.x - (h._px ?? h.x)) || 0) * -0.06, -0.3, 0.3);
  h._px = h.x; h.bank = lerp(h.bank || 0, tgt, 0.08);
  const rot = h.ang + h.bank;
  const sc = h.state === 'falling' ? 1 - h.fallT * 0.3 : 1;
  const shx = h.x + 55, shy = y + 108;
  // rotor downwash rings on the ground
  for (let k = 0; k < 3; k++) {
    const t = (time * 1.3 + k / 3) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.16 * (1 - t)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(shx, shy, 25 + t * 70, 20 + t * 56, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // shadow
  ctx.save(); ctx.translate(shx, shy); ctx.rotate(rot); ctx.scale(0.85 * sc, 0.85 * sc);
  ctx.globalAlpha = 0.3; ctx.drawImage(heliShadow, -m.ox, -m.oy, m.w, m.h); ctx.globalAlpha = 1;
  ctx.translate(0, -4); drawRotor(h, 62, true);
  ctx.restore();
  // body
  ctx.save(); ctx.translate(h.x, y); ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.drawImage(heliSpr, -m.ox, -m.oy, m.w, m.h);
  // tail rotor
  ctx.save(); ctx.translate(5, -84);
  ctx.fillStyle = 'rgba(25,25,25,0.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 2.5, 11, 0, 0, Math.PI * 2); ctx.fill();
  const tl = Math.sin(h.rotor * 1.7) * 11;
  ctx.strokeStyle = 'rgba(20,20,20,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -tl); ctx.lineTo(0, tl); ctx.stroke();
  ctx.restore();
  // nav lights + beacon
  glow(-41, 0, 6, '255,40,40', 0.9); glow(41, 0, 6, '40,255,90', 0.9);
  if (Math.floor(time * 3) % 2) glow(0, -86, 10, '255,60,60', 0.95);
  ctx.translate(0, -4); drawRotor(h, 62, false);
  ctx.restore();
}

// ---------- skid marks & tyre tracks ----------
let skids = [];
function trackVehicleFx(c, dt, isPlayer) {
  // brake light state
  const ps = c._ps === undefined ? c.speed : c._ps;
  c.braking = isPlayer ? (keys.ArrowDown || keys.KeyS) && c.speed > 20 : (ps - c.speed) > 140 * dt && c.speed > 40;
  c._ps = c.speed;
  if (c.type === 'wreck' || c.dead || (isPlayer && c.dead)) { c._sk = null; return; }
  const r = roadAt(c.w);
  const off = r.bridge ? 0 : offFactor(c, r);
  const hardBrake = c.braking && c.speed > 260 && (isPlayer || (ps - c.speed) > 300 * dt);
  const sliding = c.spin > 0 || c.knock > 0.2 || Math.abs(c.slip || 0) > 90 || hardBrake;
  const dirt = off > 0.3 && c.speed > 60;
  if (!sliding && !dirt) { c._sk = null; return; }
  const ca = Math.cos(c.angle), sa = Math.sin(c.angle), ly = c.hl * 0.62, lx = c.hw - 2;
  const pts = [[-lx, ly], [lx, ly]].map(([x, y]) => [c.x + x * ca - y * sa, c.w - (x * sa + y * ca)]);
  const col = dirt && !sliding ? (biomeAt(c.w) === 3 ? 'rgba(150,165,185,0.55)' : 'rgba(80,60,35,0.4)') : 'rgba(12,12,12,0.42)';
  if (c._sk) for (let i = 0; i < 2; i++) skids.push({ x1: c._sk[i][0], w1: c._sk[i][1], x2: pts[i][0], w2: pts[i][1], col });
  c._sk = pts;
  if (skids.length > 1400) skids.splice(0, skids.length - 1400);
}
function pruneSkids() { if (skids.length && skids[0].w1 < camD - 60) skids = skids.filter(s => s.w1 > camD - 60); }
function drawSkids() {
  ctx.lineCap = 'round'; ctx.lineWidth = 3.4;
  let cur = null;
  ctx.beginPath();
  for (const s of skids) {
    if (s.col !== cur) { if (cur) ctx.stroke(); ctx.beginPath(); ctx.strokeStyle = cur = s.col; }
    ctx.moveTo(s.x1, sy(s.w1)); ctx.lineTo(s.x2, sy(s.w2));
  }
  if (cur) ctx.stroke();
}

// ---------- vignette ----------
let vignetteCv = null;
function drawVignette() {
  if (!vignetteCv) {
    vignetteCv = document.createElement('canvas'); vignetteCv.width = W; vignetteCv.height = H;
    const g = vignetteCv.getContext('2d');
    const gr = g.createRadialGradient(W / 2, H * 0.55, H * 0.32, W / 2, H * 0.55, H * 0.78);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  ctx.drawImage(vignetteCv, 0, 0);
}
