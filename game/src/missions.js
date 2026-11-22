// Cabo Lume — 12 staged story missions. Nadia Reyes, 27, ex-stunt driver for the Lume
// film studios, runs jobs for the crew Os Faróis to buy back her late father's garage
// from loan shark Senhor Malta. Each mission: intro dialogue, staged objectives with a
// progress bar, cash + respect rewards, and a wanted level it opens at.
'use strict';

const CREW = [
  { id: 'rui',   name: 'RUI "Ghost"',  role: 'Hacker',  key: '1', cd: 60, desc: 'Ghost Signal — drops 1 wanted star' },
  { id: 'tomas', name: 'TOMÁS "Turbo"', role: 'Wheelman', key: '2', cd: 45, desc: 'Nitro Rush — 4s nitro boost' },
  { id: 'ines',  name: 'INÊS "Doc"',   role: 'Muscle',  key: '3', cd: 50, desc: 'Pit Fix — full repair + shoves the nearest cop' },
];

const CARS = [
  { id: 'vela',    name: 'Vela GT',       price: 0,     top: 38, accel: 15, grip: 1.0,  color: 0xc0392b, desc: 'Nadia’s own GT. Balanced, honest, loud.' },
  { id: 'falcao',  name: 'Falcão S',      price: 8500,  top: 47, accel: 18, grip: 1.08, color: 0x2e6f73, desc: 'Ex-police interceptor. Fast, sticks to the road.' },
  { id: 'phantom', name: 'Lume Phantom',  price: 19000, top: 56, accel: 21, grip: 1.18, color: 0x1f2e3a, desc: 'Midnight coupe. The fastest thing on the cape.' },
];

const RANKS = [
  { at: 0,    name: 'ROOKIE' },
  { at: 400,  name: 'STREET' },
  { at: 1200, name: 'HUSTLER' },
  { at: 2600, name: 'KINGPIN' },
  { at: 5000, name: 'LEGEND OF LUME' },
];

function rankFor(respect) {
  let r = RANKS[0];
  for (const k of RANKS) if (respect >= k.at) r = k;
  return r.name;
}

// Stage kinds: goto (reach a marker), pickup (reach + hold E / auto), deliver (goto with
// cargo), escape (lose the cops / reach a cool zone), survive (stay alive X seconds),
// smash (drive through N roadblocks / hit N targets), tail (stay near a moving target).
const MISSIONS = [
  {
    id: 'm01', act: 'ACT I — THE DEBT', name: 'Golden Hour Getaway', giver: 'NADIA',
    wanted: 1, cash: 600, respect: 150,
    intro: [
      ['NADIA', 'The garage is my father’s. Malta says I owe him forty grand by Sunday.'],
      ['NADIA', 'First rule of Cabo Lume: never pay a shark with your own money.'],
      ['RUI', 'CLPD scanner is quiet. Take the Vela GT, run the boulevard, learn the streets.'],
    ],
    stages: [
      { kind: 'goto', loc: 'marina', text: 'Drive to Marina Lume', bar: 'Boulevard run' },
      { kind: 'pickup', loc: 'marina', text: 'Grab the package on the pier', bar: 'Pickup' },
      { kind: 'deliver', loc: 'garage', text: 'Bring it home to Farol Garage', bar: 'Delivery' },
    ],
  },
  {
    id: 'm02', act: 'ACT I — THE DEBT', name: 'The Farol Debt', giver: 'TOMÁS',
    wanted: 1, cash: 900, respect: 200,
    intro: [
      ['TOMÁS', 'Malta’s boys collect from the Mercado every Friday. Today is Friday.'],
      ['TOMÁS', 'Lift their van before they do. No guns. Just speed.'],
      ['NADIA', 'Borrowing a van from thieves. My father would be so proud.'],
    ],
    stages: [
      { kind: 'goto', loc: 'mercado', text: 'Reach Mercado Central', bar: 'Approach' },
      { kind: 'pickup', loc: 'mercado', text: 'Take the collection van’s cash box', bar: 'Grab' },
      { kind: 'escape', loc: 'garage', text: 'Lose the heat, then get to the garage', bar: 'Escape' },
    ],
  },
  {
    id: 'm03', act: 'ACT I — THE DEBT', name: 'Harbor Lights', giver: 'INÊS',
    wanted: 2, cash: 1400, respect: 260,
    intro: [
      ['INÊS', 'A shipment lands at the docks tonight. Unmarked crates, no questions.'],
      ['INÊS', 'CLPD patrols the containers. Stay in the shadows, move fast.'],
      ['RUI', 'I’ll loop their cameras for ninety seconds. Make them count.'],
    ],
    stages: [
      { kind: 'goto', loc: 'docks', text: 'Slip into Porto Docks', bar: 'Infiltration' },
      { kind: 'pickup', loc: 'docks', text: 'Load three crates (drive through each)', bar: 'Crates 0/3' },
      { kind: 'deliver', loc: 'garage', text: 'Haul the crates to the garage', bar: 'Haul' },
    ],
  },
  {
    id: 'm04', act: 'ACT I — THE DEBT', name: 'Sunset Strip', giver: 'TOMÁS',
    wanted: 2, cash: 1600, respect: 300,
    intro: [
      ['TOMÁS', 'Street race. Praia Dourada to the stadium, straight down the strip.'],
      ['TOMÁS', 'The prize is a Falcão S engine. Beat Rico’s crew and it’s ours.'],
      ['NADIA', 'Rico drives like his brakes are a rumour. Perfect. I like a challenge.'],
    ],
    stages: [
      { kind: 'goto', loc: 'beach', text: 'Line up on Praia Dourada', bar: 'Line-up' },
      { kind: 'deliver', loc: 'stadium', text: 'Race to Estádio Lume — beat the rival car', bar: 'Race' },
      { kind: 'escape', loc: 'plaza', text: 'Shake the patrols, cool off at the plaza', bar: 'Cool-down' },
    ],
  },
  {
    id: 'm05', act: 'ACT II — THE SYNDICATE', name: 'The Informant', giver: 'RUI',
    wanted: 2, cash: 1800, respect: 340,
    intro: [
      ['RUI', 'Malta has a rat inside CLPD. He eats at the Miradouro every night at six.'],
      ['RUI', 'Tail him from the hotel. Don’t get spotted — if he burns, we lose the thread.'],
      ['NADIA', 'Tail a rat. Fine. I’ve tailed worse. I’ve tailed Tomás.'],
    ],
    stages: [
      { kind: 'goto', loc: 'hotel', text: 'Find the informant at Hotel Miradouro', bar: 'Stakeout' },
      { kind: 'tail', loc: 'mercado', text: 'Tail him to Mercado Central — stay close, stay unseen', bar: 'Tail' },
      { kind: 'pickup', loc: 'mercado', text: 'Grab the ledger he drops', bar: 'Ledger' },
    ],
  },
  {
    id: 'm06', act: 'ACT II — THE SYNDICATE', name: 'Marina Job', giver: 'INÊS',
    wanted: 3, cash: 2400, respect: 420,
    intro: [
      ['INÊS', 'Malta keeps his money on a yacht. The “Santa Lume”. No guards on deck at dusk.'],
      ['INÊS', 'Take the safe, take the boat’s manifest, be gone before the lights come on.'],
      ['NADIA', 'A yacht job. Finally, a crime with a view.'],
    ],
    stages: [
      { kind: 'goto', loc: 'marina', text: 'Reach the Santa Lume at Marina Lume', bar: 'Boarding' },
      { kind: 'pickup', loc: 'marina', text: 'Crack the safe, take the manifest', bar: 'Safe 0/2' },
      { kind: 'escape', loc: 'tunnel', text: 'Run for the Old Tunnel — air support is up', bar: 'Escape' },
    ],
  },
  {
    id: 'm07', act: 'ACT II — THE SYNDICATE', name: 'Tunnel Rats', giver: 'RUI',
    wanted: 3, cash: 2600, respect: 460,
    intro: [
      ['RUI', 'The ledger names a smuggling route under the Old Tunnel. Malta moves cash at midnight.'],
      ['RUI', 'Intercept the courier convoy in the tunnel. Tight walls, no way out but through.'],
      ['TOMÁS', 'In a tunnel, the loudest car wins. That’s us. That’s always us.'],
    ],
    stages: [
      { kind: 'goto', loc: 'tunnel', text: 'Get to the Old Tunnel mouth', bar: 'Approach' },
      { kind: 'smash', loc: 'tunnel', text: 'Smash through the courier escort (3 cars)', bar: 'Escort 0/3' },
      { kind: 'deliver', loc: 'garage', text: 'Bring the courier cash to the garage', bar: 'Delivery' },
    ],
  },
  {
    id: 'm08', act: 'ACT II — THE SYNDICATE', name: 'Air One', giver: 'TOMÁS',
    wanted: 3, cash: 3000, respect: 520,
    intro: [
      ['TOMÁS', 'FALCÃO-1 is in the air. CLPD’s spotlight bird. It never blinks.'],
      ['TOMÁS', 'They want the crew in one net tonight. So we give them a chase they’ll never forget.'],
      ['NADIA', 'A helicopter versus a stunt driver. Somebody tell the bird to bring a friend.'],
    ],
    stages: [
      { kind: 'goto', loc: 'plaza', text: 'Draw the heat to Praça do Sol', bar: 'Bait' },
      { kind: 'survive', loc: 'plaza', text: 'Survive the spotlight — stay moving for 45s', bar: 'Spotlight' },
      { kind: 'escape', loc: 'beach', text: 'Break the lock and vanish down the beach', bar: 'Breakaway' },
    ],
  },
  {
    id: 'm09', act: 'ACT III — THE FALL', name: 'Roadblock Run', giver: 'INÊS',
    wanted: 4, cash: 3800, respect: 620,
    intro: [
      ['INÊS', 'CLPD locked the city down. Four stars. Roadblocks on every avenue.'],
      ['INÊS', 'The crew is pinned at the stadium. We go get them — through the blocks, not around.'],
      ['NADIA', 'Roadblocks are just a suggestion with flashing lights.'],
    ],
    stages: [
      { kind: 'smash', loc: 'stadium', text: 'Smash through 3 roadblocks on the way in', bar: 'Blocks 0/3' },
      { kind: 'pickup', loc: 'stadium', text: 'Pick up the crew at Estádio Lume', bar: 'Pickup' },
      { kind: 'escape', loc: 'garage', text: 'Get everyone home to the garage', bar: 'Escape' },
    ],
  },
  {
    id: 'm10', act: 'ACT III — THE FALL', name: 'The Vault of Lume', giver: 'RUI',
    wanted: 4, cash: 4500, respect: 720,
    intro: [
      ['RUI', 'Banco do Lume. Malta’s clean money sleeps in vault three.'],
      ['RUI', 'I’ll kill the alarms for two minutes. That is the whole plan. Two minutes.'],
      ['NADIA', 'Two minutes, one vault, zero apologies. Let’s go.'],
    ],
    stages: [
      { kind: 'goto', loc: 'bank', text: 'Reach Banco do Lume', bar: 'Approach' },
      { kind: 'survive', loc: 'bank', text: 'Hold the vault door — 40s while Rui cracks it', bar: 'Crack' },
      { kind: 'escape', loc: 'tunnel', text: 'Run the money through the Old Tunnel', bar: 'Escape' },
    ],
  },
  {
    id: 'm11', act: 'ACT III — THE FALL', name: 'Double Cross', giver: 'NADIA',
    wanted: 5, cash: 5200, respect: 850,
    intro: [
      ['NADIA', 'Rico sold us out. Malta knows the garage, the crew, everything.'],
      ['NADIA', 'He’s meeting Malta at the Miradouro to collect. We crash the party.'],
      ['INÊS', 'No more running, Nadia. Tonight we end it.'],
    ],
    stages: [
      { kind: 'goto', loc: 'hotel', text: 'Storm Hotel Miradouro', bar: 'Storm' },
      { kind: 'smash', loc: 'hotel', text: 'Smash Rico’s escort (4 cars)', bar: 'Escort 0/4' },
      { kind: 'pickup', loc: 'hotel', text: 'Take Malta’s ledger from Rico', bar: 'Ledger' },
    ],
  },
  {
    id: 'm12', act: 'FINALE — DAWN', name: 'Dawn of Cabo Lume', giver: 'NADIA',
    wanted: 5, cash: 12000, respect: 1500,
    intro: [
      ['NADIA', 'The ledger buys the garage back. Every cent Malta stole, on paper, in my hands.'],
      ['NADIA', 'One last run. Five stars, the whole city awake, dawn breaking over the cape.'],
      ['RUI', 'Farol do Lume, Nadia. Bring it home. Light the lamp yourself.'],
    ],
    stages: [
      { kind: 'goto', loc: 'bank', text: 'Settle the debt at Banco do Lume', bar: 'Settlement' },
      { kind: 'escape', loc: 'faro', text: 'Outrun everything to the lighthouse', bar: 'Final run' },
      { kind: 'survive', loc: 'faro', text: 'Hold the point until dawn — 30s', bar: 'Dawn' },
    ],
  },
];

// ---- pure mission engine (Node-testable) ----

// Wanted stars from heat 0..100. Thresholds mirror the in-game HUD.
function starsForHeat(heat) {
  if (heat < 15) return 0;
  if (heat < 35) return 1;
  if (heat < 55) return 2;
  if (heat < 75) return 3;
  if (heat < 90) return 4;
  return 5;
}

// Dispatch roles for N active ground units at a given wanted level.
function dispatchRoles(wanted, n) {
  const roles = [];
  for (let i = 0; i < n; i++) {
    if (wanted >= 4 && i === 0) roles.push('ROADBLOCK');
    else if (wanted >= 3 && i === 1) roles.push('FLANKING');
    else if (wanted >= 2 && i % 3 === 2) roles.push('RAMMING');
    else roles.push('CHASE');
  }
  return roles;
}

// One objective check. state: {x,z,heat,stars,speed,nearTarget,elapsed,smashCount,pickCount,
// tailDist,tailSeen}. Returns {done, progress 0..1, hint}.
function checkStage(stage, s) {
  switch (stage.kind) {
    case 'goto':
    case 'deliver':
    case 'pickup': {
      const done = s.nearTarget === true;
      return { done, progress: done ? 1 : Math.max(0, 1 - (s.distToTarget || 999) / 400), hint: done ? 'Done' : Math.round(s.distToTarget || 0) + 'm' };
    }
    case 'escape': {
      const done = s.stars === 0 && s.nearTarget === true;
      const p = s.stars === 0 ? 0.6 + 0.4 * Math.max(0, 1 - (s.distToTarget || 0) / 200) : 0.3 * (1 - (s.heat || 0) / 100);
      return { done, progress: Math.max(0, Math.min(1, p)), hint: s.stars > 0 ? 'Lose the cops first — ' + s.stars + '★' : Math.round(s.distToTarget || 0) + 'm to safety' };
    }
    case 'survive': {
      const need = stage.seconds || 40;
      return { done: (s.elapsed || 0) >= need, progress: Math.min(1, (s.elapsed || 0) / need), hint: Math.max(0, need - Math.floor(s.elapsed || 0)) + 's left' };
    }
    case 'smash': {
      const need = stage.count || 3;
      return { done: (s.smashCount || 0) >= need, progress: Math.min(1, (s.smashCount || 0) / need), hint: (s.smashCount || 0) + '/' + need };
    }
    case 'tail': {
      const done = s.tailDone === true;
      return { done, progress: Math.min(1, (s.tailTime || 0) / 25), hint: s.tailSeen ? 'SPOTTED — back off!' : Math.round(s.tailDist || 0) + 'm' };
    }
    default:
      return { done: false, progress: 0, hint: '' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CREW, CARS, RANKS, rankFor, MISSIONS, starsForHeat, dispatchRoles, checkStage };
}
