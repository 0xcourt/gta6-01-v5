// Cabo Lume — the game. Third-person open-world crime: on-foot + driving, 5-star CLPD
// dispatch with a spotlight helicopter, roadblocks, crew abilities, garage, respect ranks,
// 12 staged story missions, golden-hour-to-dawn day cycle, localStorage saves.
// All code written in this session; deterministic seeded RNG, fixed 60Hz timestep.
'use strict';

/* global makeRng, clamp, lerp, dist2d, angleLerp, fmtCash, fmtTime */
/* global CITY, LOCATIONS, genCity, nearestRoadPoint, collideCircleBuildings, clampToWorld */
/* global CREW, CARS, rankFor, MISSIONS, starsForHeat, dispatchRoles, checkStage */
/* global createRenderer, MeshBuilder, skyFor, carMesh, personMesh, heliMesh, mat4YawPitch, mat4TransformPoint */
/* global createAudio */

const SAVE_KEY = 'cabolume-save-v1';
const STEP = 1 / 60;

const G = {
  screen: 'title', // title | play | paused | busted | complete
  city: null,
  renderer: null,
  audio: null,
  rng: null,
  time: 1040, // 17:20 — golden hour
  cash: 0, respect: 0,
  missionIdx: 0, missionUnlocked: 0,
  mission: null, // {def, stageIdx, state, active}
  player: { x: 0, z: 44, yaw: 0, onFoot: false, speed: 0, hp: 100, walkPhase: 0 },
  car: null, // player's current car {x,z,yaw,speed,model,color,hp,nitro}
  ownedCars: ['vela'], carId: 'vela',
  traffic: [], // {x,z,yaw,speed,axis,dir,color,parked,escort,escortHp,wrecked}
  cops: [],    // {x,z,yaw,speed,callsign,role,stuck}
  roadblocks: [], // {x,z,yaw}
  heli: { active: false, angle: 0, x: 0, z: 0, y: 52, lit: false },
  heat: 0, stars: 0,
  pickups: [], // {x,z,kind,taken,spin}
  waypoint: null, // {x,z,label}
  tailTarget: null, rival: null,
  crewCd: { rui: 0, tomas: 0, ines: 0 },
  particles: [], // {x,y,z,vx,vy,vz,life,max,color,size}
  trauma: 0, hitStop: 0, shakeT: 0,
  keys: {},
  dialogue: { lines: [], idx: 0, shown: 0, active: false },
  stats: { distance: 0, crashes: 0, pickups: 0, playSecs: 0, busted: 0 },
  saveTimer: 0, bustedTimer: 0, spottedTimer: 0, lostTimer: 0,
  shotMode: null, shotDone: false,
  mouseDown: false,
};

const CALLSIGNS = ['CL-11', 'CL-22', 'CL-33', 'CL-44', 'CL-55', 'CL-66'];

// ---------- setup ----------

function newSave() {
  return { cash: 250, respect: 0, missionUnlocked: 0, ownedCars: ['vela'], carId: 'vela', stats: { distance: 0, crashes: 0, pickups: 0, playSecs: 0, busted: 0 } };
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return newSave();
    const s = JSON.parse(raw);
    return {
      cash: s.cash || 0, respect: s.respect || 0,
      missionUnlocked: s.missionUnlocked || 0,
      ownedCars: Array.isArray(s.ownedCars) && s.ownedCars.length ? s.ownedCars : ['vela'],
      carId: s.carId || 'vela',
      stats: Object.assign(newSave().stats, s.stats || {}),
    };
  } catch (e) { return newSave(); }
}

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash, respect: G.respect, missionUnlocked: G.missionUnlocked,
      ownedCars: G.ownedCars, carId: G.carId, stats: G.stats,
    }));
  } catch (e) { /* storage unavailable (private mode) — game still runs */ }
}

function initGame(canvas) {
  G.rng = makeRng(CITY.seed);
  G.city = genCity(CITY.seed);
  G.renderer = createRenderer(canvas);
  G.audio = createAudio();
  const s = loadSave();
  G.cash = s.cash; G.respect = s.respect; G.missionUnlocked = s.missionUnlocked;
  G.ownedCars = s.ownedCars; G.carId = s.carId; G.stats = s.stats;
  G.missionIdx = Math.min(G.missionUnlocked, MISSIONS.length - 1);
  spawnPlayerCar();
  spawnTraffic();
  G.renderer.buildStatic(G.city);
  bindInput();
  // Idle title-scene camera orbit target: the garage + plaza at golden hour.
  G.player.x = LOCATIONS.garage.x; G.player.z = LOCATIONS.garage.z + 18;
  G.player.onFoot = false;
}

function carDef(id) { return CARS.find((c) => c.id === id) || CARS[0]; }

function spawnPlayerCar() {
  const def = carDef(G.carId);
  G.car = {
    x: LOCATIONS.garage.x + 6, z: LOCATIONS.garage.z + 10,
    yaw: Math.PI, speed: 0, model: def, color: def.color, hp: 100, nitro: 0,
  };
  G.player.x = G.car.x; G.player.z = G.car.z + 4; G.player.onFoot = false;
}

function spawnTraffic() {
  G.traffic = [];
  const lines = [];
  for (let i = -4; i <= 4; i++) lines.push(i * CITY.pitch + CITY.pitch / 2);
  lines.push(-CITY.half, CITY.half);
  const colors = [0xc0392b, 0x2e6f73, 0xe8c98f, 0x36454f, 0xd9d9d9, 0x7d3b26, 0x3d5a4c, 0xb03a2e];
  for (let i = 0; i < 12; i++) {
    const alongX = G.rng.chance(0.5);
    const s = lines[G.rng.int(0, lines.length - 1)];
    const t = G.rng.range(-320, 320);
    G.traffic.push({
      x: alongX ? t : s, z: alongX ? s : t,
      yaw: alongX ? (G.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (G.rng.chance(0.5) ? 0 : Math.PI),
      speed: G.rng.range(7, 12), axis: alongX ? 'x' : 'z', dir: G.rng.chance(0.5) ? 1 : -1,
      color: colors[G.rng.int(0, colors.length - 1)], parked: false, escort: false, escortHp: 0, wrecked: false,
    });
  }
}

// ---------- input ----------

function bindInput() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    G.keys[e.key.toLowerCase()] = true;
    G.audio.ensure(); G.audio.resume();
    if (e.key === 'Enter' && G.screen === 'title') startPlaying();
    else if (e.key === 'Enter' && G.screen === 'busted') respawn();
    else if (e.key === 'Enter' && G.screen === 'complete') { G.screen = 'play'; hideOverlays(); }
    else if (e.key === 'Escape' && G.screen === 'play') pauseGame(true);
    else if (e.key === 'Escape' && G.screen === 'paused') pauseGame(false);
    else if (G.screen === 'play') {
      if (e.key.toLowerCase() === 'e') interact();
      if (e.key.toLowerCase() === 'g') toggleGarage();
      if (e.key.toLowerCase() === 'q') { const st = G.audio.cycleStation(); toast('Radio: ' + st.name); }
      if (e.key.toLowerCase() === 'm') toggleMissionPanel();
      if (e.key === '1') useCrew('rui');
      if (e.key === '2') useCrew('tomas');
      if (e.key === '3') useCrew('ines');
      if (e.key.toLowerCase() === 'r') resetToRoad();
    }
  });
  window.addEventListener('keyup', (e) => { G.keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { G.keys = {}; });
  const cv = document.getElementById('game');
  cv.addEventListener('pointerdown', () => { G.audio.ensure(); G.audio.resume(); });
}

function startPlaying() {
  G.screen = 'play';
  hideOverlays();
  showDialogue([['NADIA', 'Cabo Lume. Golden hour. My city — and Malta thinks he owns it.'], ['RUI', 'Press E near the “!” marker to start a job. WASD to drive, E to get in and out.']]);
  G.audio.ensure(); G.audio.resume(); G.audio.success();
}

function pauseGame(on) {
  G.screen = on ? 'paused' : 'play';
  document.getElementById('pause-screen').classList.toggle('hidden', !on);
  document.getElementById('hud').classList.toggle('hidden', on);
}

function hideOverlays() {
  for (const id of ['title-screen', 'pause-screen', 'busted-screen', 'complete-screen', 'garage-panel', 'mission-panel']) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }
  document.getElementById('hud').classList.remove('hidden');
}

// ---------- interaction ----------

function interact() {
  const p = G.player;
  if (G.dialogue.active) { advanceDialogue(); return; }
  // Mission marker: start next mission.
  if (!G.mission && dist2d(p.x, p.z, LOCATIONS.garage.x, LOCATIONS.garage.z) < 14) {
    if (G.missionIdx < MISSIONS.length) { startMission(G.missionIdx); return; }
  }
  if (p.onFoot) {
    // Enter nearest car (own, parked, or traffic — jacking traffic adds heat).
    let best = null, bd = 5;
    const cands = [G.car].concat(G.traffic.filter((t) => !t.wrecked));
    for (const c of cands) {
      const d = dist2d(p.x, p.z, c.x, c.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) {
      if (best !== G.car) {
        // Jack it: old car becomes parked traffic, this one becomes the player's.
        const old = G.car;
        G.traffic.push({ x: old.x, z: old.z, yaw: old.yaw, speed: 0, axis: 'x', dir: 1, color: old.color, parked: true, escort: false, escortHp: 0, wrecked: false });
        const idx = G.traffic.indexOf(best);
        if (idx >= 0) G.traffic.splice(idx, 1);
        G.car = { x: best.x, z: best.z, yaw: best.yaw, speed: 0, model: carDef('vela'), color: best.color, hp: 100, nitro: 0 };
        addHeat(8);
        toast('Carjacked! CLPD noticed — +heat');
        G.audio.crash();
      }
      p.onFoot = false;
      p.x = G.car.x; p.z = G.car.z;
      G.audio.click();
    }
  } else {
    p.onFoot = true;
    p.x = G.car.x + Math.sin(G.car.yaw + Math.PI / 2) * 2.4;
    p.z = G.car.z + Math.cos(G.car.yaw + Math.PI / 2) * 2.4;
    p.yaw = G.car.yaw;
    G.car.speed = 0;
  }
}

function resetToRoad() {
  const rp = nearestRoadPoint(G.car.x, G.car.z);
  G.car.x = rp.x; G.car.z = rp.z; G.car.speed = 0;
  if (G.player.onFoot) { G.player.x = rp.x; G.player.z = rp.z; }
  toast('Back on the road');
}

// ---------- crew ----------

function useCrew(id) {
  if (G.crewCd[id] > 0) { toast(CREW.find((c) => c.id === id).name + ' recharging… ' + Math.ceil(G.crewCd[id]) + 's'); return; }
  const def = CREW.find((c) => c.id === id);
  if (id === 'rui') {
    G.heat = Math.max(0, G.heat - 20);
    toast('RUI: Ghost Signal — one star scrubbed from the scanner');
    burst(G.player.x, 2, G.player.z, 0x7fd4ff, 26, 6);
  } else if (id === 'tomas') {
    G.car.nitro = 4;
    toast('TOMÁS: Nitro Rush — hold on!');
    burst(G.car.x, 1, G.car.z, 0xff9a3c, 20, 5);
    G.audio.pickup();
  } else if (id === 'ines') {
    G.car.hp = 100;
    let best = null, bd = 30;
    for (const c of G.cops) { const d = dist2d(G.car.x, G.car.z, c.x, c.z); if (d < bd) { bd = d; best = c; } }
    if (best) { best.x += (best.x - G.car.x) * 0.6; best.z += (best.z - G.car.z) * 0.6; best.speed = 0; burst(best.x, 1.5, best.z, 0xff5c5c, 30, 7); }
    toast('INÊS: Pit Fix — car repaired, nearest cop shoved off');
    G.audio.success();
  }
  G.crewCd[id] = def.cd;
  G.audio.click();
}

// ---------- particles / juice ----------

function burst(x, y, z, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = G.rng.next() * Math.PI * 2, e = G.rng.next() * Math.PI - Math.PI / 2;
    const s = (speed || 5) * (0.4 + G.rng.next() * 0.8);
    G.particles.push({
      x, y, z,
      vx: Math.cos(a) * Math.cos(e) * s, vy: Math.abs(Math.sin(e)) * s + 2, vz: Math.sin(a) * Math.cos(e) * s,
      life: 0, max: 0.5 + G.rng.next() * 0.7, color, size: 0.25 + G.rng.next() * 0.35,
    });
  }
  if (G.particles.length > 420) G.particles.splice(0, G.particles.length - 420);
}

function addShake(amount) { G.trauma = Math.min(1, G.trauma + amount); }
function addHeat(n) { G.heat = clamp(G.heat + n, 0, 100); }

// ---------- missions ----------

function startMission(i) {
  const def = MISSIONS[i];
  G.mission = { def, stageIdx: 0, state: { elapsed: 0, smashCount: 0, pickCount: 0, tailTime: 0, tailSeen: false }, active: true };
  G.missionIdx = i;
  G.heat = Math.max(G.heat, def.wanted * 15);
  showDialogue(def.intro);
  setupStage();
  toast(def.act + ' — ' + def.name);
  G.audio.success();
}

function stageLoc(stage) {
  const loc = LOCATIONS[stage.loc] || LOCATIONS.plaza;
  return loc;
}

function setupStage() {
  const m = G.mission, stage = m.def.stages[m.stageIdx];
  const loc = stageLoc(stage);
  m.state = { elapsed: 0, smashCount: 0, pickCount: 0, tailTime: 0, tailSeen: false };
  G.pickups = []; G.tailTarget = null; G.rival = null; G.waypoint = { x: loc.x, z: loc.z, label: loc.name };
  G.spottedTimer = 0; G.lostTimer = 0;
  if (stage.kind === 'pickup' && stage.count) {
    for (let i = 0; i < stage.count; i++) {
      G.pickups.push({ x: loc.x + (i - 1) * 8 + G.rng.range(-3, 3), z: loc.z + G.rng.range(-6, 6), kind: 'crate', taken: false, spin: G.rng.next() * 6 });
    }
  } else if (stage.kind === 'pickup') {
    G.pickups.push({ x: loc.x, z: loc.z, kind: stage.loc === 'mercado' ? 'ledger' : 'cash', taken: false, spin: 0 });
  }
  if (stage.kind === 'tail') {
    const from = LOCATIONS.hotel;
    G.tailTarget = { x: from.x, z: from.z, yaw: Math.PI / 2, speed: 8, color: 0x8c2f2f, arrived: false };
    G.waypoint = { x: from.x, z: from.z, label: 'Informant' };
  }
  if (stage.kind === 'smash' && m.def.id === 'm04') {
    // handled by race setup below
  }
  if (m.def.id === 'm04' && stage.kind === 'deliver') {
    G.rival = { x: LOCATIONS.beach.x, z: LOCATIONS.beach.z, yaw: 0, speed: 0, color: 0x8c2f2f, done: false };
  }
  if ((m.def.id === 'm07' || m.def.id === 'm11') && stage.kind === 'smash') {
    const n = stage.count || 3;
    for (let i = 0; i < n; i++) {
      G.traffic.push({
        x: loc.x + G.rng.range(-30, 30), z: loc.z + G.rng.range(-30, 30),
        yaw: G.rng.next() * Math.PI * 2, speed: 9, axis: 'x', dir: 1,
        color: 0x1c1c22, parked: false, escort: true, escortHp: 2, wrecked: false,
      });
    }
  }
  updateMissionHUD();
}

function failStage(reason) {
  toast(reason + ' — stage restarted');
  G.audio.busted();
  setupStage();
}

function advanceStage() {
  const m = G.mission;
  G.audio.pickup();
  m.stageIdx++;
  if (m.stageIdx >= m.def.stages.length) { completeMission(); return; }
  const stage = m.def.stages[m.stageIdx];
  showDialogue([[m.def.giver, stage.text]]);
  setupStage();
}

function completeMission() {
  const m = G.mission;
  G.cash += m.def.cash;
  G.respect += m.def.respect;
  G.missionUnlocked = Math.max(G.missionUnlocked, G.missionIdx + 1);
  G.mission = null; G.pickups = []; G.tailTarget = null; G.rival = null;
  G.waypoint = null;
  const next = Math.min(G.missionIdx + 1, MISSIONS.length - 1);
  G.missionIdx = next;
  saveGame();
  G.audio.success();
  burst(G.player.x, 2, G.player.z, 0xffd24a, 60, 9);
  const el = document.getElementById('complete-screen');
  document.getElementById('complete-title').textContent = 'JOB DONE — ' + m.def.name;
  document.getElementById('complete-sub').textContent = '+' + fmtCash(m.def.cash) + '  ·  +' + m.def.respect + ' respect  ·  Rank: ' + rankFor(G.respect);
  el.classList.remove('hidden');
  G.screen = 'complete';
  updateHUDStatic();
}

// ---------- wanted / police ----------

function targetCopCount() {
  if (G.stars === 0) return 0;
  return Math.min(6, G.stars + (G.stars >= 2 ? 1 : 0));
}

function spawnCop() {
  const a = G.rng.next() * Math.PI * 2;
  const d = 70 + G.rng.next() * 30;
  const rp = nearestRoadPoint(G.player.x + Math.cos(a) * d, G.player.z + Math.sin(a) * d);
  const callsign = CALLSIGNS[G.cops.length % CALLSIGNS.length];
  G.cops.push({ x: rp.x, z: rp.z, yaw: G.rng.next() * Math.PI * 2, speed: 0, callsign, role: 'CHASE', stuck: 0 });
}

function updatePolice(dt) {
  const want = targetCopCount();
  while (G.cops.length < want) spawnCop();
  if (G.cops.length > want) G.cops.splice(want);
  const roles = dispatchRoles(G.stars, G.cops.length);
  const px = G.player.x, pz = G.player.z;
  const pvx = G.player.onFoot ? 0 : Math.sin(G.car.yaw) * G.car.speed;
  const pvz = G.player.onFoot ? 0 : Math.cos(G.car.yaw) * G.car.speed;
  for (let i = 0; i < G.cops.length; i++) {
    const c = G.cops[i];
    c.role = roles[i] || 'CHASE';
    let tx = px, tz = pz;
    if (c.role === 'RAMMING') { tx = px + pvx * 0.45; tz = pz + pvz * 0.45; }
    else if (c.role === 'FLANKING') {
      const rp = nearestRoadPoint(px + pvx * 2.2, pz + pvz * 2.2);
      tx = rp.x; tz = rp.z;
    } else if (c.role === 'ROADBLOCK') {
      // Hold a blocking line ahead of the player on their road.
      const rp = nearestRoadPoint(px + pvx * 1.6, pz + pvz * 1.6);
      tx = rp.x; tz = rp.z;
    }
    const dx = tx - c.x, dz = tz - c.z;
    const dist = Math.hypot(dx, dz) || 1;
    const wantYaw = Math.atan2(dx, dz);
    c.yaw = angleLerp(c.yaw, wantYaw, Math.min(1, 2.4 * dt));
    const maxSp = 26 + G.stars * 2.5;
    c.speed = clamp(c.speed + (dist > 8 ? 14 : -20) * dt, 0, maxSp);
    c.x += Math.sin(c.yaw) * c.speed * dt;
    c.z += Math.cos(c.yaw) * c.speed * dt;
    const col = collideCircleBuildings(G.city, c.x, c.z, 1.6);
    if (col.hit) { c.x = col.x; c.z = col.z; c.speed *= 0.4; }
    const cl = clampToWorld(c.x, c.z, 2);
    c.x = cl.x; c.z = cl.z;
    if (c.speed < 0.5) c.stuck += dt; else c.stuck = 0;
    if (c.stuck > 2.5) { const a = G.rng.next() * Math.PI * 2; const rp = nearestRoadPoint(px + Math.cos(a) * 60, pz + Math.sin(a) * 60); c.x = rp.x; c.z = rp.z; c.stuck = 0; }
    // Ram the player.
    const pd = dist2d(c.x, c.z, px, pz);
    if (pd < 3.4) {
      if (!G.player.onFoot) {
        G.car.hp -= 6; G.car.speed *= 0.55; c.speed *= 0.4;
        burst(px, 1.2, pz, 0xffd24a, 18, 6);
        addShake(0.45); G.hitStop = 0.06; G.audio.crash(); G.stats.crashes++;
        addHeat(4);
      } else {
        if (!G.shotGod) G.player.hp -= 12;
        addShake(0.5); G.audio.crash();
        if (G.player.hp <= 0) bustPlayer();
      }
    }
  }
  // Roadblocks at 4+ stars.
  if (G.stars >= 4 && G.roadblocks.length < 2) {
    const rp = nearestRoadPoint(px + pvx * 2.6, pz + pvz * 2.6);
    const along = Math.abs(px - rp.x) < Math.abs(pz - rp.z) ? 'z' : 'x';
    G.roadblocks.push({ x: rp.x, z: rp.z, yaw: along === 'x' ? 0 : Math.PI / 2 });
  }
  if (G.stars < 4) G.roadblocks = [];
  // Roadblock smash / block.
  for (let i = G.roadblocks.length - 1; i >= 0; i--) {
    const rb = G.roadblocks[i];
    const d = dist2d(rb.x, rb.z, G.car.x, G.car.z);
    if (!G.player.onFoot && d < 4.2) {
      if (Math.abs(G.car.speed) > 10) {
        G.roadblocks.splice(i, 1);
        burst(rb.x, 1.5, rb.z, 0xff7a3c, 40, 8);
        G.audio.explosion(); addShake(0.7); G.hitStop = 0.09; G.stats.crashes++;
        if (G.mission) { G.mission.state.smashCount++; toast('Roadblock smashed!'); }
      } else {
        G.car.speed *= 0.2; G.car.hp -= 4; G.audio.crash(); addShake(0.4);
      }
    }
  }
  // Helicopter at 3+ stars.
  if (G.stars >= 3) {
    G.heli.active = true;
    G.heli.angle += dt * 0.32;
    G.heli.x = px + Math.cos(G.heli.angle) * 34;
    G.heli.z = pz + Math.sin(G.heli.angle) * 34;
    G.heli.lit = dist2d(G.heli.x, G.heli.z, px, pz) < 70;
  } else {
    G.heli.active = false; G.heli.lit = false;
  }
}

function updateWanted(dt) {
  // Heat decay: fast when unseen, slow under the spotlight.
  let nearCop = false;
  for (const c of G.cops) if (dist2d(c.x, c.z, G.player.x, G.player.z) < 55) { nearCop = true; break; }
  if (!nearCop && !G.heli.lit) G.heat = Math.max(0, G.heat - 3.2 * dt);
  else if (G.heli.lit) G.heat = Math.max(0, G.heat - 0.5 * dt);
  else G.heat = Math.max(0, G.heat - 0.8 * dt);
  G.stars = starsForHeat(G.heat);
}

function bustPlayer() {
  if (G.shotGod) return; // screenshot staging never busts
  G.stats.busted++;
  G.screen = 'busted';
  document.getElementById('busted-screen').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
  G.audio.busted();
  saveGame();
}

function respawn() {
  G.heat = 0; G.stars = 0; G.cops = []; G.roadblocks = [];
  G.cash = Math.max(0, G.cash - 300);
  G.player.hp = 100; G.car.hp = 100;
  spawnPlayerCar();
  G.screen = 'play';
  hideOverlays();
  toast('Back at Farol Garage — the city forgets, for $300');
}

// ---------- driving / on-foot ----------

function updatePlayer(dt) {
  const k = G.keys;
  const p = G.player;
  if (p.onFoot) {
    let mx = 0, mz = 0;
    const fwd = [Math.sin(p.yaw), Math.cos(p.yaw)];
    const right = [Math.cos(p.yaw), -Math.sin(p.yaw)];
    if (k['w'] || k['arrowup']) { mx += fwd[0]; mz += fwd[1]; }
    if (k['s'] || k['arrowdown']) { mx -= fwd[0]; mz -= fwd[1]; }
    if (k['a'] || k['arrowleft']) { mx -= right[0]; mz -= right[1]; }
    if (k['d'] || k['arrowright']) { mx += right[0]; mz += right[1]; }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      const sp = (k['shift'] ? 9 : 5.5);
      p.x += (mx / len) * sp * dt; p.z += (mz / len) * sp * dt;
      p.yaw = angleLerp(p.yaw, Math.atan2(mx, mz), Math.min(1, 10 * dt));
      p.walkPhase += dt * sp * 1.4;
      p.speed = sp;
    } else p.speed = 0;
    const col = collideCircleBuildings(G.city, p.x, p.z, 0.7);
    p.x = col.x; p.z = col.z;
    const cl = clampToWorld(p.x, p.z, 2);
    p.x = cl.x; p.z = cl.z;
    // Busted on foot: a cop close for 2s.
    let near = false;
    for (const c of G.cops) if (dist2d(c.x, c.z, p.x, p.z) < 5) { near = true; break; }
    if (near && G.stars > 0 && !G.shotGod) {
      G.bustedTimer += dt;
      if (G.bustedTimer > 2) { G.bustedTimer = 0; bustPlayer(); }
    } else G.bustedTimer = 0;
    return;
  }
  const car = G.car;
  const fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw);
  const nitro = car.nitro > 0 ? 1.45 : 0;
  if (car.nitro > 0) car.nitro -= dt;
  const top = car.model.top * (nitro ? 1.45 : 1);
  if (k['w'] || k['arrowup']) car.speed += car.model.accel * (nitro ? 1.5 : 1) * dt;
  if (k['s'] || k['arrowdown']) car.speed -= (car.speed > 0.5 ? 26 : 10) * dt;
  if (k[' ']) car.speed *= Math.max(0, 1 - 2.6 * dt); // handbrake
  car.speed -= car.speed * 0.35 * dt; // drag
  car.speed = clamp(car.speed, -12, top);
  const steerInput = ((k['a'] || k['arrowleft']) ? 1 : 0) - ((k['d'] || k['arrowright']) ? 1 : 0);
  const spdF = clamp(Math.abs(car.speed) / 14, 0, 1);
  const grip = car.model.grip * (k[' '] ? 1.7 : 1);
  car.yaw += steerInput * 1.9 * spdF * grip * dt * (car.speed >= 0 ? 1 : -1);
  const nx = car.x + fwdX * car.speed * dt;
  const nz = car.z + fwdZ * car.speed * dt;
  const before = { x: car.x, z: car.z };
  const col = collideCircleBuildings(G.city, nx, nz, 1.7);
  car.x = col.x; car.z = col.z;
  if (col.hit && Math.abs(car.speed) > 9) {
    car.hp -= Math.abs(car.speed) * 0.35;
    burst(car.x, 1, car.z, 0xffd24a, 16, 5);
    addShake(0.4); G.audio.crash(); G.stats.crashes++; addHeat(2);
    car.speed *= 0.45;
  }
  const cl = clampToWorld(car.x, car.z, 2);
  car.x = cl.x; car.z = cl.z;
  G.stats.distance += dist2d(before.x, before.z, car.x, car.z);
  p.x = car.x; p.z = car.z; p.yaw = car.yaw; p.speed = Math.abs(car.speed);
  if (car.hp <= 0 && G.shotGod) { car.hp = 100; car.speed *= 0.5; } // staging never wrecks
  else if (car.hp <= 0) {
    // Wrecked: car burns, Nadia bails out on foot.
    const wx = car.x + 3, wz = car.z + 3;
    burst(car.x, 1.5, car.z, 0xff7a3c, 50, 9);
    G.audio.explosion(); addShake(0.8);
    // Leave a smoking wreck behind as parked traffic.
    G.traffic.push({ x: car.x, z: car.z, yaw: car.yaw, speed: 0, axis: 'x', dir: 1, color: 0x1c1c22, parked: true, escort: false, escortHp: 0, wrecked: true });
    spawnPlayerCar();
    G.player.onFoot = true;
    G.player.x = wx; G.player.z = wz; G.player.yaw = car.yaw;
    toast('Car wrecked! Nadia bailed out — new GT at the garage');
  }
  // Skid puffs when handbraking at speed.
  if (k[' '] && Math.abs(car.speed) > 12 && G.rng.chance(0.5)) {
    G.particles.push({ x: car.x - fwdX * 2, y: 0.3, z: car.z - fwdZ * 2, vx: 0, vy: 0.6, vz: 0, life: 0, max: 0.6, color: 0xcccccc, size: 0.5 });
  }
}

function updateTraffic(dt) {
  for (const t of G.traffic) {
    if (t.parked || t.wrecked) continue;
    // Move along its axis; at intersections sometimes turn (seeded).
    const step = t.speed * t.dir * dt;
    if (t.axis === 'x') t.x += step; else t.z += step;
    const lines = [];
    for (let i = -4; i <= 4; i++) lines.push(i * CITY.pitch + CITY.pitch / 2);
    lines.push(-CITY.half, CITY.half);
    const onLine = (v) => lines.some((s) => Math.abs(v - s) < 1.2);
    if ((t.axis === 'x' && onLine(t.z)) || (t.axis === 'z' && onLine(t.x))) {
      if (G.rng.chance(0.004)) {
        const alongX = t.axis === 'z';
        t.axis = alongX ? 'x' : 'z';
        t.dir = G.rng.chance(0.5) ? 1 : -1;
        t.yaw = alongX ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (t.dir > 0 ? 0 : Math.PI);
      }
    }
    // Keep on the road line and inside the city.
    if (t.axis === 'x') {
      let best = lines[0]; for (const s of lines) if (Math.abs(t.z - s) < Math.abs(t.z - best)) best = s;
      t.z = best;
      if (t.x > CITY.half - 6) { t.dir = -1; t.yaw = -Math.PI / 2; }
      if (t.x < -CITY.half + 6) { t.dir = 1; t.yaw = Math.PI / 2; }
    } else {
      let best = lines[0]; for (const s of lines) if (Math.abs(t.x - s) < Math.abs(t.x - best)) best = s;
      t.x = best;
      if (t.z > CITY.half - 6) { t.dir = -1; t.yaw = Math.PI; }
      if (t.z < -CITY.half + 6) { t.dir = 1; t.yaw = 0; }
    }
    // Collision with the player's car.
    const pd = dist2d(t.x, t.z, G.player.x, G.player.z);
    if (!G.player.onFoot && pd < 3.6) {
      const rel = Math.abs(G.car.speed - t.speed);
      if (rel > 7) {
        if (t.escort) {
          t.escortHp--;
          burst(t.x, 1.5, t.z, 0xffd24a, 24, 7);
          addShake(0.5); G.audio.crash(); G.stats.crashes++;
          if (t.escortHp <= 0) {
            t.wrecked = true; t.speed = 0;
            if (G.mission) { G.mission.state.smashCount++; toast('Escort down!'); }
            burst(t.x, 1.5, t.z, 0xff7a3c, 40, 8);
            G.audio.explosion();
          }
        } else {
          addHeat(3);
          burst(t.x, 1.2, t.z, 0xffd24a, 14, 5);
          G.audio.crash(); addShake(0.35); G.stats.crashes++;
        }
        G.car.speed *= 0.6;
        // Shove the traffic car aside.
        t.x += (t.x - G.player.x) * 0.4; t.z += (t.z - G.player.z) * 0.4;
      } else {
        G.car.speed *= 0.85;
      }
    }
  }
}

function updateMission(dt) {
  const m = G.mission;
  if (!m) return;
  const st = m.state;
  st.elapsed += dt;
  const stage = m.def.stages[m.stageIdx];
  const loc = stageLoc(stage);
  const px = G.player.x, pz = G.player.z;
  const distToTarget = dist2d(px, pz, loc.x, loc.z);
  // Pickups.
  for (const pk of G.pickups) {
    pk.spin += dt * 3;
    if (!pk.taken && dist2d(px, pz, pk.x, pk.z) < 4) {
      pk.taken = true; st.pickCount++;
      G.stats.pickups++;
      burst(pk.x, 1.5, pk.z, 0xffd24a, 22, 6);
      G.audio.coin();
      popText('+$' + (stage.kind === 'pickup' ? 150 : 100), pk.x, pk.z);
    }
  }
  // Tail target drives hotel -> mercado.
  if (G.tailTarget) {
    const tt = G.tailTarget;
    if (!tt.arrived) {
      const tx = LOCATIONS.mercado.x, tz = LOCATIONS.mercado.z;
      const dx = tx - tt.x, dz = tz - tt.z;
      const d = Math.hypot(dx, dz);
      if (d < 8) { tt.arrived = true; }
      else {
        tt.yaw = angleLerp(tt.yaw, Math.atan2(dx, dz), Math.min(1, 1.5 * dt));
        tt.x += Math.sin(tt.yaw) * tt.speed * dt;
        tt.z += Math.cos(tt.yaw) * tt.speed * dt;
      }
    }
    const td = dist2d(px, pz, tt.x, tt.z);
    st.tailDist = td;
    if (td < 9) {
      st.tailSeen = true; G.spottedTimer += dt;
      if (G.spottedTimer > 2) { failStage('Spotted! The informant burned you'); return; }
    } else { st.tailSeen = false; G.spottedTimer = 0; }
    if (td > 70) {
      G.lostTimer += dt;
      if (G.lostTimer > 4) { failStage('Lost the informant'); return; }
    } else G.lostTimer = 0;
    if (td > 10 && td < 55) st.tailTime += dt;
    st.tailDone = tt.arrived && st.tailTime > 18;
    G.waypoint = { x: tt.x, z: tt.z, label: 'Informant' };
  }
  // Rival racer (m04).
  if (G.rival) {
    const r = G.rival;
    if (!r.done) {
      const tx = LOCATIONS.stadium.x, tz = LOCATIONS.stadium.z;
      const dx = tx - r.x, dz = tz - r.z;
      const d = Math.hypot(dx, dz);
      if (d < 10) { r.done = true; failStage('Rico beat you to the stadium'); return; }
      r.yaw = angleLerp(r.yaw, Math.atan2(dx, dz), Math.min(1, 2 * dt));
      r.speed = 26;
      r.x += Math.sin(r.yaw) * r.speed * dt;
      r.z += Math.cos(r.yaw) * r.speed * dt;
    }
  }
  // Stage check.
  const s = {
    x: px, z: pz, distToTarget,
    nearTarget: distToTarget < (stage.kind === 'goto' ? 10 : stage.kind === 'pickup' ? 12 : 12),
    stars: G.stars, heat: G.heat, elapsed: st.elapsed,
    smashCount: st.smashCount, pickCount: st.pickCount,
    tailDist: st.tailDist || 0, tailSeen: st.tailSeen, tailDone: st.tailDone, tailTime: st.tailTime,
  };
  let res;
  if (stage.kind === 'pickup' && stage.count) {
    res = { done: st.pickCount >= stage.count, progress: Math.min(1, st.pickCount / stage.count), hint: st.pickCount + '/' + stage.count };
  } else if (stage.kind === 'pickup' && G.pickups.length) {
    res = { done: st.pickCount >= 1, progress: st.pickCount >= 1 ? 1 : Math.max(0, 1 - distToTarget / 400), hint: Math.round(distToTarget) + 'm' };
  } else {
    res = checkStage(stage, s);
  }
  if (stage.kind === 'survive' && m.def.id === 'm08') {
    // m08 survive: must keep moving — stalled too long fails the vibe, not the stage.
    if (G.player.speed < 2) st.stall = (st.stall || 0) + dt; else st.stall = 0;
  }
  m.progress = res.progress; m.hint = res.hint;
  if (res.done) advanceStage();
}

// ---------- main loop ----------

let lastT = 0, acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const now = t / 1000;
  let dt = Math.min(0.1, now - (lastT || now));
  lastT = now;
  if (G.shotDone) { renderOnly(); return; } // screenshot mode: frozen frame, fixed clock
  if (G.screen !== 'play') { renderOnly(); return; }
  if (G.hitStop > 0) { G.hitStop -= dt; renderOnly(); return; }
  acc += dt;
  while (acc >= STEP) {
    acc -= STEP;
    tick(STEP);
  }
  renderOnly();
}

function tick(dt) {
  G.time += dt * 0.5; // 1 game hour per 2 real minutes
  G.stats.playSecs += dt;
  for (const k of Object.keys(G.crewCd)) if (G.crewCd[k] > 0) G.crewCd[k] -= dt;
  updatePlayer(dt);
  updateTraffic(dt);
  updatePolice(dt);
  updateWanted(dt);
  updateMission(dt);
  // Particles.
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life += dt;
    if (p.life >= p.max) { G.particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= 9 * dt;
    if (p.y < 0.1) { p.y = 0.1; p.vy *= -0.3; }
  }
  G.trauma = Math.max(0, G.trauma - dt * 1.6);
  G.saveTimer += dt;
  if (G.saveTimer > 15) { G.saveTimer = 0; saveGame(); }
  // Audio.
  G.audio.setEngine(G.player.onFoot ? 0 : Math.abs(G.car.speed) / 50, !G.player.onFoot && G.screen === 'play');
  const nearCop = G.cops.length ? Math.min(...G.cops.map((c) => dist2d(c.x, c.z, G.player.x, G.player.z))) : 999;
  G.audio.setSiren(G.stars > 0, clamp(nearCop / 120, 0, 1));
  G.audio.sirenTick(dt);
  G.audio.radioTick();
  updateHUD();
}

// Expose for shots.js / tests.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { G, STEP, startMission, starsForHeat };
}
