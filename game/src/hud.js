// Cabo Lume — HUD + menus + the per-frame 3D assembly (camera, dynamic meshes, minimap).
// DOM overlay work lives here; simulation lives in game.js. All written in this session.
'use strict';

/* global G, MISSIONS, CREW, CARS, rankFor, LOCATIONS, CITY */
/* global MeshBuilder, skyFor, carMesh, personMesh, heliMesh, mat4YawPitch, mat4TransformPoint */
/* global dist2d, clamp, lerp, fmtCash, fmtTime */

const $ = (id) => document.getElementById(id);

// ---------- floating helpers ----------

function toast(msg) {
  if (G.shotMode) return; // screenshots must be deterministic: no wall-clock toasts
  const box = $('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3800);
  while (box.children.length > 4) box.firstChild.remove();
}

function popText(text) {
  if (G.shotMode) return; // screenshots must be deterministic: no wall-clock pops
  const box = $('pops');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = text;
  el.style.left = (44 + Math.random() * 12) + '%';
  box.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

// ---------- dialogue ----------

let dialogueTimer = null;
function showDialogue(lines) {
  G.dialogue.lines = lines.slice();
  G.dialogue.idx = 0;
  G.dialogue.active = true;
  $('dialogue-box').classList.remove('hidden');
  renderDialogueLine();
}
function renderDialogueLine() {
  const line = G.dialogue.lines[G.dialogue.idx];
  if (!line) { hideDialogue(); return; }
  $('dialogue-speaker').textContent = line[0];
  const textEl = $('dialogue-text');
  textEl.textContent = '';
  const full = line[1];
  let i = 0;
  clearInterval(dialogueTimer);
  dialogueTimer = setInterval(() => {
    i += 2;
    textEl.textContent = full.slice(0, i);
    if (i >= full.length) { clearInterval(dialogueTimer); dialogueTimer = null; }
  }, 18);
}
function advanceDialogue() {
  const line = G.dialogue.lines[G.dialogue.idx];
  const textEl = $('dialogue-text');
  if (dialogueTimer && textEl.textContent.length < line[1].length) {
    clearInterval(dialogueTimer); dialogueTimer = null;
    textEl.textContent = line[1];
    return;
  }
  G.dialogue.idx++;
  if (G.dialogue.idx >= G.dialogue.lines.length) hideDialogue();
  else renderDialogueLine();
}
function hideDialogue() {
  clearInterval(dialogueTimer); dialogueTimer = null;
  G.dialogue.active = false;
  $('dialogue-box').classList.add('hidden');
}

// ---------- HUD ----------

function starString(n) {
  let s = '';
  for (let i = 0; i < 5; i++) s += i < n ? '★' : '☆';
  return s;
}

function updateHUDStatic() {
  $('cash').textContent = fmtCash(G.cash);
  $('respect-rank').textContent = rankFor(G.respect);
  const next = [400, 1200, 2600, 5000].find((t) => G.respect < t);
  const prev = [0, 400, 1200, 2600, 5000].filter((t) => G.respect >= t).pop() || 0;
  $('respect-fill').style.width = next ? Math.round(((G.respect - prev) / (next - prev)) * 100) + '%' : '100%';
  $('respect-num').textContent = G.respect + (next ? ' / ' + next : ' MAX');
  $('clock').textContent = fmtTime(G.time);
}

function updateMissionHUD() {
  const m = G.mission;
  if (!m) {
    $('mission-title').textContent = 'FREE ROAM — CABO LUME';
    $('mission-act').textContent = G.missionIdx < MISSIONS.length ? 'Next: ' + MISSIONS[G.missionIdx].name : 'All jobs done';
    $('mission-objective').textContent = 'Drive to the “!” at Farol Garage (E) to start the next job';
    $('mission-bar-fill').style.width = '0%';
    $('mission-hint').textContent = 'WASD drive · E enter/exit · G garage · Q radio · 1/2/3 crew';
    return;
  }
  const stage = m.def.stages[m.stageIdx];
  $('mission-title').textContent = (m.stageIdx + 1) + '/' + m.def.stages.length + ' — ' + m.def.name;
  $('mission-act').textContent = m.def.act + ' · ' + m.def.giver;
  $('mission-objective').textContent = stage.text;
  $('mission-bar-fill').style.width = Math.round((m.progress || 0) * 100) + '%';
  $('mission-hint').textContent = m.hint || stage.bar;
}

function updateHUD() {
  updateHUDStatic();
  $('stars').textContent = starString(G.stars);
  $('stars').className = 'stars heat-' + G.stars;
  $('heat-fill').style.width = G.heat + '%';
  $('speed').textContent = G.player.onFoot ? Math.round(G.player.speed * 3.6) : Math.round(Math.abs(G.car.speed) * 3.6);
  $('speed-unit').textContent = 'km/h';
  $('car-hp-fill').style.width = Math.max(0, G.car.hp) + '%';
  $('player-hp-fill').style.width = Math.max(0, G.player.hp) + '%';
  $('radio-name').textContent = G.audio ? G.audio.station().name : '—';
  $('car-name').textContent = G.player.onFoot ? 'ON FOOT' : G.car.model.name;
  $('nitro-fill').style.width = G.car.nitro > 0 ? Math.round((G.car.nitro / 4) * 100) + '%' : '0%';
  // Dispatch panel.
  const dl = $('dispatch-list');
  const rows = [];
  for (const c of G.cops) {
    const d = Math.round(dist2d(c.x, c.z, G.player.x, G.player.z));
    rows.push(`<div class="disp-row"><span class="disp-call">${c.callsign}</span><span class="disp-role ${c.role.toLowerCase()}">${c.role}</span><span class="disp-dist">${d}m</span></div>`);
  }
  if (G.heli.active) rows.push(`<div class="disp-row heli"><span class="disp-call">FALCÃO-1</span><span class="disp-role spotlight">SPOTLIGHT</span><span class="disp-dist">AIR</span></div>`);
  if (G.stars >= 4) rows.push(`<div class="disp-row"><span class="disp-call">CL-BLOCK</span><span class="disp-role roadblock">ROADBLOCK</span><span class="disp-dist">${G.roadblocks.length} up</span></div>`);
  if (!rows.length) rows.push('<div class="disp-row quiet">Scanner quiet — Cabo Lume sleeps</div>');
  dl.innerHTML = rows.join('');
  // Crew cards.
  for (const c of CREW) {
    const el = $('crew-' + c.id);
    if (!el) continue;
    const cd = G.crewCd[c.id] || 0;
    el.querySelector('.crew-cd').style.height = cd > 0 ? Math.round((cd / c.cd) * 100) + '%' : '0%';
    el.querySelector('.crew-cd-label').textContent = cd > 0 ? Math.ceil(cd) + 's' : 'READY';
    el.classList.toggle('ready', cd <= 0);
  }
  updateMissionHUD();
  drawMinimap();
}

// ---------- minimap ----------

function drawMinimap() {
  const cv = $('minimap');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const scale = W / (CITY.half * 2 + 60);
  const toX = (x) => (x + CITY.half + 30) * scale;
  const toY = (z) => (z + CITY.half + 30) * scale;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#101623';
  ctx.fillRect(0, 0, W, H);
  // Sea (east).
  ctx.fillStyle = '#1d4e66';
  ctx.fillRect(toX(CITY.waterX), 0, W - toX(CITY.waterX), H);
  ctx.fillStyle = '#c9a86a';
  ctx.fillRect(toX(CITY.beachX), 0, toX(CITY.waterX) - toX(CITY.beachX), H);
  // Roads.
  ctx.strokeStyle = '#3d4454';
  ctx.lineWidth = 2;
  for (let i = -4; i <= 4; i++) {
    const s = i * CITY.pitch + CITY.pitch / 2;
    ctx.beginPath(); ctx.moveTo(toX(s), 0); ctx.lineTo(toX(s), H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, toY(s)); ctx.lineTo(W, toY(s)); ctx.stroke();
  }
  // Waypoint.
  if (G.waypoint) {
    ctx.fillStyle = '#ffd24a';
    const x = toX(G.waypoint.x), y = toY(G.waypoint.z);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-4, -4, 8, 8); ctx.restore();
  }
  // Pickups.
  ctx.fillStyle = '#ff9a3c';
  for (const pk of G.pickups) if (!pk.taken) { ctx.beginPath(); ctx.arc(toX(pk.x), toY(pk.z), 2.5, 0, 7); ctx.fill(); }
  // Cops.
  ctx.fillStyle = '#4a90ff';
  for (const c of G.cops) { ctx.beginPath(); ctx.arc(toX(c.x), toY(c.z), 3, 0, 7); ctx.fill(); }
  // Heli.
  if (G.heli.active) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(toX(G.heli.x), toY(G.heli.z), 3, 0, 7); ctx.fill();
  }
  // Player arrow.
  const px = toX(G.player.x), py = toY(G.player.z);
  ctx.save(); ctx.translate(px, py); ctx.rotate(G.player.yaw);
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------- menus ----------

function buildGaragePanel() {
  const list = $('garage-list');
  list.innerHTML = CARS.map((c) => {
    const owned = G.ownedCars.includes(c.id);
    const sel = G.carId === c.id;
    const btn = !owned
      ? `<button data-buy="${c.id}" ${G.cash < c.price ? 'disabled' : ''}>BUY ${fmtCash(c.price)}</button>`
      : (sel ? '<button disabled>EQUIPPED</button>' : `<button data-select="${c.id}">DRIVE IT</button>`);
    return `<div class="garage-row ${sel ? 'sel' : ''}">
      <span class="garage-color" style="background:#${c.color.toString(16).padStart(6, '0')}"></span>
      <span class="garage-name">${c.name}<small>${c.desc} · Top ${Math.round(c.top * 3.6)} km/h</small></span>
      ${btn}</div>`;
  }).join('');
  list.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
    const car = CARS.find((c) => c.id === b.dataset.buy);
    if (G.cash < car.price) return;
    G.cash -= car.price;
    G.ownedCars.push(car.id);
    G.carId = car.id;
    spawnPlayerCar();
    saveGame(); buildGaragePanel(); updateHUDStatic();
    toast(car.name + ' bought — it\'s waiting outside');
    G.audio.success();
  }));
  list.querySelectorAll('[data-select]').forEach((b) => b.addEventListener('click', () => {
    G.carId = b.dataset.select;
    spawnPlayerCar();
    saveGame(); buildGaragePanel(); updateHUDStatic();
    toast(CARS.find((c) => c.id === G.carId).name + ' ready');
    G.audio.click();
  }));
}

function toggleGarage() {
  const panel = $('garage-panel');
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    G.screen = 'play';
    return;
  }
  if (dist2d(G.player.x, G.player.z, LOCATIONS.garage.x, LOCATIONS.garage.z) > 26) {
    toast('Go to Farol Garage to open the garage');
    return;
  }
  buildGaragePanel();
  panel.classList.remove('hidden');
  G.screen = 'paused';
}

function buildMissionPanel() {
  const list = $('mission-list');
  list.innerHTML = MISSIONS.map((m, i) => {
    const locked = i > G.missionUnlocked;
    const done = i < G.missionUnlocked;
    return `<div class="mission-row ${locked ? 'locked' : ''} ${done ? 'done' : ''}">
      <span class="mission-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="mission-name">${m.name}<small>${m.act} · ${fmtCash(m.cash)} · +${m.respect} respect · ${m.wanted}★</small></span>
      ${locked ? '<button disabled>LOCKED</button>' : `<button data-start="${i}">${done ? 'REPLAY' : 'START'}</button>`}
    </div>`;
  }).join('');
  list.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
    $('mission-panel').classList.add('hidden');
    G.screen = 'play';
    startMission(parseInt(b.dataset.start, 10));
  }));
}

function toggleMissionPanel() {
  const panel = $('mission-panel');
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    G.screen = 'play';
    return;
  }
  buildMissionPanel();
  panel.classList.remove('hidden');
  G.screen = 'paused';
}

// ---------- 3D assembly ----------

function appendTransformed(dst, src, yaw, x, y, z) {
  const m = mat4YawPitch(yaw, 0, x, y, z);
  const a = src.toArrays();
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 0; i < a.pos.length; i += 3) {
    const p = mat4TransformPoint(m, [a.pos[i], a.pos[i + 1], a.pos[i + 2]]);
    dst.pos.push(p[0], p[1], p[2]);
    dst.col.push(a.col[i], a.col[i + 1], a.col[i + 2]);
    const nx = a.nrm[i], nz = a.nrm[i + 2];
    dst.nrm.push(nx * cy + nz * sy, a.nrm[i + 1], -nx * sy + nz * cy);
  }
}

let camState = null;
// Fixed virtual clock in screenshot mode so two renders of one shot are byte-identical.
function nowMs() { return G.shotMode ? (G.shotTime || 42000) : performance.now(); }
function renderOnly() {
  const r = G.renderer;
  if (!r || !r.gl) return;
  const canvas = document.getElementById('game');
  const sky = skyFor(G.time);
  // Camera: orbit the garage on the title screen, chase cam in play.
  let eye, target;
  if (G.screen === 'title') {
    const t = nowMs() / 1000;
    const cx = LOCATIONS.garage.x, cz = LOCATIONS.garage.z;
    eye = [cx + Math.cos(t * 0.07) * 95, 34, cz + Math.sin(t * 0.07) * 95];
    target = [cx, 6, cz];
  } else {
    const p = G.player;
    const fwdX = Math.sin(p.yaw), fwdZ = Math.cos(p.yaw);
    const rgtX = Math.cos(p.yaw), rgtZ = -Math.sin(p.yaw);
    const dist = p.onFoot ? 9.5 : 14;
    const h = p.onFoot ? 4.2 : 6.0;
    // Three-quarter rear view: offset to the side so the car reads in 3D and a
    // chasing cop rarely sits exactly between the camera and the player.
    const desEye = [p.x - fwdX * dist + rgtX * 3.5, h, p.z - fwdZ * dist + rgtZ * 3.5];
    const desTgt = [p.x + fwdX * 7 + rgtX * 1.2, 1.6, p.z + fwdZ * 7 + rgtZ * 1.2];
    if (!camState) camState = { eye: desEye.slice(), tgt: desTgt.slice() };
    // Frozen screenshots snap the camera: a lerped camera depends on how many
    // frames ran before the capture, which varies run to run.
    const kEye = G.shotDone ? 1 : 0.14, kTgt = G.shotDone ? 1 : 0.2;
    for (let i = 0; i < 3; i++) {
      camState.eye[i] = lerp(camState.eye[i], desEye[i], kEye);
      camState.tgt[i] = lerp(camState.tgt[i], desTgt[i], kTgt);
    }
    eye = camState.eye.slice(); target = camState.tgt.slice();
    if (G.trauma > 0.01) {
      const s = G.trauma * G.trauma * 1.4;
      const t = nowMs() / 1000;
      eye[0] += Math.sin(t * 61) * s; eye[1] += Math.sin(t * 83) * s * 0.6; eye[2] += Math.cos(t * 57) * s;
    }
  }
  r.setCamera(eye, target);

  const dyn = new MeshBuilder();
  const alpha = new MeshBuilder();
  const tmp = new MeshBuilder();

  // Player car / person.
  if (!G.player.onFoot) {
    tmp.pos.length = 0; tmp.col.length = 0; tmp.nrm.length = 0;
    carMesh(tmp, G.car.color, 0);
    appendTransformed(dyn, tmp, G.car.yaw, G.car.x, 0, G.car.z);
    if (G.car.nitro > 0) {
      dyn.cone(G.car.x - Math.sin(G.car.yaw) * 2.6, 0.7, G.car.z - Math.cos(G.car.yaw) * 2.6, 0.7, 2.2, 0x66c2ff, 8);
    }
  } else {
    tmp.pos.length = 0; tmp.col.length = 0; tmp.nrm.length = 0;
    personMesh(tmp, 0xc0392b, 0x2b2b2b, 0xd9a066);
    const bob = Math.abs(Math.sin(G.player.walkPhase)) * 0.08;
    appendTransformed(dyn, tmp, G.player.yaw, G.player.x, bob, G.player.z);
  }
  // Traffic.
  for (const t of G.traffic) {
    tmp.pos.length = 0; tmp.col.length = 0; tmp.nrm.length = 0;
    carMesh(tmp, t.wrecked ? 0x1c1c22 : t.color, t.escort ? 1 : 0);
    appendTransformed(dyn, tmp, t.yaw, t.x, 0, t.z);
    if (t.wrecked && !G.shotMode && G.rng.chance(0.06)) {
      G.particles.push({ x: t.x, y: 1.5, z: t.z, vx: 0, vy: 1.2, vz: 0, life: 0, max: 1.2, color: 0x555555, size: 0.6 });
    }
  }
  // Cops + flashing light bars.
  const flash = Math.floor(nowMs() / 260) % 2 === 0;
  for (const c of G.cops) {
    tmp.pos.length = 0; tmp.col.length = 0; tmp.nrm.length = 0;
    carMesh(tmp, 0xf2ead8, 1);
    appendTransformed(dyn, tmp, c.yaw, c.x, 0, c.z);
    const barCol = flash ? [2.2, 0.25, 0.25] : [0.25, 0.5, 2.2];
    const bx = c.x - Math.cos(c.yaw) * 0.5, bz = c.z + Math.sin(c.yaw) * 0.5;
    dyn.box(bx, 1.62, bz, 0.5, 0.22, 0.5, barCol);
  }
  // Roadblocks: striped barriers + cones.
  for (const rb of G.roadblocks) {
    const px = Math.cos(rb.yaw), pz = -Math.sin(rb.yaw);
    for (let i = -1; i <= 1; i++) {
      dyn.box(rb.x + px * i * 2.4, 0.9, rb.z + pz * i * 2.4, 2.2, 1.1, 0.5, i % 2 === 0 ? 0xff7a3c : 0xf2ead8);
    }
    dyn.cone(rb.x + px * 4.4, 0, rb.z + pz * 4.4, 0.5, 1.1, 0xff7a3c, 8);
    dyn.cone(rb.x - px * 4.4, 0, rb.z - pz * 4.4, 0.5, 1.1, 0xff7a3c, 8);
  }
  // Helicopter + rotor spin.
  if (G.heli.active) {
    tmp.pos.length = 0; tmp.col.length = 0; tmp.nrm.length = 0;
    heliMesh(tmp, 0x2b3a44);
    appendTransformed(dyn, tmp, G.heli.angle, G.heli.x, G.heli.y, G.heli.z);
    // Spinning rotor disc (thin, fast).
    const ra = nowMs() / 45;
    const rotor = new MeshBuilder();
    rotor.box(0, 0, 0, 7.6, 0.06, 0.5, 0x1c1c22);
    appendTransformed(dyn, rotor, ra, G.heli.x, G.heli.y + 1.15, G.heli.z);
    // Spotlight cone (alpha) + ground pool — narrow so it reads as a beam, not a wall.
    const top = [G.heli.x, G.heli.y - 0.8, G.heli.z];
    const base = [G.player.x, 0.2, G.player.z];
    const dx = base[0] - top[0], dz = base[2] - top[2];
    const len = Math.hypot(dx, dz) || 1;
    const px2 = -dz / len * 2.2, pz2 = dx / len * 2.2;
    alpha.tri([top[0], top[1], top[2]], [base[0] + px2, 0.2, base[2] + pz2], [base[0] - px2, 0.2, base[2] - pz2], [1, 0.95, 0.75]);
    alpha.cylinder(base[0], 0.15, base[2], 4.5, 0.1, [1, 0.95, 0.7], 14);
  }
  // Lamp glow at night: bright heads on lamps near the player (emissive look).
  if (sky.lamps) {
    for (const l of G.city.lamps) {
      if (Math.abs(l.x - G.player.x) > 130 || Math.abs(l.z - G.player.z) > 130) continue;
      dyn.box(l.x, 6.15, l.z, 1.5, 0.35, 0.55, [2.2, 1.6, 0.85]);
    }
  }
  // Pickups: spinning gold.
  for (const pk of G.pickups) {
    if (pk.taken) continue;
    tmp.pos.length = 0; tmp.col.length = 0; tmp.nrm.length = 0;
    tmp.cylinder(0, 0, 0, 0.9, 0.35, 0xffd24a, 10, 0xffe9a8);
    appendTransformed(dyn, tmp, pk.spin, pk.x, 1.1 + Math.sin(pk.spin * 2) * 0.25, pk.z);
  }
  // Waypoint beacon.
  if (G.waypoint) {
    const w = G.waypoint;
    const pulse = 0.75 + Math.sin(nowMs() / 300) * 0.25;
    dyn.box(w.x, 20, w.z, 1.1, 40, 1.1, [1.2 * pulse, 0.85 * pulse, 0.25]);
    dyn.cylinder(w.x, 0.1, w.z, 3.2, 0.3, 0xffd24a, 12);
  }
  // Tail target / rival.
  if (G.tailTarget) {
    tmp.pos.length = 0; tmp.col.length = 0; tmp.nrm.length = 0;
    carMesh(tmp, G.tailTarget.color, 0);
    appendTransformed(dyn, tmp, G.tailTarget.yaw, G.tailTarget.x, 0, G.tailTarget.z);
  }
  if (G.rival) {
    tmp.pos.length = 0; tmp.col.length = 0; tmp.nrm.length = 0;
    carMesh(tmp, G.rival.color, 0);
    appendTransformed(dyn, tmp, G.rival.yaw, G.rival.x, 0, G.rival.z);
  }
  // Particles.
  for (const p of G.particles) {
    const fade = 1 - p.life / p.max;
    const c = typeof p.color === 'number' ? p.color : 0xffffff;
    const r = ((c >> 16) & 255) / 255 * fade + 0.15;
    const g = ((c >> 8) & 255) / 255 * fade + 0.15;
    const b = (c & 255) / 255 * fade + 0.15;
    dyn.box(p.x, p.y, p.z, p.size, p.size, p.size, [Math.min(1.8, r), Math.min(1.8, g), Math.min(1.8, b)]);
  }
  // Lighthouse beam (alpha), rotating.
  {
    const lx = LOCATIONS.faro.x, lz = LOCATIONS.faro.z;
    const ba = nowMs() / 2400;
    const bx = lx + Math.cos(ba) * 60, bz = lz + Math.sin(ba) * 60;
    alpha.tri([lx, 36, lz], [bx - 4, 2, bz - 4], [bx + 4, 2, bz + 4], [1, 0.95, 0.7]);
  }

  const a = alpha.toArrays();
  r.draw(sky, dyn.toArrays(), { pos: a.pos, col: a.col, alpha: 0.10 });
}
