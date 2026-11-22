// Cabo Lume — boot. Sizes the canvas, wires the menus, starts the loop, traps errors
// for the smoke test, and stages ?shot=N scenes for screenshots.
'use strict';

/* global initGame, frame, stageShot, hideOverlays, G */

window.__errors = [];
window.addEventListener('error', (e) => {
  window.__errors.push(String(e.message || e.error));
  const el = document.getElementById('err');
  if (el) el.textContent = window.__errors.join(' | ');
});
window.addEventListener('unhandledrejection', (e) => {
  window.__errors.push('rejection: ' + String(e.reason));
});

function sizeCanvas() {
  const cv = document.getElementById('game');
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
}

window.addEventListener('load', () => {
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);
  const canvas = document.getElementById('game');
  initGame(canvas);

  // Menu buttons.
  document.getElementById('start-btn').addEventListener('click', () => {
    G.audio.ensure(); G.audio.resume();
    startPlaying();
  });
  document.getElementById('resume-btn').addEventListener('click', () => pauseGame(false));
  document.getElementById('respawn-btn').addEventListener('click', () => respawn());
  document.getElementById('complete-continue-btn').addEventListener('click', () => {
    G.screen = 'play'; hideOverlays();
  });
  document.getElementById('garage-close-btn').addEventListener('click', () => {
    document.getElementById('garage-panel').classList.add('hidden');
    G.screen = 'play';
  });
  document.getElementById('mission-close-btn').addEventListener('click', () => {
    document.getElementById('mission-panel').classList.add('hidden');
    G.screen = 'play';
  });
  document.getElementById('dialogue-box').addEventListener('click', () => advanceDialogue());
  document.getElementById('howto-btn').addEventListener('click', () => {
    document.getElementById('howto').classList.toggle('hidden');
  });

  // Screenshot mode: ?shot=1..4 — stage the scene, freeze the sim, render.
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (shot) {
    try {
      stageShot(shot);
    } catch (e) {
      window.__errors.push('stageShot: ' + String(e && e.message || e));
      document.title = 'SHOT-ERROR';
    }
  }
  requestAnimationFrame(frame);
});
