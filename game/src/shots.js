// Cabo Lume — screenshot scenes. Each one plays the real rules forward from a fresh
// seeded state for a fixed number of steps, steered by a simple autopilot (drive at the
// waypoint, brake for nothing), so the frame is what a real chase looks like and the same
// seed always gives the same frame. Shot 1 is the cover: a live 3-star chase, never a
// title screen.
'use strict';

/* global G, STEP, MISSIONS, LOCATIONS, startMission, tick, renderOnly, hideOverlays, updateHUDStatic */

// Fixed virtual clock for shots: every performance.now() visual (rotor, beacon, flashes)
// reads this instead, so two renders of the same shot are byte-identical.
const SHOT_TIME_MS = 42000;

const SHOTS = {
  // 1 — cover: golden-hour 3-star chase, heli spotlight, roadblock ahead, mission live.
  '1': { mission: 5, stage: 2, time: 1040, secs: 16, stars: 3, label: 'chase' },
  // 2 — dusk at the marina: on foot, safe-cracking, 2 stars closing in.
  '2': { mission: 5, stage: 0, time: 1105, secs: 9, stars: 2, label: 'marina', onFoot: true },
  // 3 — night: 5-star vault escape, roadblocks, FALCÃO-1 overhead.
  '3': { mission: 9, stage: 2, time: 1215, secs: 14, stars: 5, label: 'night' },
  // 4 — dawn finale: final run to the lighthouse, 5 stars, first light.
  '4': { mission: 11, stage: 1, time: 352, secs: 15, stars: 5, label: 'dawn' },
};

function resetShotState() {
  G.rng = makeRng('cabo-lume-v5');
  G.shotGod = true; // staging never busts or wrecks the car
  G.cash = 12500; G.respect = 2800;
  G.missionUnlocked = 11;
  G.heat = 0; G.stars = 0; G.cops = []; G.roadblocks = [];
  G.heli = { active: false, angle: 0.7, x: 0, z: 0, y: 52, lit: false };
  G.particles = []; G.trauma = 0; G.hitStop = 0;
  G.crewCd = { rui: 0, tomas: 0, ines: 0 };
  G.player.hp = 100;
  spawnPlayerCar();
  spawnTraffic();
  G.mission = null; G.pickups = []; G.tailTarget = null; G.rival = null; G.waypoint = null;
  G.dialogue.active = false;
  hideOverlays();
  G.screen = 'play';
}

// Steer the car toward the current waypoint, but probe ahead for buildings first:
// a blocked nose steers toward the freer side (road-following), and a dead end reverses.
function autopilotKeys() {
  const keys = { w: true };
  const tgt = G.waypoint || { x: 0, z: 0 };
  const probe = (ang) => {
    const a = G.car.yaw + ang;
    const px = G.car.x + Math.sin(a) * 16, pz = G.car.z + Math.cos(a) * 16;
    return collideCircleBuildings(G.city, px, pz, 2).hit;
  };
  let want;
  if (probe(0)) {
    const leftFree = !probe(0.7), rightFree = !probe(-0.7);
    if (!leftFree && !rightFree) {
      keys['s'] = true; delete keys['w'];
      want = G.car.yaw + 0.9;
    } else if (leftFree && !rightFree) want = G.car.yaw + 0.7;
    else if (rightFree && !leftFree) want = G.car.yaw - 0.7;
    else want = Math.atan2(tgt.x - G.car.x, tgt.z - G.car.z);
  } else {
    want = Math.atan2(tgt.x - G.car.x, tgt.z - G.car.z);
  }
  let d = want - G.car.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > 0.12) keys['a'] = true;
  else if (d < -0.12) keys['d'] = true;
  return keys;
}

function stageShot(name) {
  const spec = SHOTS[name] || SHOTS['1'];
  document.body.classList.add('shot-mode'); // kills CSS animations (star blink) for determinism
  resetShotState();
  G.time = spec.time;
  G.shotMode = spec.label;
  G.shotTime = SHOT_TIME_MS;
  // Start the mission and jump to the requested stage.
  startMission(spec.mission);
  let guard = 0;
  while (G.mission && G.mission.stageIdx < spec.stage) {
    // Fast-forward: put the car exactly on the stage target, max out its counters,
    // and clear heat so even escape stages can complete during the fast-forward.
    const stage = G.mission.def.stages[G.mission.stageIdx];
    const loc = LOCATIONS[stage.loc] || LOCATIONS.plaza;
    G.car.x = loc.x; G.car.z = loc.z;
    G.player.x = G.car.x; G.player.z = G.car.z;
    G.mission.state.smashCount = 99; G.mission.state.pickCount = 99;
    G.mission.state.elapsed = 999;
    G.heat = 0; G.stars = 0;
    tick(STEP);
    if (!G.mission) break;
    if (++guard > 400) break; // never hang the page on a stage that cannot complete
  }
  // Wanted level for the scene.
  G.heat = spec.stars === 5 ? 92 : spec.stars === 3 ? 60 : 40;
  G.stars = spec.stars;
  if (spec.onFoot) {
    G.player.onFoot = true;
    // Park the car at the stage location first, so the on-foot scene is actually
    // at the marina — not back at the garage where the car spawned.
    const wp = G.waypoint || LOCATIONS.marina;
    G.car.x = wp.x - 8; G.car.z = wp.z;
    G.car.yaw = Math.PI / 2;
    // Face east toward the pier, boats and sea so the marina reads in-frame.
    G.player.x = G.car.x - 6; G.player.z = G.car.z + 2;
    G.player.yaw = Math.PI / 2;
    G.car.speed = 0;
  }
  // Play forward with the autopilot so cops, heli and traffic converge on the player.
  const steps = Math.floor(spec.secs / STEP);
  for (let i = 0; i < steps; i++) {
    G.keys = spec.onFoot ? {} : autopilotKeys();
    if (G.screen !== 'play') break;
    tick(STEP);
    if (!G.mission && spec.mission !== undefined) break; // mission completed mid-shot: keep frame
  }
  G.keys = {};
  G.shotDone = true;
  // Fresh paint for the frame: full health bars, no leftover overlays.
  G.car.hp = 100; G.player.hp = 100;
  // Clear any dialogue / overlay the staging may have raised: the shot is the live game.
  hideDialogue();
  const toasts = document.getElementById('toasts'); if (toasts) toasts.innerHTML = '';
  const pops = document.getElementById('pops'); if (pops) pops.innerHTML = '';
  if (G.screen !== 'play') { hideOverlays(); G.screen = 'play'; }
  updateHUDStatic();
  updateHUD();
  renderOnly();
  document.title = 'SHOT-READY-' + name;
  return spec.label;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SHOTS, SHOT_TIME_MS, stageShot };
}
