// Cabo Lume — the city. A seeded 9x9 street grid on a cape: land, a beach strip and the
// sea to the east, a lighthouse on the point, a marina and docks. Everything here is pure
// data (no DOM, no WebGL) so the logic tests can generate the city in Node and hash it.
'use strict';

// Node: load the RNG dependency (in the browser it arrives as a global from rng.js).
if (typeof makeRng === 'undefined' && typeof require === 'function') {
  var makeRng = require('./rng.js').makeRng;
}

const CITY = {
  seed: 'cabo-lume-v5',
  pitch: 74,          // block pitch (60 block + 14 street)
  blocks: 4,          // blocks at -4..4 in each axis
  streetWidth: 14,
  half: 340,          // drivable land half-extent
  waterX: 346,        // sea starts here (east)
  beachX: 322,        // sand strip
};

// Named places the missions and the HUD point at. x east, z south (y is up in the renderer).
const LOCATIONS = {
  garage:   { name: 'Farol Garage',   x: 0,    z: 26,   blip: 'G' },
  plaza:    { name: 'Praça do Sol',   x: 0,    z: 0,    blip: 'P' },
  marina:   { name: 'Marina Lume',    x: 322,  z: 118,  blip: 'M' },
  docks:    { name: 'Porto Docks',    x: 322,  z: -118, blip: 'D' },
  mercado:  { name: 'Mercado Central',x: -148, z: 148,  blip: '$' },
  hotel:    { name: 'Hotel Miradouro',x: 148,  z: -222, blip: 'H' },
  bank:     { name: 'Banco do Lume',  x: -222, z: -148, blip: 'B' },
  tunnel:   { name: 'Old Tunnel',     x: -318, z: 0,    blip: 'T' },
  stadium:  { name: 'Estádio Lume',   x: 222,  z: 222,  blip: 'S' },
  faro:     { name: 'Farol do Lume',  x: 358,  z: -272, blip: 'F' },
  beach:    { name: 'Praia Dourada',  x: 330,  z: 8,    blip: '~' },
  church:   { name: 'Igreja Branca',  x: -74,  z: -74,  blip: '+' },
};

// Golden-hour palette: sun-bleached plaster, terracotta roofs, teal shutters, white church.
const PALETTE = {
  walls: [0xd9a066, 0xe8c98f, 0xc97b4a, 0xe6ddc8, 0xcf8f6b, 0xb7c4a8, 0xddb98a, 0xc9a06a],
  roofs: [0x9e4f2e, 0x7d3b26, 0xb06a3c, 0x5f6e52, 0x8a5a34],
  trim:  [0x2e6f73, 0xf2ead8, 0x3d5a4c, 0x8c2f2f],
  glass: [0x2b3a44, 0x36454f, 0x1f2e3a],
};

// Blocks that stay open (no buildings): plaza, garage forecourt, stadium field, beach.
const OPEN_BLOCKS = { '0,0': 'plaza', '3,3': 'stadium' };

function genCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];   // {x,z,w,d,h,color,roof,trim,roofH}
  const palms = [];       // {x,z,h,lean}
  const lamps = [];       // {x,z}
  const parked = [];      // {x,z,yaw,color}
  const props = [];       // {kind,x,z,...} crates, benches, kiosks, tanks
  const carColors = [0xc0392b, 0x2e6f73, 0xe8c98f, 0x36454f, 0xd9d9d9, 0x7d3b26, 0x3d5a4c, 0xb03a2e];

  for (let bx = -CITY.blocks; bx <= CITY.blocks; bx++) {
    for (let bz = -CITY.blocks; bz <= CITY.blocks; bz++) {
      const cx = bx * CITY.pitch, cz = bz * CITY.pitch;
      const key = bx + ',' + bz;
      if (OPEN_BLOCKS[key]) {
        if (OPEN_BLOCKS[key] === 'stadium') {
          props.push({ kind: 'stand', x: cx, z: cz - 14, w: 46, d: 10, h: 9, color: 0x7d8a99 });
          props.push({ kind: 'stand', x: cx, z: cz + 14, w: 46, d: 10, h: 9, color: 0x7d8a99 });
          props.push({ kind: 'pitch', x: cx, z: cz, w: 40, d: 20, color: 0x4a7c43 });
        }
        if (OPEN_BLOCKS[key] === 'plaza') {
          props.push({ kind: 'fountain', x: cx, z: cz, r: 7, color: 0x7fb3c8 });
          props.push({ kind: 'kiosk', x: cx - 18, z: cz + 14, w: 8, d: 6, h: 4, color: 0xc97b4a });
          props.push({ kind: 'kiosk', x: cx + 18, z: cz - 14, w: 8, d: 6, h: 4, color: 0x2e6f73 });
        }
        continue;
      }
      if (cx > CITY.beachX - 40) continue; // beach blocks stay open sand
      const n = rng.int(2, 4);
      const central = Math.abs(bx) <= 1 && Math.abs(bz) <= 1;
      for (let i = 0; i < n; i++) {
        const w = rng.range(11, 20), d = rng.range(11, 20);
        const x = cx + rng.range(-22, 22), z = cz + rng.range(-22, 22);
        // Keep buildings off the garage forecourt.
        if (Math.abs(x - LOCATIONS.garage.x) < 26 && Math.abs(z - LOCATIONS.garage.z) < 20) continue;
        const h = central ? rng.range(16, 44) : rng.range(8, 24);
        buildings.push({
          x, z, w, d, h,
          color: rng.pick(PALETTE.walls),
          roof: rng.pick(PALETTE.roofs),
          trim: rng.pick(PALETTE.trim),
          glass: rng.pick(PALETTE.glass),
          roofH: rng.range(0.6, 1.6),
          tank: rng.chance(0.45),
        });
      }
      // Rooftop props become street props on open corners: crates near some blocks.
      if (rng.chance(0.5)) props.push({ kind: 'crates', x: cx + rng.range(-24, 24), z: cz + rng.range(-24, 24), n: rng.int(2, 5) });
    }
  }

  // Palms along the streets (skip intersections) + lamps at intersections.
  const streets = [];
  for (let i = -CITY.blocks; i <= CITY.blocks; i++) streets.push(i * CITY.pitch + CITY.pitch / 2);
  streets.push(-CITY.half, CITY.half);
  for (const s of streets) {
    for (let t = -CITY.half + 20; t <= CITY.half - 20; t += 30) {
      const j = rng.range(-3, 3);
      if (rng.chance(0.55)) palms.push({ x: s + 9 + j * 0.3, z: t, h: rng.range(7, 11), lean: rng.range(-0.08, 0.08) });
      if (rng.chance(0.4)) palms.push({ x: t, z: s + 9 + j * 0.3, h: rng.range(7, 11), lean: rng.range(-0.08, 0.08) });
    }
  }
  for (let i = -CITY.blocks; i <= CITY.blocks; i++) {
    for (let j = -CITY.blocks; j <= CITY.blocks; j++) {
      const x = i * CITY.pitch + CITY.pitch / 2, z = j * CITY.pitch + CITY.pitch / 2;
      if (Math.abs(x) <= CITY.half && Math.abs(z) <= CITY.half) lamps.push({ x: x + 8, z: z + 8 });
    }
  }

  // Parked cars along curbs.
  for (let i = 0; i < 46; i++) {
    const s = rng.pick(streets);
    const t = rng.range(-CITY.half + 20, CITY.half - 20);
    const alongX = rng.chance(0.5);
    parked.push({
      x: alongX ? s + 5.5 : t, z: alongX ? t : s + 5.5,
      yaw: alongX ? (rng.chance(0.5) ? 0 : Math.PI) : (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2),
      color: rng.pick(carColors),
    });
  }

  // Harbour dressing: pier, containers at the docks, boats at the marina.
  props.push({ kind: 'pier', x: 336, z: 118, w: 26, d: 8, h: 1.2, color: 0x8a6f4d });
  props.push({ kind: 'pier', x: 336, z: -118, w: 26, d: 8, h: 1.2, color: 0x8a6f4d });
  for (let i = 0; i < 8; i++) {
    props.push({ kind: 'container', x: 300 + rng.range(-8, 8), z: -148 + i * 9, w: 6, d: 2.6, h: 2.6, color: rng.pick([0xb03a2e, 0x2e6f73, 0xc97b4a, 0x3d5a4c]) });
  }
  for (let i = 0; i < 5; i++) {
    props.push({ kind: 'boat', x: 352 + rng.range(0, 10), z: 92 + i * 12, w: 4, d: 9, h: 2, color: 0xf2ead8 });
  }
  props.push({ kind: 'lighthouse', x: LOCATIONS.faro.x, z: LOCATIONS.faro.z, h: 34, color: 0xf2ead8 });
  props.push({ kind: 'garage', x: LOCATIONS.garage.x, z: LOCATIONS.garage.z - 8, w: 30, d: 12, h: 7, color: 0x3d5a4c });

  return { seed, buildings, palms, lamps, parked, props, locations: LOCATIONS };
}

// ---- pure spatial helpers (shared by game logic, police AI and tests) ----

function streetLines() {
  const lines = [];
  for (let i = -CITY.blocks; i <= CITY.blocks; i++) lines.push(i * CITY.pitch + CITY.pitch / 2);
  lines.push(-CITY.half, CITY.half);
  return lines;
}

// Snap a point to the nearest street centreline (roads run along x and z).
function nearestRoadPoint(x, z) {
  const lines = streetLines();
  let bestX = lines[0], bestZ = lines[0], bd = Infinity;
  for (const s of lines) {
    const d = Math.abs(x - s); if (d < bd) { bd = d; bestX = s; }
  }
  bd = Infinity;
  for (const s of lines) {
    const d = Math.abs(z - s); if (d < bd) { bd = d; bestZ = s; }
  }
  // Choose the axis whose street is closer.
  return Math.abs(x - bestX) < Math.abs(z - bestZ) ? { x: bestX, z, along: 'z' } : { x, z: bestZ, along: 'x' };
}

function collideCircleBuildings(city, x, z, r) {
  // Push a circle out of every building AABB it overlaps. Returns corrected {x,z,hit}.
  let hit = false;
  for (const b of city.buildings) {
    const hx = b.w / 2 + r, hz = b.d / 2 + r;
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      hit = true;
      const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
      if (px < pz) x = b.x + (dx > 0 ? hx : -hx);
      else z = b.z + (dz > 0 ? hz : -hz);
    }
  }
  return { x, z, hit };
}

function clampToWorld(x, z, margin) {
  const m = margin || 2;
  return {
    x: Math.max(-CITY.half + m, Math.min(CITY.waterX - m, x)),
    z: Math.max(-CITY.half + m, Math.min(CITY.half - m, z)),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CITY, LOCATIONS, PALETTE, genCity, streetLines, nearestRoadPoint, collideCircleBuildings, clampToWorld };
}
