// Cabo Lume — all sound is synthesized live with WebAudio. No audio files, no network:
// engine hum, two-tone CLPD siren, pickup blips, explosions, and three procedural radio
// stations (synthwave, latin, lo-fi) sequenced from scales. Muted until the first user
// gesture, as browsers require.
'use strict';

const STATIONS = [
  { id: 'onda',   name: 'ONDA 88.5 — Synthwave', bpm: 112, root: 45, scale: [0, 3, 5, 7, 10], wave: 'sawtooth', bass: [0, 0, 7, 10] },
  { id: 'lume',   name: 'RÁDIO LUME 101 — Latin', bpm: 128, root: 50, scale: [0, 2, 4, 7, 9], wave: 'square', bass: [0, 5, 7, 5] },
  { id: 'farol',  name: 'FAROL FM 94 — Lo-fi',   bpm: 76,  root: 43, scale: [0, 3, 5, 8, 10], wave: 'triangle', bass: [0, 0, 3, 7] },
];

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function createAudio() {
  let ctx = null, master = null, radioGain = null, engineOsc = null, engineGain = null;
  let sirenOsc = null, sirenGain = null, sirenTimer = 0, sirenHi = false;
  let stationIdx = 0, radioOn = true, nextNoteTime = 0, step = 0, rng = makeRng('cabo-lume-radio');
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      radioGain = ctx.createGain(); radioGain.gain.value = 0.16; radioGain.connect(master);
      engineGain = ctx.createGain(); engineGain.gain.value = 0; engineGain.connect(master);
      engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 55;
      const engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 420;
      engineOsc.connect(engineFilter); engineFilter.connect(engineGain); engineOsc.start();
      sirenGain = ctx.createGain(); sirenGain.gain.value = 0; sirenGain.connect(master);
      sirenOsc = ctx.createOscillator(); sirenOsc.type = 'square'; sirenOsc.frequency.value = 720;
      sirenOsc.connect(sirenGain); sirenOsc.start();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      nextNoteTime = ctx.currentTime + 0.1;
      return true;
    } catch (e) { return false; }
  }

  function blip(freq, dur, type, vol, when) {
    if (!ctx) return;
    const t = when || ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(); src.stop(ctx.currentTime + dur);
  }

  return {
    ensure,
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setEngine(speed01, on) {
      if (!ctx) return;
      engineOsc.frequency.value = 50 + speed01 * 130;
      engineGain.gain.value = on ? 0.05 + speed01 * 0.06 : 0;
    },
    setSiren(on, dist01) {
      if (!ctx) return;
      sirenGain.gain.value = on ? 0.05 * (1 - Math.min(0.85, dist01)) : 0;
    },
    sirenTick(dt) {
      if (!ctx || sirenGain.gain.value <= 0) return;
      sirenTimer += dt;
      if (sirenTimer > 0.42) { sirenTimer = 0; sirenHi = !sirenHi; sirenOsc.frequency.value = sirenHi ? 950 : 700; }
    },
    pickup() { blip(880, 0.12, 'sine', 0.3); blip(1318, 0.18, 'sine', 0.25, ctx ? ctx.currentTime + 0.08 : 0); },
    coin() { blip(1046, 0.08, 'square', 0.18); blip(1568, 0.14, 'square', 0.15, ctx ? ctx.currentTime + 0.06 : 0); },
    crash() { noise(0.25, 0.5, 500); blip(90, 0.2, 'sine', 0.4); },
    explosion() { noise(0.9, 0.7, 900); blip(55, 0.7, 'sine', 0.5); },
    success() {
      if (!ctx) return;
      [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.22, 'triangle', 0.25, ctx.currentTime + i * 0.09));
    },
    busted() { if (!ctx) return; [392, 330, 262, 196].forEach((f, i) => blip(f, 0.3, 'sawtooth', 0.2, ctx.currentTime + i * 0.14)); },
    click() { blip(660, 0.05, 'square', 0.15); },
    station() { return STATIONS[stationIdx]; },
    cycleStation() { stationIdx = (stationIdx + 1) % STATIONS.length; step = 0; return STATIONS[stationIdx]; },
    toggleRadio() { radioOn = !radioOn; if (radioGain) radioGain.gain.value = radioOn ? 0.16 : 0; return radioOn; },
    radioTick() {
      if (!ctx || !radioOn) return;
      const st = STATIONS[stationIdx];
      const spb = 60 / st.bpm / 2; // eighth notes
      while (nextNoteTime < ctx.currentTime + 0.15) {
        const bar = Math.floor(step / 8) % 4;
        const deg = st.scale[Math.floor(rng.next() * st.scale.length)];
        const octave = rng.chance(0.25) ? 12 : 0;
        if (step % 2 === 0 || rng.chance(0.35)) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = st.wave; o.frequency.value = midiToFreq(st.root + 12 + deg + octave);
          g.gain.setValueAtTime(0.11, nextNoteTime);
          g.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + spb * 0.9);
          o.connect(g); g.connect(radioGain); o.start(nextNoteTime); o.stop(nextNoteTime + spb);
        }
        if (step % 8 === 0) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = midiToFreq(st.root - 12 + st.bass[bar]);
          g.gain.setValueAtTime(0.22, nextNoteTime);
          g.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + spb * 7);
          o.connect(g); g.connect(radioGain); o.start(nextNoteTime); o.stop(nextNoteTime + spb * 7);
        }
        if (step % 4 === 2) { // hat tick
          const src = ctx.createBufferSource(); src.buffer = noiseBuf;
          const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.05, nextNoteTime);
          g.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + 0.05);
          src.connect(f); f.connect(g); g.connect(radioGain);
          src.start(nextNoteTime); src.stop(nextNoteTime + 0.06);
        }
        nextNoteTime += spb;
        step++;
      }
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STATIONS, midiToFreq, createAudio };
}
