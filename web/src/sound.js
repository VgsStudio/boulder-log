// Som só ao registrar boulder: trombeta sintetizada na hora (Web Audio), nada para baixar.
// Flash = fanfarra completa; mandou = toque curto subindo; tentativa de projeto = uma nota suave.
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

/** Uma nota de trombeta: dente-de-serra com filtro que "abre" no ataque (o brilho do metal) e um vibrato leve. */
function brass(ac, freq, at, { dur = 0.22, vol = 0.18 } = {}) {
  const out = ac.createGain();
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(vol, at + 0.035);
  out.gain.setValueAtTime(vol * 0.85, at + dur * 0.6);
  out.gain.exponentialRampToValueAtTime(0.0008, at + dur + 0.12);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(freq * 1.2, at);
  lp.frequency.linearRampToValueAtTime(freq * 7, at + 0.06);
  lp.frequency.exponentialRampToValueAtTime(freq * 3.5, at + dur);
  lp.connect(out).connect(ac.destination);
  const vib = ac.createOscillator();
  const vibAmt = ac.createGain();
  vib.frequency.value = 5.5;
  vibAmt.gain.value = freq * 0.006;
  vib.connect(vibAmt);
  for (const [type, mult, level] of [['sawtooth', 1, 0.7], ['square', 1.003, 0.18], ['sawtooth', 2, 0.12]]) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq * mult, at);
    vibAmt.connect(o.frequency);
    g.gain.value = level;
    o.connect(g).connect(lp);
    o.start(at);
    o.stop(at + dur + 0.2);
  }
  vib.start(at);
  vib.stop(at + dur + 0.2);
}

function play(notes) {
  if (!enabled()) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  for (const [freq, dt, opts] of notes) brass(ac, freq, t + dt, opts);
}
const vibrate = (pattern) => { try { navigator.vibrate?.(pattern); } catch {} };

const G4 = 392, C5 = 523.25, E5 = 659.25, G5 = 784, C6 = 1046.5, E4 = 329.63;

/** Som do resultado registrado: 'flash' | 'sent' | 'project'. */
export function playResult(result) {
  if (result === 'flash') {
    // Fanfarra: ta-ta-ta-taaam, com a terça por cima no final.
    play([[G4, 0, { dur: 0.1 }], [G4, 0.13, { dur: 0.1 }], [G4, 0.26, { dur: 0.1 }], [C5, 0.39, { dur: 0.32 }],
      [E5, 0.75, { dur: 0.14 }], [G5, 0.9, { dur: 0.7, vol: 0.2 }], [C6, 0.9, { dur: 0.7, vol: 0.09 }]]);
    vibrate([15, 30, 15, 30, 15, 60, 50]);
  } else if (result === 'sent') {
    // Mandou: chamada curta subindo.
    play([[G4, 0, { dur: 0.12 }], [C5, 0.15, { dur: 0.12 }], [E5, 0.3, { dur: 0.45, vol: 0.19 }]]);
    vibrate([12, 40, 30]);
  } else {
    // Tentativa de projeto: uma nota suave, "segue o baile".
    play([[E4, 0, { dur: 0.22, vol: 0.1 }]]);
    vibrate(10);
  }
}
