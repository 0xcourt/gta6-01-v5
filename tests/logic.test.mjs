// Cabo Lume — logic tests. Pure modules only (rng, world, missions, render3d math,
// audio data). Run: node tests/logic.test.mjs — exit 1 on any failure.
'use strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const rng = require('../game/src/rng.js');
const world = require('../game/src/world.js');
const missions = require('../game/src/missions.js');
const render = require('../game/src/render3d.js');
const audio = require('../game/src/audio.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
function hashObj(o) { return createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16); }

console.log('== rng ==');
{
  const a = rng.makeRng('cabo-lume-v5'), b = rng.makeRng('cabo-lume-v5');
  let same = true;
  for (let i = 0; i < 1000; i++) if (a.next() !== b.next()) same = false;
  check('same seed -> identical 1000 draws', same);
  check('different seed -> different draws', rng.makeRng('x').next() !== rng.makeRng('y').next());
  check('seedFromString stable', rng.seedFromString('cabo-lume') === rng.seedFromString('cabo-lume'));
  check('range within bounds', (() => { const r = rng.makeRng(7); for (let i = 0; i < 500; i++) { const v = r.range(2, 5); if (v < 2 || v >= 5) return false; } return true; })());
  check('clamp', rng.clamp(9, 0, 5) === 5 && rng.clamp(-1, 0, 5) === 0 && rng.clamp(3, 0, 5) === 3);
  check('fmtCash', rng.fmtCash(12500) === '$12,500');
  check('fmtTime 1040 -> 17:20', rng.fmtTime(1040) === '17:20');
}

console.log('== world ==');
{
  const c1 = world.genCity('cabo-lume-v5');
  const c2 = world.genCity('cabo-lume-v5');
  check('city deterministic (hash)', hashObj(c1) === hashObj(c2));
  check('city has buildings', c1.buildings.length > 100, 'got ' + c1.buildings.length);
  check('city has palms', c1.palms.length > 50, 'got ' + c1.palms.length);
  check('city has lamps', c1.lamps.length > 20, 'got ' + c1.lamps.length);
  check('city has parked cars', c1.parked.length === 46);
  check('city has lighthouse prop', c1.props.some((p) => p.kind === 'lighthouse'));
  check('all locations inside world', Object.values(world.LOCATIONS).every((l) => Math.abs(l.x) <= 380 && Math.abs(l.z) <= 380));
  const rp = world.nearestRoadPoint(10, 10);
  const lines = world.streetLines();
  check('nearestRoadPoint snaps to a street', lines.includes(rp.x) || lines.includes(rp.z), JSON.stringify(rp));
  const col = world.collideCircleBuildings(c1, c1.buildings[0].x, c1.buildings[0].z, 1);
  check('building collision pushes out', col.hit === true && (col.x !== c1.buildings[0].x || col.z !== c1.buildings[0].z));
  const cl = world.clampToWorld(9999, -9999, 2);
  check('clampToWorld bounds', cl.x <= world.CITY.waterX && cl.z >= -world.CITY.half);
}

console.log('== missions ==');
{
  check('12 missions', missions.MISSIONS.length === 12, 'got ' + missions.MISSIONS.length);
  check('mission ids unique', new Set(missions.MISSIONS.map((m) => m.id)).size === 12);
  check('every mission has 3 stages', missions.MISSIONS.every((m) => m.stages.length === 3));
  check('every stage loc exists', missions.MISSIONS.every((m) => m.stages.every((s) => world.LOCATIONS[s.loc])));
  check('wanted 1..5', missions.MISSIONS.every((m) => m.wanted >= 1 && m.wanted <= 5));
  check('cash + respect positive', missions.MISSIONS.every((m) => m.cash > 0 && m.respect > 0));
  check('intro dialogue present', missions.MISSIONS.every((m) => m.intro.length >= 2));
  check('final mission is the dawn finale', missions.MISSIONS[11].id === 'm12' && missions.MISSIONS[11].name === 'Dawn of Cabo Lume');
  check('starsForHeat thresholds', missions.starsForHeat(0) === 0 && missions.starsForHeat(20) === 1 && missions.starsForHeat(40) === 2 && missions.starsForHeat(60) === 3 && missions.starsForHeat(80) === 4 && missions.starsForHeat(95) === 5);
  check('dispatchRoles 1 star all CHASE', missions.dispatchRoles(1, 2).every((r) => r === 'CHASE'));
  check('dispatchRoles 3 stars has FLANKING', missions.dispatchRoles(3, 3).includes('FLANKING'));
  check('dispatchRoles 4 stars leads ROADBLOCK', missions.dispatchRoles(4, 4)[0] === 'ROADBLOCK');
  check('dispatchRoles 2 stars has RAMMING', missions.dispatchRoles(2, 3).includes('RAMMING'));
  check('rankFor thresholds', missions.rankFor(0) === 'ROOKIE' && missions.rankFor(500) === 'STREET' && missions.rankFor(1300) === 'HUSTLER' && missions.rankFor(3000) === 'KINGPIN' && missions.rankFor(6000) === 'LEGEND OF LUME');
  check('3 crew', missions.CREW.length === 3);
  check('3 garage cars, top speed rises with price', missions.CARS.length === 3 && missions.CARS[0].top < missions.CARS[1].top && missions.CARS[1].top < missions.CARS[2].top);
  const goto = missions.checkStage({ kind: 'goto' }, { nearTarget: true, distToTarget: 0 });
  check('checkStage goto done', goto.done === true && goto.progress === 1);
  const esc = missions.checkStage({ kind: 'escape' }, { stars: 0, nearTarget: true, distToTarget: 0, heat: 0 });
  check('checkStage escape done when clean + near', esc.done === true);
  const escHot = missions.checkStage({ kind: 'escape' }, { stars: 3, nearTarget: true, distToTarget: 0, heat: 60 });
  check('checkStage escape not done while wanted', escHot.done === false);
  const surv = missions.checkStage({ kind: 'survive', seconds: 40 }, { elapsed: 20 });
  check('checkStage survive half progress', Math.abs(surv.progress - 0.5) < 1e-9 && surv.done === false);
  const smash = missions.checkStage({ kind: 'smash', count: 3 }, { smashCount: 3 });
  check('checkStage smash done at count', smash.done === true);
  const tail = missions.checkStage({ kind: 'tail' }, { tailSeen: true, tailDist: 5, tailTime: 0 });
  check('checkStage tail warns when spotted', tail.hint.includes('SPOTTED'));
}

console.log('== render math ==');
{
  const I = render.mat4Identity();
  check('identity * identity = identity', JSON.stringify(render.mat4Multiply(I, I)) === JSON.stringify(I));
  const proj = render.mat4Perspective(62 * Math.PI / 180, 1280 / 577, 0.5, 1600);
  const view = render.mat4LookAt([0, 5, -12], [0, 1.5, 0], [0, 1, 0]);
  const vp = render.mat4Multiply(proj, view);
  const p = render.mat4TransformPoint(vp, [0, 1.5, 0]);
  check('lookAt projects target near centre', Math.abs(p[0]) < 0.01 && Math.abs(p[1]) < 0.6, JSON.stringify(p));
  const skyGold = render.skyFor(1040);
  check('golden hour horizon is orange (r>g>b)', skyGold.hor[0] > skyGold.hor[1] && skyGold.hor[1] > skyGold.hor[2], JSON.stringify(skyGold.hor));
  const skyNight = render.skyFor(1200);
  check('night top is dark', skyNight.top[0] < 0.1 && skyNight.ambient < 0.35);
  check('lamps on at night', render.skyFor(1200).lamps === true);
  check('lamps off at golden hour', render.skyFor(1040).lamps === false);
  const mb = new render.MeshBuilder();
  mb.box(0, 1, 0, 2, 2, 2, 0xff0000);
  check('box = 36 verts', mb.verts() === 36, 'got ' + mb.verts());
  const cyl = new render.MeshBuilder();
  cyl.cylinder(0, 0, 0, 1, 2, 0x00ff00, 8);
  check('cylinder verts > 0', cyl.verts() > 0);
  const car = new render.MeshBuilder();
  render.carMesh(car, 0xc0392b, 0);
  check('car mesh verts > 100', car.verts() > 100, 'got ' + car.verts());
  const heli = new render.MeshBuilder();
  render.heliMesh(heli, 0x2b3a44);
  check('heli mesh verts > 50', heli.verts() > 50);
}

console.log('== audio data ==');
{
  check('3 radio stations', audio.STATIONS.length === 3);
  check('stations distinct bpm', new Set(audio.STATIONS.map((s) => s.bpm)).size === 3);
  check('midiToFreq A4 = 440', Math.abs(audio.midiToFreq(69) - 440) < 1e-9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
