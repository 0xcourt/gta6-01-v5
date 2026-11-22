// Cabo Lume — deterministic RNG (mulberry32 + helpers). No Math.random in game logic:
// every run from the same seed builds the same city, the same traffic and the same shots.
'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// String seed -> uint32 (FNV-1a), so 'cabo-lume' is a stable seed anywhere.
function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed) {
  const next = mulberry32(typeof seed === 'string' ? seedFromString(seed) : seed);
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => Math.floor(a + next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    // Deterministic 2D value noise in [-1, 1] for terrain/placement jitter.
    noise2: (x, z) => {
      const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
      return (s - Math.floor(s)) * 2 - 1;
    },
  };
}

// Pure helpers the logic tests import in Node (no DOM, no WebGL here).
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist2d(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function fmtCash(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
function fmtTime(mins) {
  const h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Node / browser dual export: tests run this file under Node, the browser loads it as a classic script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mulberry32, seedFromString, makeRng, clamp, lerp, dist2d, angleLerp, fmtCash, fmtTime };
}
