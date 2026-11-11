// Sons de comemoração sintetizados na hora (Web Audio): nada para baixar.
// O iOS só libera áudio depois de um toque do usuário, por isso o contexto é
// "destravado" no primeiro toque em qualquer lugar da página.

let ctx;
const enabled = () => { try { return localStorage.getItem('cm:sound') !== 'off'; } catch { return true; } };
export const soundOn = enabled;
export function setSound(on) { try { localStorage.setItem('cm:sound', on ? 'on' : 'off'); } catch {} }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
document.addEventListener('pointerdown', () => audio(), { once: true, capture: true });

/** Uma nota de "sino": fundamental + harmônico, ataque rápido e cauda curta. */
function bell(ac, freq, at, { dur = 0.32, vol = 0.22 } = {}) {
  const out = ac.createGain();
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(vol, at + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  out.connect(ac.destination);
  for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3.01, 0.12]]) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq * mult, at);
    g.gain.value = level;
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.05);
  }
}

function play(notes) {
  if (!enabled()) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  for (const [freq, dt, opts] of notes) bell(ac, freq, t + dt, opts);
}

const vibrate = (pattern) => { try { navigator.vibrate?.(pattern); } catch {} };

/** Mandou a via: "ding-ding" subindo (terça maior), curtinho e brilhante. */
export function playSent() {
  play([[1046.5, 0], [1318.5, 0.085, { dur: 0.42, vol: 0.24 }]]);
  vibrate([12, 40, 22]);
}

/** Recorde, conquista ou nível: arpejo maior com nota final longa. */
export function playFanfare() {
  play([[784, 0, { dur: 0.22 }], [988, 0.075, { dur: 0.22 }], [1175, 0.15, { dur: 0.24 }], [1568, 0.23, { dur: 0.7, vol: 0.26 }]]);
  vibrate([15, 35, 15, 35, 40]);
}

/** Toque leve de confirmação (projeto, tentativa registrada). */
export function playTick() {
  play([[880, 0, { dur: 0.14, vol: 0.14 }]]);
  vibrate(10);
}
